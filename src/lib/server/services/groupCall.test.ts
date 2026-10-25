import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Knex } from "knex";
import type { GroupMonitor, GroupMonitorMember } from "../types/monitor";

// The real monitor and monitoring-data reads against in-memory SQLite. The cache passes through to its fetcher, as
// on a cache miss, so members' latest results come from the database the way Kener falls back to it.
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
import GroupCall, { IsRoleAwareGroup } from "./groupCall";

const migrations = import.meta.glob<Knex.Migration>("/migrations/*.ts", { eager: true });
const knex = (db as unknown as { knex: Knex }).knex;

const NOW = 1_800_000_000 - (1_800_000_000 % 60);
const EVERY_MINUTE = "* * * * *";

beforeAll(async () => {
  await knex.migrate.latest({
    migrationSource: {
      getMigrations: async () => Object.keys(migrations).sort(),
      getMigrationName: (name: string) => name,
      getMigration: async (name: string) => migrations[name],
    },
  });
});

beforeEach(async () => {
  await knex("monitoring_data").del();
  await knex("monitors").del();
});

interface MemberState {
  status: string;
  /** Minutes before the group's minute that the member's latest result was written. Defaults to 1. */
  age?: number;
  cron?: string;
  active?: boolean;
}

async function statusOf(members: GroupMonitorMember[], states: Record<string, MemberState>): Promise<string> {
  await knex("monitoring_data").del();
  await knex("monitors").del();
  for (const member of members) {
    const state = states[member.tag];
    await knex("monitors").insert({
      tag: member.tag,
      name: member.tag,
      status: state?.active === false ? "INACTIVE" : "ACTIVE",
      monitor_type: "API",
      cron: state?.cron ?? EVERY_MINUTE,
      type_data: "{}",
    });
    if (state) {
      await knex("monitoring_data").insert({
        monitor_tag: member.tag,
        timestamp: NOW - (state.age ?? 1) * 60,
        status: state.status,
        latency: 100,
        type: "REALTIME",
      });
    }
  }
  const group = {
    tag: "group",
    type_data: { monitors: members, executionDelay: 0, latencyCalculation: "AVG" },
  } as unknown as GroupMonitor;
  return (await new GroupCall(group).execute(NOW)).status;
}

const up = { status: "UP" };
const down = { status: "DOWN" };

const half = (tag: string, role?: "required" | "supporting"): GroupMonitorMember => ({
  tag,
  weight: 0.5,
  ...(role ? { role } : {}),
});

describe("GroupCall without roles keeps the weighted rollup", () => {
  it("reports DEGRADED when one of two members is down", async () => {
    expect(await statusOf([half("a"), half("b")], { a: down, b: up })).toBe("DEGRADED");
  });

  it("treats maintenance as up", async () => {
    const maintenance = { status: "MAINTENANCE" };
    expect(await statusOf([half("a"), half("b")], { a: maintenance, b: maintenance })).toBe("UP");
  });

  it("reports DOWN only when every member is down", async () => {
    expect(await statusOf([half("a"), half("b")], { a: down, b: down })).toBe("DOWN");
  });

  it("leaves out members without data and keeps counting last-known results", async () => {
    expect(await statusOf([half("a"), half("b")], { a: up })).toBe("UP");
    expect(await statusOf([half("a"), half("b")], { a: { status: "DOWN", age: 90 }, b: up })).toBe("DEGRADED");
  });
});

