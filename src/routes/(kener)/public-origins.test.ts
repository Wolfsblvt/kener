import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Knex } from "knex";
import type { Cookies } from "@sveltejs/kit";

vi.mock("$lib/server/db/db", async () => {
  const { default: DbImpl } = await import("$lib/server/db/dbimpl");
  return {
    default: new DbImpl({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true }),
  };
});

vi.mock("$lib/server/cache/cache", () => ({
  getCache: async (_key: string, fetcher?: () => unknown) => (fetcher ? await fetcher() : null),
  setCache: async () => {},
  deleteCache: async () => {},
}));

const { subscriberQueue } = vi.hoisted(() => ({ subscriberQueue: { push: vi.fn() } }));
vi.mock("$lib/server/queues/subscriberQueue", () => ({ default: subscriberQueue }));

import db from "$lib/server/db/db";
import { GetLayoutServerData } from "$lib/server/controllers/layoutController";
import { AddIncidentComment } from "$lib/server/controllers/incidentController";
import { CreateMaintenanceEventWithNotification } from "$lib/server/controllers/maintenanceController";
import { PublicOriginForHost } from "$lib/server/publicOrigins";
import type { SubscriptionVariableMap } from "$lib/server/notification/types";
import eventsByMonth from "$lib/server/api-server/events-by-month/post";
import { GetNowTimestampUTC } from "$lib/server/tool";
import { load as loadRootPage } from "./+page.server";
import { load as loadNamedPage } from "./[page_path]/+page.server";
import { load as loadNamedPageEvents } from "./[page_path]/events/[MMMM]-[YYYY]/+page.server";
import { GET as rootFeed } from "./rss.xml/+server";
import { GET as namedPageFeed } from "./[page_path]/rss.xml/+server";
import { GET as monitorFeed } from "./monitors/[monitor_tag]/rss.xml/+server";
import { GET as sitemap } from "./sitemap.xml/+server";
import { GET as robots } from "./robots.txt/+server";
import { load as loadRootEvents } from "./events/[MMMM]-[YYYY]/+page.server";
import { load as loadMonitorPage } from "./monitors/[monitor_tag]/+page.server";
import { load as loadIncidentPage } from "./incidents/[incident_id]/+page.server";
import { load as loadMaintenancePage } from "./maintenances/[maintenance_id]/+page.server";
import { GET as statusBadge } from "./badge/[tag]/status/+server";
import { load as loadMonitorEmbed } from "../(embed)/embed/monitor-[tag]/+page.server";
import { load as loadLiveEventsEmbed } from "../(embed)/embed/events/live/+page.server";
import subscriptionPost from "$lib/server/api-server/subscription/post";

const migrations = import.meta.glob<Knex.Migration>("/migrations/*.ts", { eager: true });
const knex = (db as unknown as { knex: Knex }).knex;
const anonymous = { get: () => undefined } as unknown as Cookies;

const PORTFOLIO = "https://status.portfolio.example";
const PRODUCT = "https://status.product.example";
const HOST = { portfolio: "status.portfolio.example", product: "status.product.example", unknown: "evil.example" };

let productIncidentId: number;
let portfolioIncidentId: number;

// What hooks.server.ts puts in locals for a request with this Host header
const localsFor = (host: string) => ({ publicOrigin: PublicOriginForHost(host) }) as App.Locals;

// Runs a loader or handler that may throw a SvelteKit redirect or error, and reports what it produced
async function outcome(call: () => unknown): Promise<{ status: number; location?: string; body?: unknown }> {
  try {
    const result = await call();
    if (result instanceof Response) return { status: result.status, body: await result.text() };
    return { status: 200, body: result };
  } catch (e) {
    const thrown = e as { status: number; location?: string };
    return { status: thrown.status, location: thrown.location };
  }
}

const layoutFor = (host: string) =>
  GetLayoutServerData(anonymous, new Request("http://localhost/"), localsFor(host).publicOrigin);
const rootPage = async (host: string) =>
  outcome(async () =>
    loadRootPage({ parent: () => layoutFor(host), locals: localsFor(host) } as unknown as Parameters<
      typeof loadRootPage
    >[0]),
  );
const namedPage = (host: string, page_path: string) =>
  outcome(() =>
    loadNamedPage({
      params: { page_path },
      parent: () => layoutFor(host),
      locals: localsFor(host),
      url: new URL(`http://localhost/${page_path}?ref=x`),
    } as unknown as Parameters<typeof loadNamedPage>[0]),
  );
