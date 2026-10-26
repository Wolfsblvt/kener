/**
 * Product status Homes on admitted public origins.
 *
 * `KENER_PUBLIC_ORIGINS` admits extra public origins, each serving exactly one status page at its root,
 * from the same instance, database, monitors, history and subscribers:
 *
 *   KENER_PUBLIC_ORIGINS=https://status.example.org=example,https://status.other.dev=other
 *
 * A request is on an admitted origin only when its `Host` header is exactly an admitted host. Forwarding
 * headers (`X-Forwarded-Host` and friends) are never read, so a client cannot talk its way onto an origin
 * that is not in this list, and an unknown or malformed host behaves exactly as upstream: the configured
 * site URL and every page. The list is read from the environment, never from the request or the database.
 *
 * On its origin the page is the product's own Home: its title, logo and brand favicon lead the shell, a
 * monitor, incident or maintenance answers there only when the page shows it, and subscribing stays on the
 * site URL, whose subscriptions cover every page.
 */
import { error, redirect } from "@sveltejs/kit";
import db from "$lib/server/db/db.js";
import serverResolve from "$lib/server/resolver.js";
import { GetPageShownMonitorTags } from "$lib/server/controllers/pagesController.js";

export interface PublicOrigin {
  /** Absolute origin without a trailing slash, e.g. "https://status.example.org". */
  origin: string;
  /** Path of the status page this origin serves at its root. */
  pagePath: string;
}

// Same character set pagesController normalizes a page path to; the home page ("") is never admitted.
const PAGE_PATH = /^[a-z0-9_-]+$/;

/**
 * Parses the admitted origins, keyed by host. An invalid entry, or a second entry for the same host or
 * the same page, is logged and skipped: a broken entry must never widen what is admitted.
 */
export function ParsePublicOrigins(raw: string | undefined): Map<string, PublicOrigin> {
  const admitted = new Map<string, PublicOrigin>();
  const pagePaths = new Set<string>();
  for (const entry of (raw ?? "").split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const separator = trimmed.lastIndexOf("=");
    const origin = separator > 0 ? parseOrigin(trimmed.slice(0, separator)) : null;
    const pagePath = trimmed.slice(separator + 1).trim();
    if (!origin || !PAGE_PATH.test(pagePath)) {
      console.error(`KENER_PUBLIC_ORIGINS: ignoring "${trimmed}"; expected <http(s) origin>=<page path>`);
      continue;
    }

    const host = new URL(origin).host;
    if (admitted.has(host) || pagePaths.has(pagePath)) {
      console.error(`KENER_PUBLIC_ORIGINS: ignoring "${trimmed}"; its host or page is already admitted`);
      continue;
    }
    admitted.set(host, { origin, pagePath });
    pagePaths.add(pagePath);
  }
  return admitted;
}

function parseOrigin(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
  return url.origin;
}

let parsedFrom: string | undefined;
let parsed = new Map<string, PublicOrigin>();

// Re-parses only when the variable's value changes, so an invalid entry is logged once, not per request.
function admittedOrigins(): Map<string, PublicOrigin> {
  const raw = process.env.KENER_PUBLIC_ORIGINS ?? "";
  if (raw !== parsedFrom) {
    parsed = ParsePublicOrigins(raw);
    parsedFrom = raw;
  }
  return parsed;
}

/** The admitted origin a request's `Host` header names exactly, or null for any other host. */
export function PublicOriginForHost(host: string | null): PublicOrigin | null {
  if (!host) return null;
  return admittedOrigins().get(host.trim().toLowerCase()) ?? null;
}

/**
 * Keeps a page route to its own origin. On an admitted origin its page lives at the root, so
 * "/<page><rest>" moves there with a 308 to "<rest>", and any other page is not served. Off an admitted
 * origin this returns and the route behaves as upstream. The redirect is a path, never another host.
 */
