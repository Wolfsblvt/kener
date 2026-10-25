import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Knex } from "knex";

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
import { GetPageDashboardData } from "./dashboardController";
import type { LayoutServerData } from "./layoutController";

const migrations = import.meta.glob<Knex.Migration>("/migrations/*.ts", { eager: true });
const knex = (db as unknown as { knex: Knex }).knex;

const NOW = 1_800_000_000 - (1_800_000_000 % 60);
const layout = {
  canSeeHiddenMonitors: false,
  eventDisplaySettings: { showInlineEvents: false },
} as unknown as LayoutServerData;

beforeAll(async () => {
  await knex.migrate.latest({
    migrationSource: {
      getMigrations: async () => Object.keys(migrations).sort(),
      getMigrationName: (name: string) => name,
      getMigration: async (name: string) => migrations[name],
    },
  });
  await knex("pages_monitors").del();
  await knex("pages").where("page_path", "").del();
  await knex("pages").insert({ page_path: "", page_title: "Home", page_header: "Home" });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW * 1000 + 30_000);
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  await knex("pages_monitors").del();
  await knex("monitoring_data").del();
  await knex("monitors").del();
});

/** Put monitors on the home page; `ageMinutes` null means the monitor has written no result yet. */
async function pageSummary(rows: Array<{ tag: string; status?: string; ageMinutes?: number | null }>) {
  for (const [position, row] of rows.entries()) {
    await knex("monitors").insert({
      tag: row.tag,
      name: row.tag,
      status: "ACTIVE",
      is_hidden: "NO",
      monitor_type: "API",
      cron: "* * * * *",
      type_data: "{}",
    });
    const [page] = await knex("pages").where("page_path", "").select("id");
    await knex("pages_monitors").insert({ page_id: page.id, monitor_tag: row.tag, position });
    if (row.ageMinutes !== null) {
      await knex("monitoring_data").insert({
        monitor_tag: row.tag,
        timestamp: NOW - (row.ageMinutes ?? 1) * 60,
        status: row.status,
        latency: 50,
        type: "REALTIME",
      });
    }
  }
  return (await GetPageDashboardData("", layout))?.pageStatus;
}

describe("page status summary", () => {
  it("says all systems are operational only when every monitor is currently up", async () => {
    expect(
      await pageSummary([
        { tag: "a", status: "UP" },
        { tag: "b", status: "UP" },
      ]),
    ).toEqual({ statusSummary: "All Systems Operational", statusClass: "bg-up" });
  });

  it("does not call a page with an up product and a NO_DATA product operational", async () => {
    expect(
      await pageSummary([
        { tag: "a", status: "UP" },
        { tag: "b", status: "NO_DATA" },
      ]),
    ).toEqual({ statusSummary: "Some Statuses Unavailable", statusClass: "bg-muted-foreground" });
  });

  it("does not call a page operational when a monitor has no result yet", async () => {
    expect(
      (
        await pageSummary([
          { tag: "a", status: "UP" },
          { tag: "b", ageMinutes: null },
        ])
      )?.statusSummary,
    ).toBe("Some Statuses Unavailable");
  });

  it("does not count a last-known UP from before the previous scheduled run as up", async () => {
    expect(
      (
        await pageSummary([
          { tag: "a", status: "UP" },
          { tag: "b", status: "UP", ageMinutes: 5 },
        ])
      )?.statusSummary,
    ).toBe("Some Statuses Unavailable");
  });

  it("still reports an outage beside unknown monitors", async () => {
    expect(
      (
        await pageSummary([
          { tag: "a", status: "DOWN" },
          { tag: "b", status: "NO_DATA" },
          { tag: "c", status: "UP" },
        ])
      )?.statusSummary,
    ).toBe("Partial System Outage");
  });

  it("says no status is available when nothing is known", async () => {
    expect(
      (
        await pageSummary([
          { tag: "a", status: "NO_DATA" },
          { tag: "b", ageMinutes: null },
        ])
      )?.statusSummary,
    ).toBe("No Status Available");
  });
});
