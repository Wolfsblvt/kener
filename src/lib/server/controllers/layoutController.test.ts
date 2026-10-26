import { beforeAll, describe, expect, it, vi } from "vitest";
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

import db from "$lib/server/db/db";
import { GetLayoutServerData, NavItemsForOrigin } from "./layoutController";

const migrations = import.meta.glob<Knex.Migration>("/migrations/*.ts", { eager: true });
const knex = (db as unknown as { knex: Knex }).knex;
const anonymous = { get: () => undefined } as unknown as Cookies;

beforeAll(async () => {
  await knex.migrate.latest({
    migrationSource: {
      getMigrations: async () => Object.keys(migrations).sort(),
      getMigrationName: (name: string) => name,
      getMigration: async (name: string) => migrations[name],
    },
  });
});

async function eventListPlacementFor(settings: object) {
  await knex("site_data").where({ key: "eventDisplaySettings" }).del();
  await knex("site_data").insert({
    key: "eventDisplaySettings",
    value: JSON.stringify(settings),
    data_type: "object",
  });
  const layout = await GetLayoutServerData(anonymous, new Request("http://localhost/"));
  return layout.eventDisplaySettings.eventListPlacement;
}

describe("GetLayoutServerData eventListPlacement", () => {
  it("returns the saved placement", async () => {
    expect(await eventListPlacementFor({ showInlineEvents: true, eventListPlacement: "button" })).toBe("button");
    expect(await eventListPlacementFor({ showInlineEvents: false, eventListPlacement: "aside" })).toBe("aside");
  });

  it("derives the placement for settings saved before it existed", async () => {
    expect(await eventListPlacementFor({ showInlineEvents: true })).toBe("aside");
    expect(await eventListPlacementFor({ showInlineEvents: false })).toBe("button");
  });
});

describe("NavItemsForOrigin", () => {
  const nav = [
    { name: "Wolfsblvt Works", url: "https://wolfsblvt.works", iconURL: "" },
    { name: "diffdevil status", url: "https://status.diffdevil.dev", iconURL: "" },
    { name: "diffdevil", url: "https://diffdevil.dev", iconURL: "", page: "diffdevil" },
    { name: "All status", url: "https://status.wolfsblvt.works", iconURL: "", page: "diffdevil" },
  ];
  const origin = (pagePath: string) => ({ origin: `https://status.${pagePath}.example`, pagePath });

  it("shows the site URL only the items without a page", () => {
    expect(NavItemsForOrigin(nav, null).map((item) => item.name)).toEqual(["Wolfsblvt Works", "diffdevil status"]);
  });

  it("shows an admitted origin its own page's items, in source order and without the page field", () => {
    expect(NavItemsForOrigin(nav, origin("diffdevil"))).toEqual([
      { name: "diffdevil", url: "https://diffdevil.dev", iconURL: "" },
      { name: "All status", url: "https://status.wolfsblvt.works", iconURL: "" },
    ]);
  });

  it("keeps the site's items on an admitted origin that has none of its own", () => {
    expect(NavItemsForOrigin(nav, origin("other")).map((item) => item.name)).toEqual([
      "Wolfsblvt Works",
      "diffdevil status",
    ]);
    expect(NavItemsForOrigin(undefined, origin("other"))).toEqual([]);
  });
});

describe("GetLayoutServerData shell identity", () => {
  it("names a vendored lockup logo and leaves page-owned nav items off the site URL", async () => {
    await knex("site_data").whereIn("key", ["logo", "nav"]).del();
    await knex("site_data").insert([
      { key: "logo", value: "/brand/works/assets/lockup-compact/on-dark.svg", data_type: "string" },
      {
        key: "nav",
        value: JSON.stringify([
          { name: "Wolfsblvt Works", url: "https://wolfsblvt.works", iconURL: "" },
          { name: "All status", url: "https://status.wolfsblvt.works", iconURL: "", page: "diffdevil" },
        ]),
        data_type: "object",
      },
    ]);
    const layout = await GetLayoutServerData(anonymous, new Request("http://localhost/"));
    expect(layout.logoName).toBe("Wolfsblvt Works");
    expect(layout.originPagePath).toBeNull();
    expect(layout.navItems.map((item) => item.name)).toEqual(["Wolfsblvt Works"]);
  });
});