export function GuardAdmittedPageRoute(
  publicOrigin: PublicOrigin | null | undefined,
  pagePath: string,
  rest: string,
  search = "",
): void {
  if (!publicOrigin) return;
  if (pagePath === publicOrigin.pagePath) {
    throw redirect(308, serverResolve(rest) + search);
  }
  throw error(404, "Page Not Found");
}

/**
 * Tags of every monitor the admitted page shows: its active monitors and the active members of its
 * groups, which the page expands inline, hidden ones included (the routes still decide who may see
 * those). Null when the page does not exist.
 */
export async function AdmittedPageMonitorTags(publicOrigin: PublicOrigin): Promise<Set<string> | null> {
  const page = await db.getPageByPath(publicOrigin.pagePath);
  if (!page) return null;
  return new Set(await GetPageShownMonitorTags(page.id, true));
}

/**
 * The admitted origin whose page shows every one of these monitors, for links built outside a request,
 * such as subscriber mail. Null when nothing is admitted, there are no monitors (a global event), or no
 * single admitted page shows them all; the caller then keeps the site URL.
 */
export async function PublicOriginForMonitors(monitorTags: string[]): Promise<PublicOrigin | null> {
  const admitted = [...admittedOrigins().values()];
  if (admitted.length === 0 || monitorTags.length === 0) return null;

  const matches: PublicOrigin[] = [];
  for (const candidate of admitted) {
    const shown = await AdmittedPageMonitorTags(candidate);
    if (shown && monitorTags.every((tag) => shown.has(tag))) matches.push(candidate);
  }
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Keeps a monitor's own routes (detail, feed, badges, embeds) on the origins that show it. On an admitted
 * origin a monitor its page does not show belongs to the site URL: see AnswerElsewhere. `path` is the
 * route's path for this monitor, built from route params, never from the request URL.
 */
export async function GuardAdmittedMonitor(
  publicOrigin: PublicOrigin | null | undefined,
  monitorTag: string,
  path: string,
  search = "",
): Promise<void> {
  if (!publicOrigin) return;
  const shown = await AdmittedPageMonitorTags(publicOrigin);
  if (shown?.has(monitorTag)) return;
  await AnswerElsewhere(publicOrigin, path, search);
}

/**
 * Keeps an incident or maintenance on the origins that show it: on an admitted origin, a global event or
 * one affecting a monitor its page shows. Any other event belongs to the site URL: see AnswerElsewhere.
 */
export async function GuardAdmittedEvent(
  publicOrigin: PublicOrigin | null | undefined,
  isGlobal: boolean,
  monitorTags: string[],
  path: string,
  search = "",
): Promise<void> {
  if (!publicOrigin || isGlobal) return;
  const shown = await AdmittedPageMonitorTags(publicOrigin);
  if (shown && monitorTags.some((tag) => shown.has(tag))) return;
  await AnswerElsewhere(publicOrigin, path, search);
}

/**
 * Sends content that is not the admitted page's to the same path on the configured site URL, with a
 * temporary redirect, because which page shows a monitor can change. The target host comes from site
 * settings, never from the request. Without a site URL, or when it names the admitted origin itself, the
 * content is not served here.
 */
async function AnswerElsewhere(publicOrigin: PublicOrigin, path: string, search: string): Promise<never> {
  const siteURL = (await db.getSiteDataByKey("siteURL"))?.value;
  let siteOrigin: string | null = null;
  try {
    siteOrigin = siteURL ? new URL(siteURL).origin : null;
  } catch {
    siteOrigin = null;
  }
  if (siteOrigin && siteOrigin !== publicOrigin.origin) {
    throw redirect(307, siteOrigin + serverResolve(path) + search);
  }
  throw error(404, "Not Found");
}

/**
 * The canonical URL of `rest` on a page that is an admitted origin's Home: on that origin, and on the
 * site URL's `/<page>` routes, which keep serving the page until the site's compatibility redirect.
 * Null for every other page, which keeps upstream's markup.
 */
export function AdmittedCanonicalURL(
  publicOrigin: PublicOrigin | null | undefined,
  pagePath: string,
  rest: string,
): string | null {
  const home = publicOrigin ?? [...admittedOrigins().values()].find((o) => o.pagePath === pagePath);
  return home ? home.origin + serverResolve(rest) : null;
}

/** What leads the shell on an admitted origin: the page's own identity, never the site's. */
export interface AdmittedIdentity {
  name: string;
  logo: string | undefined;
  favicon: string | undefined;
  metaTitle: string | undefined;
  metaDescription: string | undefined;
  socialPreviewImage: string | undefined;
}

/**
 * The admitted page's identity: its title and logo, the favicon of the brand bundle its logo comes from,
 * and its meta and social preview settings. Null when the page does not exist. Nothing falls back to the
 * site's name, logo or favicon; an unset value stays unset.
 */
export async function AdmittedOriginIdentity(publicOrigin: PublicOrigin): Promise<AdmittedIdentity | null> {
  const page = await db.getPageByPath(publicOrigin.pagePath);
  if (!page) return null;

  let settings: { metaPageTitle?: unknown; metaPageDescription?: unknown; socialPagePreviewImage?: unknown } = {};
  try {
    settings = JSON.parse(page.page_settings_json ?? "{}") ?? {};
  } catch {
    settings = {};
  }
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : undefined);
  return {
    name: page.page_title,
    logo: page.page_logo || undefined,
    favicon: BrandFavicon(page.page_logo),
    metaTitle: text(settings.metaPageTitle) ?? page.page_title,
    metaDescription: text(settings.metaPageDescription),
    socialPreviewImage: text(settings.socialPagePreviewImage),
  };
}