// The three feed handlers take differently typed events; each reads only params and locals
const feed = (host: string, handler: (event: never) => unknown, params = {}) =>
  outcome(() => handler({ params, locals: localsFor(host) } as never));
const sitemapFor = (host: string) =>
  outcome(() => sitemap({ locals: localsFor(host) } as unknown as Parameters<typeof sitemap>[0]));
const eventsFor = async (host: string, page_path: string) => {
  const now = GetNowTimestampUTC();
  const response = await eventsByMonth({
    action: "events-by-month",
    query: new URLSearchParams({ page_path }),
    cookies: anonymous,
    headers: new Headers(),
    body: { start_ts: now - 86400, end_ts: now + 86400 },
    publicOrigin: localsFor(host).publicOrigin,
  });
  return ((await response.json()) as { incidents: Array<{ id: number }> }).incidents.map((i) => i.id).sort();
};

const monitorTagsOf = (result: { body?: unknown }) => (result.body as { monitorTags: string[] }).monitorTags.sort();

beforeAll(async () => {
  vi.stubEnv("KENER_PUBLIC_ORIGINS", `${PRODUCT}=product`);
  await knex.migrate.latest({
    migrationSource: {
      getMigrations: async () => Object.keys(migrations).sort(),
      getMigrationName: (name: string) => name,
      getMigration: async (name: string) => migrations[name],
    },
  });
  await knex("site_data").insert([
    { key: "siteURL", value: PORTFOLIO, data_type: "string" },
    { key: "siteName", value: "Portfolio", data_type: "string" },
    { key: "colors", value: JSON.stringify({ UP: "#0f0", DOWN: "#f00", DEGRADED: "#ff0" }), data_type: "object" },
    {
      key: "globalMaintenanceNotificationSettings",
      value: JSON.stringify({
        event_types: { created: true, ended: true, reminder: true, started: true },
        reminder_buffer_hours: 1,
      }),
      data_type: "object",
    },
  ]);

  const monitor = (tag: string) => ({
    tag,
    name: tag,
    status: "ACTIVE",
    is_hidden: "NO",
    monitor_type: "NONE",
    type_data: "{}",
  });
  await knex("monitors").insert(["portfolio-site", "product-site", "product-docs", "other-api"].map(monitor));
  const pages = {
    "": ["portfolio-site", "product-site"],
    product: ["product-site", "product-docs"],
    other: ["other-api"],
  };
  for (const [page_path, tags] of Object.entries(pages)) {
    const [pageId] = (
      await knex("pages").insert({ page_path, page_title: page_path || "Home", page_header: "h" }, ["id"])
    ).map((r: { id: number }) => r.id);
    await knex("pages_monitors").insert(
      tags.map((monitor_tag, position) => ({ page_id: pageId, monitor_tag, position })),
    );
  }

  const now = GetNowTimestampUTC();
  const incidentOn = async (title: string, tags: string[]) => {
    const [id] = (
      await knex("incidents").insert(
        { title, start_date_time: now - 600, is_global: "NO", incident_type: "INCIDENT", status: "OPEN" },
        ["id"],
      )
    ).map((r: { id: number }) => r.id);
    await knex("incident_monitors").insert(
      tags.map((monitor_tag) => ({ incident_id: id, monitor_tag, monitor_impact: "DOWN" })),
    );
    return id;
  };
  productIncidentId = await incidentOn("Product docs down", ["product-docs"]);
  portfolioIncidentId = await incidentOn("Portfolio site down", ["portfolio-site"]);
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("status page routes by Host", () => {
  it("serves the admitted page at / on its origin, and the home page elsewhere", async () => {
    expect(monitorTagsOf(await rootPage(HOST.product))).toEqual(["product-docs", "product-site"]);
    expect(monitorTagsOf(await rootPage(HOST.portfolio))).toEqual(["portfolio-site", "product-site"]);
    expect(monitorTagsOf(await rootPage(HOST.unknown))).toEqual(["portfolio-site", "product-site"]);
  });

  it("moves the admitted page's own path to / and serves no other page on its origin", async () => {
    expect(await namedPage(HOST.product, "product")).toEqual({ status: 308, location: "/?ref=x" });
    expect((await namedPage(HOST.product, "other")).status).toBe(404);
    expect(
      await outcome(() =>
        loadNamedPageEvents({
          params: { page_path: "product", MMMM: "October", YYYY: "2026" },
          parent: async () => ({}),
          locals: localsFor(HOST.product),
          url: new URL("http://localhost/product/events/October-2026"),
        } as unknown as Parameters<typeof loadNamedPageEvents>[0]),
      ),
    ).toEqual({ status: 308, location: "/events/October-2026" });
  });

  it("keeps every page reachable by path on the site URL and on an unknown host", async () => {
    for (const host of [HOST.portfolio, HOST.unknown]) {
      expect(monitorTagsOf(await namedPage(host, "product"))).toEqual(["product-docs", "product-site"]);
      expect(monitorTagsOf(await namedPage(host, "other"))).toEqual(["other-api"]);
    }
  });

  it("gives the layout the request's public origin and makes its page exclusive", async () => {
    const product = await layoutFor(HOST.product);
    expect(product.siteUrl).toBe(PRODUCT);
    expect(product.globalPageVisibilitySettings).toMatchObject({ showSwitcher: false, forceExclusivity: true });

    for (const host of [HOST.portfolio, HOST.unknown]) {
      const layout = await layoutFor(host);
      expect(layout.siteUrl).toBe(PORTFOLIO);
      expect(layout.globalPageVisibilitySettings).toMatchObject({ showSwitcher: true, forceExclusivity: false });
    }
  });

  it("limits the events list to the admitted page, whatever page_path the client sends", async () => {
    expect(await eventsFor(HOST.product, "undefined")).toEqual([productIncidentId]);
    expect(await eventsFor(HOST.product, "other")).toEqual([productIncidentId]);
    expect(await eventsFor(HOST.portfolio, "undefined")).toEqual([productIncidentId, portfolioIncidentId].sort());
  });
});

describe("absolute links by Host", () => {
  it("builds the root feed for the admitted page with the admitted origin", async () => {
    const xml = (await feed(HOST.product, rootFeed)).body as string;
    expect(xml).toContain(`<link>${PRODUCT}</link>`);
    expect(xml).toContain(`href="${PRODUCT}/rss.xml"`);
    expect(xml).toContain(`${PRODUCT}/incidents/${productIncidentId}`);
    expect(xml).not.toContain(`/incidents/${portfolioIncidentId}`);
    expect(xml).not.toContain(PORTFOLIO);
  });

  it("keeps the site URL in feeds for the site URL and an unknown host", async () => {
    for (const host of [HOST.portfolio, HOST.unknown]) {
      const xml = (await feed(host, rootFeed)).body as string;
      expect(xml).toContain(`${PORTFOLIO}/incidents/${productIncidentId}`);
      expect(xml).toContain(`${PORTFOLIO}/incidents/${portfolioIncidentId}`);
      expect(xml).not.toContain(PRODUCT);
    }
  });

  it("moves the admitted page's named feed to /rss.xml and uses the origin in monitor feeds", async () => {
    expect(await feed(HOST.product, namedPageFeed, { page_path: "product" })).toEqual({
      status: 308,
      location: "/rss.xml",
    });
    expect((await feed(HOST.product, namedPageFeed, { page_path: "other" })).status).toBe(404);
    const monitorXml = (await feed(HOST.product, monitorFeed, { monitor_tag: "product-docs" })).body as string;
    expect(monitorXml).toContain(`${PRODUCT}/incidents/${productIncidentId}`);
    expect(monitorXml).not.toContain(PORTFOLIO);
  });

  it("lists only the admitted page's URLs, on its origin, in its sitemap", async () => {
    const locs = [...((await sitemapFor(HOST.product)).body as string).matchAll(/<loc>(.*)<\/loc>/g)].map((m) => m[1]);
    expect(locs.slice(0, 3)).toEqual([
      `${PRODUCT}/`,
      `${PRODUCT}/monitors/product-site`,
      `${PRODUCT}/monitors/product-docs`,
    ]);
    expect(locs.slice(3).every((loc) => loc.startsWith(`${PRODUCT}/events/`))).toBe(true);

    const portfolio = (await sitemapFor(HOST.portfolio)).body as string;
    expect(portfolio).toContain(`${PORTFOLIO}/other`);
    expect(portfolio).not.toContain(PRODUCT);
  });

  it("keeps each of many interleaved requests on its own origin", async () => {
    const hosts = Array.from({ length: 12 }, (_, i) => Object.values(HOST)[i % 3]);
    const results = await Promise.all(
      hosts.map(async (host) => ({
        host,
        siteUrl: (await layoutFor(host)).siteUrl,
        xml: (await feed(host, rootFeed)).body as string,
      })),
    );
    for (const { host, siteUrl, xml } of results) {
      const expected = host === HOST.product ? PRODUCT : PORTFOLIO;
      expect(siteUrl).toBe(expected);
      expect(xml).toContain(`<link>${expected}</link>`);
      expect(xml).not.toContain(expected === PRODUCT ? PORTFOLIO : PRODUCT);
    }
  });
});

describe("subscriber mail links outside a request", () => {
  const sent = () => subscriberQueue.push.mock.calls.map(([variables]) => variables as SubscriptionVariableMap);

  beforeEach(() => subscriberQueue.push.mockClear());

  it.each([
    { title: "only the admitted page's monitors", tags: ["product-docs"], is_global: "NO", origin: PRODUCT },
    {
      title: "monitors shown on the admitted page and the home page",
      tags: ["product-site"],
      is_global: "NO",
      origin: PRODUCT,
    },
    { title: "monitors across pages", tags: ["product-docs", "portfolio-site"], is_global: "NO", origin: PORTFOLIO },
    { title: "a global incident", tags: ["product-docs"], is_global: "YES", origin: PORTFOLIO },
  ])("links an incident with $title to its origin", async ({ tags, is_global, origin }) => {
    const [id] = (await knex("incidents").insert({ title: "t", start_date_time: 1000, is_global }, ["id"])).map(
      (r: { id: number }) => r.id,
    );
    await knex("incident_monitors").insert(
      tags.map((monitor_tag) => ({ incident_id: id, monitor_tag, monitor_impact: "DOWN" })),
    );
    await AddIncidentComment(id, "Looking into it", "INVESTIGATING", 1100);
    expect(sent().map((v) => [v.site_url, v.cta_url])).toEqual([[`${origin}/`, `${origin}/incidents/${id}`]]);
  });

  it("links a maintenance on the admitted page's monitors to its origin", async () => {
    const [id] = (
      await knex("maintenances").insert(
        {
          title: "Docs upgrade",
          start_date_time: 1000,
          rrule: "FREQ=DAILY;COUNT=1",
          duration_seconds: 60,
          is_global: "NO",
        },
        ["id"],
      )
    ).map((r: { id: number }) => r.id);
    await knex("maintenance_monitors").insert({ maintenance_id: id, monitor_tag: "product-docs" });
    await CreateMaintenanceEventWithNotification(id, 2000, 2060, "Docs upgrade", null);
    expect(sent().map((v) => [v.site_url, v.cta_url])).toEqual([[`${PRODUCT}/`, `${PRODUCT}/maintenances/${id}`]]);
  });
});

describe("the admitted page as the product's own Home", () => {
  let globalIncidentId: number;
  let portfolioMaintenanceEventId: number;

  // A loader event for `path` on `host`; each loader below reads only some of these
  const pageEvent = (host: string, path: string, params: Record<string, string>) =>
    ({
      params,
      url: new URL(`http://localhost${path}`),
      locals: localsFor(host),
      parent: () => layoutFor(host),
    }) as never;
  const monitorPage = (host: string, monitor_tag: string) =>
    outcome(() => loadMonitorPage(pageEvent(host, `/monitors/${monitor_tag}`, { monitor_tag })));
  const incidentPage = (host: string, id: number) =>
    outcome(() => loadIncidentPage(pageEvent(host, `/incidents/${id}`, { incident_id: String(id) })));
  const badge = (host: string, tag: string) =>
    outcome(() =>
      statusBadge({
        params: { tag },
        url: new URL(`http://localhost/badge/${tag}/status?style=flat`),
        locals: localsFor(host),
      } as never),
    );
  const liveEmbed = async (host: string, tags: string) => {
    const data = (await loadLiveEventsEmbed(pageEvent(host, `/embed/events/live?tags=${tags}`, {}))) as {
      incidents: Array<{ id: number }>;
    };
    return data.incidents.map((i) => i.id).sort();
  };
  const subscribe = async (host: string) => {
    try {
      const response = await subscriptionPost({
        action: "subscription",
        query: new URLSearchParams(),
        cookies: anonymous,
        headers: new Headers(),
        body: { action: "no-such-action" },
        publicOrigin: localsFor(host).publicOrigin,
      });
      return { status: response.status, message: "" };
    } catch (e) {
      const thrown = e as { status: number; body: { message: string } };
      return { status: thrown.status, message: thrown.body.message };
    }
  };
  const robotsFor = async (host: string) => (await robots({ locals: localsFor(host) } as never)).text();
  const canonicalOf = (result: { body?: unknown }) => (result.body as { canonicalUrl: string | null }).canonicalUrl;

  beforeAll(async () => {
    await knex("site_data").insert([
      { key: "logo", value: "/brand/works/assets/lockup-compact/on-dark.svg", data_type: "string" },
      { key: "favicon", value: "/brand/works/assets/icon-favicon/on-dark.svg", data_type: "string" },
      { key: "metaSiteTitle", value: "Portfolio status", data_type: "string" },
      {
        key: "subscriptionsSettings",
        value: JSON.stringify({ enable: true, methods: { emails: { incidents: true, maintenances: true } } }),
        data_type: "object",
      },
    ]);
    await knex("pages")
      .where({ page_path: "product" })
      .update({
        page_title: "Product status",
        page_logo: "/brand/diffdevil/assets/wordmark/on-dark.svg",
        page_settings_json: JSON.stringify({ metaPageDescription: "How the product is doing." }),
      });

    // A group on the product page whose member the page shows only inside the group
    const monitor = { status: "ACTIVE", is_hidden: "NO" };
    await knex("monitors").insert([
      { ...monitor, tag: "product-api", name: "product-api", monitor_type: "NONE", type_data: "{}" },
      {
        ...monitor,
        tag: "product-group",
        name: "product-group",
        monitor_type: "GROUP",
        type_data: JSON.stringify({ monitors: [{ tag: "product-api" }], executionDelay: 1000 }),
      },
    ]);
    const productPage = await knex("pages").where({ page_path: "product" }).first();
    await knex("pages_monitors").insert({ page_id: productPage.id, monitor_tag: "product-group", position: 9 });

    const now = GetNowTimestampUTC();
    [globalIncidentId] = (
      await knex("incidents").insert(
        {
          title: "Everything",
          start_date_time: now - 600,
          is_global: "YES",
          incident_type: "INCIDENT",
          status: "OPEN",
        },
        ["id"],
      )
    ).map((r: { id: number }) => r.id);

    const [maintenanceId] = (
      await knex("maintenances").insert(
        {
          title: "Portfolio move",
          start_date_time: 1000,
          rrule: "FREQ=DAILY;COUNT=1",
          duration_seconds: 60,
          is_global: "NO",
        },
        ["id"],
      )
    ).map((r: { id: number }) => r.id);
    await knex("maintenance_monitors").insert({ maintenance_id: maintenanceId, monitor_tag: "portfolio-site" });
    [portfolioMaintenanceEventId] = (
      await knex("maintenances_events").insert(
        { maintenance_id: maintenanceId, start_date_time: 1000, end_date_time: 1060, status: "COMPLETED" },
        ["id"],
      )
    ).map((r: { id: number }) => r.id);
  });

  it("leads the shell with the page's title, logo, bundle favicon and meta, never the site's", async () => {
    expect(await layoutFor(HOST.product)).toMatchObject({
      siteName: "Product status",
      isProductHome: true,
      logo: "/brand/diffdevil/assets/wordmark/on-dark.svg",
      favicon: "/brand/diffdevil/assets/icon-favicon/on-dark.svg",
      metaSiteTitle: "Product status",
      metaSiteDescription: "How the product is doing.",
      socialPreviewImage: undefined,
    });
    for (const host of [HOST.portfolio, HOST.unknown]) {
      expect(await layoutFor(host)).toMatchObject({
        siteName: "Portfolio",
        isProductHome: false,
        logo: "/brand/works/assets/lockup-compact/on-dark.svg",
        favicon: "/brand/works/assets/icon-favicon/on-dark.svg",
        metaSiteTitle: "Portfolio status",
      });
    }
  });

  it("names its feed after the page", async () => {
    expect((await feed(HOST.product, rootFeed)).body).toContain("<title>Product status — Incidents &amp; Maintenance");
    expect((await feed(HOST.portfolio, rootFeed)).body).toContain("<title>Portfolio — Incidents &amp; Maintenance");
  });

  it("offers and accepts subscriptions only off an admitted origin", async () => {
    expect((await layoutFor(HOST.product)).isSubsEnabled).toBe(false);
    expect(await subscribe(HOST.product)).toEqual({
      status: 400,
      message: "Subscriptions are not available on this status page",
    });
    for (const host of [HOST.portfolio, HOST.unknown]) {
      expect((await layoutFor(host)).isSubsEnabled).toBe(true);
      // The request reaches the subscription actions, which reject this one
      expect(await subscribe(host)).toEqual({ status: 400, message: "Invalid action" });
    }
  });

  it("serves the page's monitors, group members included, and sends any other monitor to the site URL", async () => {
    for (const tag of ["product-docs", "product-site", "product-group", "product-api"]) {
      expect((await monitorPage(HOST.product, tag)).status).toBe(200);
    }
    expect(await monitorPage(HOST.product, "other-api")).toEqual({
      status: 307,
      location: `${PORTFOLIO}/monitors/other-api`,
    });
    expect(await feed(HOST.product, monitorFeed, { monitor_tag: "portfolio-site" })).toEqual({
      status: 307,
      location: `${PORTFOLIO}/monitors/portfolio-site/rss.xml`,
    });
    expect((await badge(HOST.product, "product-docs")).status).toBe(200);
    expect(await badge(HOST.product, "other-api")).toEqual({
      status: 307,
      location: `${PORTFOLIO}/badge/other-api/status?style=flat`,
    });
    // "_" is every monitor of the instance: the site's, not the product's
    expect(await badge(HOST.product, "_")).toEqual({
      status: 307,
      location: `${PORTFOLIO}/badge/_/status?style=flat`,
    });
    expect(
      await outcome(() =>
        loadMonitorEmbed(pageEvent(HOST.product, "/embed/monitor-other-api?theme=dark", { tag: "other-api" })),
      ),
    ).toEqual({ status: 307, location: `${PORTFOLIO}/embed/monitor-other-api?theme=dark` });
  });

  it("serves global events and the page's events, and sends any other event to the site URL", async () => {
    expect((await incidentPage(HOST.product, productIncidentId)).status).toBe(200);
    expect((await incidentPage(HOST.product, globalIncidentId)).status).toBe(200);
    expect(await incidentPage(HOST.product, portfolioIncidentId)).toEqual({
      status: 307,
      location: `${PORTFOLIO}/incidents/${portfolioIncidentId}`,
    });
    const path = `/maintenances/${portfolioMaintenanceEventId}`;
    const maintenance = await outcome(() =>
      loadMaintenancePage(
        pageEvent(HOST.product, `${path}?ref=x`, { maintenance_id: String(portfolioMaintenanceEventId) }),
      ),
    );
    expect(maintenance).toEqual({ status: 307, location: `${PORTFOLIO}${path}?ref=x` });

    // A foreign tag is dropped: asked only for it, the embed falls back to global events
    const foreignOnly = await liveEmbed(HOST.product, "portfolio-site");
    expect(foreignOnly).toContain(globalIncidentId);
    expect(foreignOnly).not.toContain(portfolioIncidentId);
    const mixed = await liveEmbed(HOST.product, "product-docs,portfolio-site");
    expect(mixed).toContain(productIncidentId);
    expect(mixed).not.toContain(portfolioIncidentId);
    expect(await liveEmbed(HOST.portfolio, "portfolio-site")).toContain(portfolioIncidentId);
  });

  it("serves every monitor and event on the site URL and an unknown host, as upstream", async () => {
    for (const host of [HOST.portfolio, HOST.unknown]) {
      expect((await monitorPage(host, "other-api")).status).toBe(200);
      expect((await incidentPage(host, portfolioIncidentId)).status).toBe(200);
      expect((await badge(host, "other-api")).status).toBe(200);
    }
  });

  it("refuses foreign content when the site URL is unset or is the admitted origin itself", async () => {
    for (const value of [PRODUCT, ""]) {
      await knex("site_data").where({ key: "siteURL" }).update({ value });
      try {
        expect((await monitorPage(HOST.product, "other-api")).status).toBe(404);
      } finally {
        await knex("site_data").where({ key: "siteURL" }).update({ value: PORTFOLIO });
      }
    }
  });

  it("names the admitted origin canonical, on its own host and on the site URL's page routes", async () => {
    expect(canonicalOf(await rootPage(HOST.product))).toBe(`${PRODUCT}/`);
    expect(canonicalOf(await namedPage(HOST.portfolio, "product"))).toBe(`${PRODUCT}/`);
    expect(canonicalOf(await namedPage(HOST.portfolio, "other"))).toBeNull();
    expect(canonicalOf(await rootPage(HOST.portfolio))).toBeNull();

    const month = { MMMM: "October", YYYY: "2026" };
    const rootEvents = (host: string) => outcome(() => loadRootEvents(pageEvent(host, "/events/October-2026", month)));
    const pageEvents = (host: string) =>
      outcome(() =>
        loadNamedPageEvents(pageEvent(host, "/product/events/October-2026", { ...month, page_path: "product" })),
      );
    expect(canonicalOf(await rootEvents(HOST.product))).toBe(`${PRODUCT}/events/October-2026`);
    expect(canonicalOf(await pageEvents(HOST.portfolio))).toBe(`${PRODUCT}/events/October-2026`);
    expect(canonicalOf(await rootEvents(HOST.portfolio))).toBeNull();
  });

  it("names each host's own sitemap in robots.txt, and none when the sitemap is off", async () => {
    expect(await robotsFor(HOST.product)).toContain(`\nSitemap: ${PRODUCT}/sitemap.xml\n`);
    expect(await robotsFor(HOST.portfolio)).toContain(`\nSitemap: ${PORTFOLIO}/sitemap.xml\n`);
    expect(await robotsFor(HOST.portfolio)).toContain("Disallow: /manage/");

    await knex("site_data").insert({
      key: "sitemap",
      value: JSON.stringify({ mode: "off", urls: [] }),
      data_type: "object",
    });
    try {
      for (const host of Object.values(HOST)) {
        const text = await robotsFor(host);
        expect(text).not.toContain("Sitemap:");
        expect(text).not.toContain("kener.ing");
      }
    } finally {
      await knex("site_data").where({ key: "sitemap" }).del();
    }
  });

  it("keeps identity and content on each of many interleaved requests' own origin", async () => {
    const hosts = Array.from({ length: 12 }, (_, i) => Object.values(HOST)[i % 3]);
    const results = await Promise.all(
      hosts.map(async (host) => ({
        host,
        siteName: (await layoutFor(host)).siteName,
        foreignMonitor: (await monitorPage(host, "other-api")).status,
      })),
    );
    for (const { host, siteName, foreignMonitor } of results) {
      expect(siteName).toBe(host === HOST.product ? "Product status" : "Portfolio");
      expect(foreignMonitor).toBe(host === HOST.product ? 307 : 200);
    }
  });
});

describe("without KENER_PUBLIC_ORIGINS", () => {
  beforeAll(() => vi.stubEnv("KENER_PUBLIC_ORIGINS", ""));
  afterAll(() => vi.stubEnv("KENER_PUBLIC_ORIGINS", `${PRODUCT}=product`));

  it("serves the product host exactly as any other host, with the site URL", async () => {
    expect(monitorTagsOf(await rootPage(HOST.product))).toEqual(["portfolio-site", "product-site"]);
    expect((await layoutFor(HOST.product)).siteUrl).toBe(PORTFOLIO);
    expect(monitorTagsOf(await namedPage(HOST.product, "other"))).toEqual(["other-api"]);
    expect((await feed(HOST.product, rootFeed)).body as string).not.toContain(PRODUCT);
  });

  it("keeps the site's identity, every monitor and subscriptions on the product host", async () => {
    expect(await layoutFor(HOST.product)).toMatchObject({
      siteName: "Portfolio",
      isProductHome: false,
      isSubsEnabled: true,
    });
    const event = {
      params: { monitor_tag: "other-api" },
      url: new URL("http://localhost/monitors/other-api"),
      locals: localsFor(HOST.product),
      parent: () => layoutFor(HOST.product),
    } as never;
    expect((await outcome(() => loadMonitorPage(event))).status).toBe(200);
  });

  it("keeps the site URL in subscriber mail", async () => {
    subscriberQueue.push.mockClear();
    await AddIncidentComment(productIncidentId, "Update", "IDENTIFIED", GetNowTimestampUTC());
    expect(sent()[0].cta_url).toBe(`${PORTFOLIO}/incidents/${productIncidentId}`);
  });

  const sent = () => subscriberQueue.push.mock.calls.map(([variables]) => variables as SubscriptionVariableMap);
});