describe("GroupCall with roles", () => {
  const app = [half("live", "required"), half("ready", "required")];
  const lens = [half("page", "required"), half("analysis", "supporting")];

  it("reports DOWN when a required member is down and another is up", async () => {
    expect(await statusOf(app, { live: up, ready: down })).toBe("DOWN");
  });

  it("only degrades for a supporting member that is down", async () => {
    expect(await statusOf(lens, { page: up, analysis: down })).toBe("DEGRADED");
  });

  it("reports DOWN when the required page is down even though analysis is up", async () => {
    expect(await statusOf(lens, { page: down, analysis: up })).toBe("DOWN");
  });

  it("reports MAINTENANCE when required members are in maintenance", async () => {
    const maintenance = { status: "MAINTENANCE" };
    expect(await statusOf(app, { live: maintenance, ready: maintenance })).toBe("MAINTENANCE");
    expect(await statusOf(app, { live: up, ready: maintenance })).toBe("MAINTENANCE");
  });

  it("degrades when a required member is degraded", async () => {
    expect(await statusOf(app, { live: up, ready: { status: "DEGRADED" } })).toBe("DEGRADED");
  });

  it("reports DOWN when every supporting-only member is down", async () => {
    const product = [half("site", "supporting"), half("docs", "supporting")];
    expect(await statusOf(product, { site: down, docs: down })).toBe("DOWN");
    expect(await statusOf(product, { site: down, docs: up })).toBe("DEGRADED");
  });

  it("counts a member without a role as required once any role is set", async () => {
    expect(await statusOf([half("page"), half("analysis", "supporting")], { page: down, analysis: up })).toBe("DOWN");
  });

  it("reports UP when everything is up", async () => {
    expect(await statusOf(app, { live: up, ready: up })).toBe("UP");
  });
});

describe("GroupCall with roles and unknown evidence", () => {
  const lens = [half("page", "required"), half("analysis", "supporting")];

  it("reports NO_DATA, not UP, when a required member has no result", async () => {
    expect(await statusOf(lens, { analysis: up })).toBe("NO_DATA");
  });

  it("reports NO_DATA, not DOWN, when no member has a result", async () => {
    expect(await statusOf(lens, {})).toBe("NO_DATA");
  });

  it("reports NO_DATA when a required member's result is NO_DATA", async () => {
    expect(await statusOf(lens, { page: { status: "NO_DATA" }, analysis: up })).toBe("NO_DATA");
  });

  it("degrades when only a supporting member is unknown", async () => {
    expect(await statusOf(lens, { page: up })).toBe("DEGRADED");
    expect(await statusOf(lens, { page: up, analysis: { status: "NO_DATA" } })).toBe("DEGRADED");
  });

  it("reports NO_DATA when a required member's last UP is older than its previous scheduled run", async () => {
    expect(await statusOf(lens, { page: { status: "UP", age: 2 }, analysis: up })).toBe("NO_DATA");
  });

  it("accepts a result from the previous run of a slower schedule", async () => {
    const everyFive = { status: "UP", age: 4, cron: "*/5 * * * *" };
    expect(await statusOf(lens, { page: everyFive, analysis: up })).toBe("UP");
    expect(await statusOf(lens, { page: { ...everyFive, age: 6 }, analysis: up })).toBe("NO_DATA");
  });

  it("treats an inactive required member's last result as unknown", async () => {
    expect(await statusOf(lens, { page: { status: "UP", active: false }, analysis: up })).toBe("NO_DATA");
  });

  it("lets a required outage outrank a required unknown, and an unknown outrank maintenance", async () => {
    const app = [half("live", "required"), half("ready", "required")];
    expect(await statusOf(app, { live: down })).toBe("DOWN");
    expect(await statusOf(app, { live: { status: "MAINTENANCE" } })).toBe("NO_DATA");
  });
});

describe("IsRoleAwareGroup", () => {
  it("is true only for a group with at least one member role", () => {
    const typeData = (monitors: GroupMonitorMember[]) => ({ monitors, executionDelay: 1000 });
    expect(IsRoleAwareGroup({ monitor_type: "GROUP", type_data: typeData([half("a", "required"), half("b")]) })).toBe(
      true,
    );
    expect(IsRoleAwareGroup({ monitor_type: "GROUP", type_data: typeData([half("a"), half("b")]) })).toBe(false);
    expect(IsRoleAwareGroup({ monitor_type: "API", type_data: typeData([half("a", "required")]) })).toBe(false);
    expect(IsRoleAwareGroup({ monitor_type: "GROUP", type_data: {} })).toBe(false);
  });
});