interface BrandManifest {
  assets?: Array<{
    role?: string;
    variants?: Array<{ appearance?: string; representations?: Array<{ format?: string; file?: { path?: string } }> }>;
  }>;
}

// The product brand bundles this fork vendors and serves at /brand/<id>/ (wolf/brand), read at build time
const brandManifests = import.meta.glob<BrandManifest>("/vendor/brand/*/manifest.json", {
  eager: true,
  import: "default",
});

/**
 * The SVG favicon of the brand bundle a logo is served from, in the logo's appearance: for
 * "/brand/<id>/assets/wordmark/on-dark.svg", that bundle's `icon.favicon` on-dark SVG. Undefined for a
 * logo outside a vendored bundle, or a bundle without a favicon.
 */
export function BrandFavicon(logo: string | null | undefined): string | undefined {
  const match = logo?.match(/^\/brand\/([a-z0-9-]+)\/assets\/[^/]+\/([^/]+)$/);
  if (!match) return undefined;
  const [, id, file] = match;
  const favicon = brandManifests[`/vendor/brand/${id}/manifest.json`]?.assets?.find((a) => a.role === "icon.favicon");
  const variants = favicon?.variants ?? [];
  const variant = variants.find((v) => v.appearance && file.startsWith(v.appearance)) ?? variants[0];
  const path = variant?.representations?.find((r) => r.format === "svg")?.file?.path;
  return path ? `/brand/${id}/${path}` : undefined;
}

/**
 * Site URL for a subscriber mail about an incident or maintenance, shaped as siteDataToVariables builds
 * it (base path and trailing slash): the admitted origin whose page shows all of its monitors, else
 * `siteUrl`. A global event, or a failed lookup, keeps `siteUrl`; the mail must not be lost to it.
 */
export async function SubscriberMailSiteURL(
  siteUrl: string,
  isGlobal: boolean,
  monitorTags: string[],
): Promise<string> {
  if (isGlobal) return siteUrl;
  try {
    const publicOrigin = await PublicOriginForMonitors(monitorTags);
    return publicOrigin ? publicOrigin.origin + serverResolve("/") : siteUrl;
  } catch (err) {
    console.error("Error choosing the public origin for a subscriber mail:", err);
    return siteUrl;
  }
}
