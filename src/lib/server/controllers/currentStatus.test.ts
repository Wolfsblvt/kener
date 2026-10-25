import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Knex } from "knex";

// The shared current-status path behind the /badge/<tag>/status, /badge/<tag>/dot and /badge/_/… routes, run against
// the real monitor and monitoring-data reads: in-memory SQLite, or the engine in TEST_DATABASE_URL. The cache passes
// through to its fetcher, as on a cache miss.
vi.mock("$lib/server/db/db", async () => {
  const { CreateTestDb } = await import("$lib/server/db/testDatabase");
  return { default: await CreateTestDb() };
});

vi.mock("$lib/server/cache/cache", () => ({
  getCache: async (_key: string, fetcher?: () => unknown) => (fetcher ? await fetcher() : null),
  setCache: async () => {},
  deleteCache: async () => {},
}));

import db from "$lib/server/db/db";
import StatusColor from "$lib/color";
import { GetBadge, GetLatestStatusActiveAll } from "./monitorsController";
import { GET as dotBadge } from "../../../routes/(kener)/badge/[tag]/dot/+server";

const migrations = import.meta.glob<Knex.Migration>("/migrations/*.ts", { eager: true });
const knex = (db as unknown as { knex: Knex }).knex;

const NOW = 1_800_000_000 - (1_800_000_000 % 60);

beforeAll(async () => {
  await knex.migrate.latest({
    migrationSource: {
      getMigrations: async () => Object.keys(migrations).sort(),
      getMigrationName: (name: string) => name,
      getMigration: async (name: string) => migrations[name],
    },
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW * 1000 + 30_000);
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  await knex("monitoring_data").del();
  await knex("monitors").del();
});

interface MonitorState {
  tag: string;
  /** Status of the latest result; omit for a monitor that has written no result. */
  status?: string;
  /** Minutes before the current minute that the latest result was written. Defaults to 1. */
  ageMinutes?: number;
  active?: boolean;
  hidden?: boolean;
}

async function seed(monitors: MonitorState[]) {
  for (const m of monitors) {
    await knex("monitors").insert({
      tag: m.tag,
      name: m.tag,
      status: m.active === false ? "INACTIVE" : "ACTIVE",
      is_hidden: m.hidden ? "YES" : "NO",
      monitor_type: "API",
      cron: "* * * * *",
      type_data: "{}",
    });
    if (m.status) {
      await knex("monitoring_data").insert({
        monitor_tag: m.tag,
        timestamp: NOW - (m.ageMinutes ?? 1) * 60,
        status: m.status,
        latency: 50,
        type: "REALTIME",
      });
    }
  }
}

const statusBadgeText = async (tag: string) => await (await GetBadge("status", { tag })).text();

const dotFill = async (tag: string) => {
  const response = await dotBadge({ params: { tag }, url: new URL(`http://localhost/badge/${tag}/dot`) } as never);
  return /fill="([^"]+)"/.exec(await response.text())?.[1];
};

describe("all-monitors current status", () => {
  it("is operational only when every monitor is currently up", async () => {
    await seed([
      { tag: "a", status: "UP" },
      { tag: "b", status: "UP" },
    ]);
    expect(await GetLatestStatusActiveAll()).toEqual({ status: "UP", knownCount: 2 });
  });

  it.each([
    ["has no result", { tag: "b" }],
    ["reports NO_DATA", { tag: "b", status: "NO_DATA" }],
    ["only has a last-known UP from before its previous run", { tag: "b", status: "UP", ageMinutes: 5 }],
  ])("is not operational when a monitor %s", async (_name, unknown) => {
    await seed([{ tag: "a", status: "UP" }, unknown]);
    expect(await GetLatestStatusActiveAll()).toEqual({ status: "NO_DATA", knownCount: 1 });
  });

  it("is NO_DATA with nothing known", async () => {
    await seed([{ tag: "a" }, { tag: "b", status: "NO_DATA" }]);
    expect(await GetLatestStatusActiveAll()).toEqual({ status: "NO_DATA", knownCount: 0 });
  });

  it("keeps known outages and maintenance beside unknown monitors", async () => {
    await seed([{ tag: "a", status: "DOWN" }, { tag: "b", status: "UP" }, { tag: "c" }]);
    expect((await GetLatestStatusActiveAll()).status).toBe("DOWN");
    await knex("monitoring_data").where("monitor_tag", "a").update({ status: "MAINTENANCE" });
    expect((await GetLatestStatusActiveAll()).status).toBe("MAINTENANCE");
  });

  it("leaves out inactive and hidden monitors, as before", async () => {
    await seed([
      { tag: "a", status: "UP" },
      { tag: "b", active: false },
      { tag: "c", hidden: true },
    ]);
    expect(await GetLatestStatusActiveAll()).toEqual({ status: "UP", knownCount: 1 });
  });
});

describe("status badge", () => {
  it("says Operational for a current up monitor and No Status Available when it is not current", async () => {
    await seed([{ tag: "fresh", status: "UP" }, { tag: "stale", status: "UP", ageMinutes: 5 }, { tag: "none" }]);
    expect(await statusBadgeText("fresh")).toContain("Operational");
    for (const tag of ["stale", "none"]) {
      const svg = await statusBadgeText(tag);
      expect(svg).toContain("No Status Available");
      expect(svg).not.toContain("Operational");
    }
  });

  it("keeps a current outage visible", async () => {
    await seed([{ tag: "a", status: "DOWN" }]);
    expect(await statusBadgeText("a")).toContain("Down");
  });

  it("names a mixed site-wide status instead of claiming operational or unavailable", async () => {
    await seed([{ tag: "a", status: "UP" }, { tag: "b" }]);
    const svg = await statusBadgeText("_");
    expect(svg).toContain("Some Statuses Unavailable");
    expect(svg).not.toContain("Operational");
  });

  it("says No Status Available site-wide when nothing is known and Operational when all are current", async () => {
    await seed([{ tag: "a" }]);
    expect(await statusBadgeText("_")).toContain("No Status Available");
    await knex("monitoring_data").insert({
      monitor_tag: "a",
      timestamp: NOW,
      status: "UP",
      latency: 5,
      type: "REALTIME",
    });
    expect(await statusBadgeText("_")).toContain("Operational");
  });
});

describe("dot badge", () => {
  it("colours a current up monitor as up and a missing or stale one as no data", async () => {
    await seed([{ tag: "fresh", status: "UP" }, { tag: "stale", status: "UP", ageMinutes: 5 }, { tag: "none" }]);
    const colors = await StatusColor();
    expect(await dotFill("fresh")).toBe(colors.UP);
    expect(await dotFill("stale")).toBe(colors.NO_DATA);
    expect(await dotFill("none")).toBe(colors.NO_DATA);
  });

  it("colours the site-wide dot no data, not up, when some monitors are unknown", async () => {
    await seed([{ tag: "a", status: "UP" }, { tag: "b" }]);
    const colors = await StatusColor();
    expect(await dotFill("_")).toBe(colors.NO_DATA);
    await seed([{ tag: "c", status: "DOWN" }]);
    expect(await dotFill("_")).toBe(colors.DOWN);
  });
});
