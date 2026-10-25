import { GetSiteDataByKey } from "$lib/server/controllers/siteDataController.js";
import { GetAllPages } from "$lib/server/controllers/pagesController.js";
import { GetMonitors } from "$lib/server/controllers/monitorsController.js";
import serverResolver from "$lib/server/resolver.js";
import db from "$lib/server/db/db.js";
import type { PublicOrigin } from "$lib/server/publicOrigins.js";
import type { SitemapXMLConfig } from "$lib/types/site.js";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ locals }) => {
  const sitemap = (await GetSiteDataByKey("sitemap")) as SitemapXMLConfig | null;
  const mode = sitemap?.mode ?? "auto";

  if (mode === "off") {
    return new Response("Not found", { status: 404 });
  }

  // An admitted public origin lists only its own page's URLs. The configured manual URLs belong to the
  // site URL, and a sitemap may only name URLs on its own host.
  if (locals.publicOrigin) {
    const locs = await admittedOriginLocs(locals.publicOrigin);
    return locs ? sitemapResponse(toUrlEntries(locs)) : new Response("Not found", { status: 404 });
  }

  if (mode === "manual") {
    const urls = sitemap?.urls ?? [];
    return sitemapResponse(toUrlEntries(urls.map((u) => u.loc.trim()).filter((loc) => loc.length > 0)));
  }

  // auto mode
  const siteURL = (await GetSiteDataByKey("siteURL")) as string | null;
  if (!siteURL) {
    return new Response("Not found", { status: 404 });
  }

  const locs: string[] = [];

  // Add pages
  const pages = await GetAllPages();
  for (const page of pages) {
    const path = page.page_path ? `/${page.page_path}` : "/";
    locs.push(siteURL + serverResolver(path));
  }

  // Add active, visible monitors
  const monitors = await GetMonitors({ status: "ACTIVE", is_hidden: "NO" });
  for (const monitor of monitors) {
    locs.push(siteURL + serverResolver(`/monitors/${monitor.tag}`));
  }

  // Add current and previous month events pages
  for (const path of eventsMonthPaths()) {
    locs.push(siteURL + serverResolver(path));
  }

  // Add any manual URLs configured alongside auto
  const manualUrls = sitemap?.urls ?? [];
  for (const u of manualUrls) {
    if (u.loc.trim().length > 0) {
      locs.push(u.loc.trim());
    }
  }

  return sitemapResponse(toUrlEntries(locs));
};

// The admitted page at the root, its active visible monitors, and its events pages
async function admittedOriginLocs(publicOrigin: PublicOrigin): Promise<string[] | null> {
  const page = await db.getPageByPath(publicOrigin.pagePath);
  if (!page) {
    return null;
  }
  const paths = ["/"];
  for (const pageMonitor of await db.getActivePageMonitors(page.id)) {
    paths.push(`/monitors/${pageMonitor.monitor_tag}`);
  }
  paths.push(...eventsMonthPaths());
  return paths.map((path) => publicOrigin.origin + serverResolver(path));
}

// Current and previous month events pages
function eventsMonthPaths(): string[] {
  const now = new Date();
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const currentMonth = `${months[now.getUTCMonth()]}-${now.getUTCFullYear()}`;
  const prevDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const previousMonth = `${months[prevDate.getUTCMonth()]}-${prevDate.getUTCFullYear()}`;
  return [`/events/${currentMonth}`, `/events/${previousMonth}`];
}

function toUrlEntries(locs: string[]): string {
  return locs.map((loc) => `  <url>\n    <loc>${escapeXml(loc)}</loc>\n  </url>`).join("\n");
}

function sitemapResponse(urlEntries: string): Response {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries}
</urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml",
    },
  });
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
