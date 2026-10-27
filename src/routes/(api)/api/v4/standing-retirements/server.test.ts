import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Knex } from "knex";
import type { Handle, RequestEvent, ResolveOptions } from "@sveltejs/kit";

// Match hooks.server.test.ts: replace only SvelteKit's request-store composition, not the bearer/database guard.
vi.mock("@sveltejs/kit/hooks", () => ({
  sequence:
    (...handlers: Handle[]): Handle =>
    ({ event, resolve }) =>
      handlers.reduceRight<(event: RequestEvent, opts?: ResolveOptions) => ReturnType<Handle>>(
        (next, handler) => (event) => handler({ event, resolve: next }),
        resolve,
      )(event),
}));

vi.mock("$lib/server/db/db", async () => {
  const { CreateTestDb } = await import("$lib/server/db/testDatabase");
  return { default: await CreateTestDb() };
});
const { deleteCache } = vi.hoisted(() => ({ deleteCache: vi.fn(async (_key: string) => {}) }));
vi.mock("$lib/server/cache/cache", () => ({
  getCache: async (_key: string, fetcher?: () => unknown) => (fetcher ? fetcher() : null),
  setCache: async () => {},
  deleteCache,
}));

import db from "$lib/server/db/db";
import { CreateNewAPIKey } from "$lib/server/controllers/apiController";
import { GetMonitoringData, GetMonitorsParsed } from "$lib/server/controllers/monitorsController";
import { handle } from "../../../../../hooks.server";
import { POST } from "./+server";

const knex = (db as unknown as { knex: Knex }).knex;
const migrations = import.meta.glob<Knex.Migration>("/migrations/*.ts", { eager: true });
const pair = { tag: "unknown-service", replacement: "fixed-producer" };
const tables = [
  "monitoring_data",
  "incident_monitors",
  "maintenance_monitors",
  "pages_monitors",
  "monitor_alerts_config_monitors",
  "monitor_alerts",
  "monitor_alerts_v2",
  "monitor_alerts_config",
];
let bearer: string;

beforeAll(async () => {
  await knex.migrate.latest({
    migrationSource: {
      getMigrations: async () => Object.keys(migrations).sort(),
      getMigrationName: (name: string) => name,
      getMigration: async (name: string) => migrations[name],
    },
  });
  bearer = (await CreateNewAPIKey({ name: "disposable-retirement-test" })).apiKey;
});
afterAll(async () => {
  await knex.destroy();
});

async function call(replacements: unknown = [pair], token: string | null = bearer) {
  const request = new Request("http://localhost/api/v4/standing-retirements", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ replacements }),
  });
  const event = {
    request,
    url: new URL(request.url),
    route: { id: "/(api)/api/v4/standing-retirements" },
    params: {},
    locals: {},
    cookies: { get: () => undefined },
  };
  return handle({ event, resolve: (event: never) => POST(event) } as never);
}

async function snapshot() {
  const out: Record<string, unknown[]> = {};
  for (const table of [...tables, "monitors", "incidents", "maintenances"]) {
    out[table] = (await knex(table).select("*")).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  return out;
}

beforeEach(async () => {
  deleteCache.mockReset().mockResolvedValue(undefined);
  for (const table of tables) await knex(table).del();
  await knex("monitors").del();
  await knex("incidents").del();
  await knex("maintenances").del();
  await knex("pages").del();
  for (const [tag, type] of [
    [pair.tag, "NONE"],
    [pair.replacement, "API"],
    ["unknown-unrelated", "NONE"],
    ["group", "GROUP"],
  ]) {
    await knex("monitors").insert({
      tag,
      name: tag,
      monitor_type: type,
      default_status: "NO_DATA",
      status: "ACTIVE",
      type_data:
        type === "GROUP"
          ? JSON.stringify({ monitors: [{ tag: pair.tag, role: "required", weight: 7 }], selected: "kept" })
          : "{}",
    });
  }
  await knex("monitors").insert({ tag: "empty-group", name: "Empty group", monitor_type: "GROUP", type_data: "null" });
  await knex("monitoring_data").insert([
    {
      monitor_tag: pair.tag,
      timestamp: 120,
      status: "DOWN",
      raw_status: "DEGRADED",
      latency: 19,
      type: "ERROR",
      error_message: "synthetic timeout",
    },
    { monitor_tag: pair.replacement, timestamp: 180, status: "UP", raw_status: "UP", latency: 8, type: "REALTIME" },
    { monitor_tag: "unknown-unrelated", timestamp: 120, status: "NO_DATA", type: "MANUAL" },
  ]);
  await knex("incidents").insert({ id: 1, title: "Synthetic event", start_date_time: 100 });
  await knex("incident_monitors").insert({ id: 1, incident_id: 1, monitor_tag: pair.tag, monitor_impact: "DOWN" });
  await knex("maintenances").insert({
    id: 1,
    title: "Synthetic work",
    start_date_time: 240,
    rrule: "FREQ=DAILY",
    duration_seconds: 60,
  });
  await knex("maintenance_monitors").insert({
    id: 1,
    maintenance_id: 1,
    monitor_tag: pair.tag,
    monitor_impact: "MAINTENANCE",
  });
  await knex("pages").insert({ id: 1, page_path: "test", page_title: "Test" });
  await knex("pages_monitors").insert({
    page_id: 1,
    monitor_tag: pair.tag,
    position: 3,
    monitor_settings_json: '{"history":false}',
  });
  await knex("monitor_alerts_config").insert({
    id: 1,
    monitor_tag: pair.tag,
    alert_for: "STATUS",
    alert_value: "DOWN",
  });
  await knex("monitor_alerts_config_monitors").insert({ monitor_alerts_id: 1, monitor_tag: pair.tag });
  await knex("monitor_alerts").insert({
    monitor_tag: pair.tag,
    monitor_status: "DOWN",
    alert_status: "RESOLVED",
    health_checks: 3,
  });
  await knex("monitor_alerts_v2").insert({
    config_id: 1,
    monitor_tag: pair.tag,
    incident_id: 1,
    alert_status: "RESOLVED",
  });
});

describe("native standing retirement with the real database and bearer hook", () => {
  it("moves samples and all relationships, preserving every other field and the fixed producer identity", async () => {
    const before = await snapshot();
    const response = await call();
    expect(response.status).toBe(200);
    expect((await response.json()).results[0]).toMatchObject({
      ...pair,
      outcome: "retired",
      moved: { monitoring_data: 1, groups: 1 },
    });
    const after = await snapshot();
    for (const table of tables) {
      const expected = before[table].map((row) => ({
        ...(row as object),
        monitor_tag:
          (row as { monitor_tag: string }).monitor_tag === pair.tag
            ? pair.replacement
            : (row as { monitor_tag: string }).monitor_tag,
      }));
      expect(after[table]).toEqual(expected.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
    }
    expect(after.incidents).toEqual(before.incidents);
    expect(after.maintenances).toEqual(before.maintenances);
    for (const tag of [pair.replacement, "unknown-unrelated"]) {
      expect(await knex("monitors").where({ tag }).first()).toEqual(
        before.monitors.find((row) => (row as { tag: string }).tag === tag),
      );
    }
    const group = await knex("monitors").where({ tag: "group" }).first();
    expect(JSON.parse(group.type_data)).toEqual({
      monitors: [{ tag: pair.replacement, role: "required", weight: 7 }],
      selected: "kept",
    });
    expect(group.updated_at).toEqual(
      (before.monitors.find((row) => (row as { tag: string }).tag === "group") as { updated_at: unknown }).updated_at,
    );
    expect(await GetMonitorsParsed({ tag: pair.tag })).toEqual([]);
    expect((await GetMonitoringData(pair.replacement, 0, 300)).map((row) => [row.timestamp, row.type])).toEqual([
      [120, "ERROR"],
      [180, "REALTIME"],
    ]);
    expect(deleteCache).toHaveBeenCalledWith("fixed-producer:last_status");
    const repeated = await call();
    expect(repeated.status).toBe(200);
    expect((await repeated.json()).results[0].outcome).toBe("already-absent");
    expect(await snapshot()).toEqual(after);
  });

  for (const kind of ["history", "incident", "maintenance", "page", "alert-config", "group"]) {
    it(`refuses ${kind} collisions and rolls back earlier changes`, async () => {
      const tag = pair.replacement;
      if (kind === "history")
        await knex("monitoring_data").insert({ monitor_tag: tag, timestamp: 120, status: "UP", type: "MANUAL" });
      if (kind === "incident")
        await knex("incident_monitors").insert({ id: 2, incident_id: 1, monitor_tag: tag, monitor_impact: "DEGRADED" });
      if (kind === "maintenance") await knex("maintenance_monitors").insert({ id: 2, maintenance_id: 1, monitor_tag: tag });
      if (kind === "page") await knex("pages_monitors").insert({ page_id: 1, monitor_tag: tag, position: 8 });
      if (kind === "alert-config")
        await knex("monitor_alerts_config_monitors").insert({ monitor_alerts_id: 1, monitor_tag: tag });
      if (kind === "group")
        await knex("monitors")
          .where({ tag: "group" })
          .update({ type_data: JSON.stringify({ monitors: [{ tag: pair.tag }, { tag }] }) });
      const before = await snapshot();
      expect((await call()).status).toBe(409);
      expect(await snapshot()).toEqual(before);
    });
  }

  it("rolls back a whole batch when a later exact source has changed", async () => {
    await knex("monitors").where({ tag: "unknown-unrelated" }).update({ monitor_type: "API" });
    const before = await snapshot();
    expect((await call([pair, { tag: "unknown-unrelated", replacement: pair.replacement }])).status).toBe(409);
    expect(await snapshot()).toEqual(before);
  });

  it("refuses a changed placeholder even inside the Unknown namespace", async () => {
    await knex("monitors").where({ tag: pair.tag }).update({ monitor_type: "API" });
    const before = await snapshot();
    expect((await call()).status).toBe(409);
    expect(await snapshot()).toEqual(before);
  });

  it("reconciles a committed operation whose cache step failed", async () => {
    deleteCache.mockRejectedValueOnce(new Error("synthetic cache interruption"));
    expect((await call()).status).toBe(500);
    expect(await knex("monitors").where({ tag: pair.tag }).first()).toBeUndefined();
    const committed = await snapshot();
    expect((await call()).status).toBe(200);
    expect(await snapshot()).toEqual(committed);
  });

  it("rolls back a failure after reassociation and can resume after its cause is repaired", async () => {
    await knex("monitors").where({ tag: "group" }).update({ type_data: "{invalid-json" });
    const before = await snapshot();
    expect((await call()).status).toBe(500);
    expect(await snapshot()).toEqual(before);
    await knex("monitors")
      .where({ tag: "group" })
      .update({ type_data: JSON.stringify({ monitors: [{ tag: pair.tag }] }) });
    expect((await call()).status).toBe(200);
    expect(await knex("monitors").where({ tag: pair.tag }).first()).toBeUndefined();
  });

  it("keeps the source when the destination is absent or is another standing/group row", async () => {
    for (const replacement of ["absent", "unknown-unrelated", "group"]) {
      const before = await snapshot();
      expect((await call([{ ...pair, replacement }])).status).toBe(409);
      expect(await snapshot()).toEqual(before);
    }
  });

  it("does not rely on the capped incident list", async () => {
    for (let start = 2; start <= 1002; start += 100) {
      await knex("incidents").insert(
        Array.from({ length: Math.min(100, 1003 - start) }, (_, i) => ({
          id: start + i,
          title: "Unrelated",
          start_date_time: 100,
        })),
      );
    }
    await knex("incident_monitors").where({ incident_id: 1 }).update({ incident_id: 1002 });
    expect((await call()).status).toBe(200);
    expect((await knex("incident_monitors").where({ incident_id: 1002 }).first()).monitor_tag).toBe(pair.replacement);
    expect((await knex("incidents")).length).toBe(1002);
  });

  it("refuses unauthenticated/invalid requests without changing the database", async () => {
    const before = await snapshot();
    expect((await call([pair], null)).status).toBe(401);
    expect((await call([pair], "invalid-disposable-key")).status).toBe(401);
    for (const value of [
      [],
      null,
      [{ tag: "unknown-unrelated", replacement: pair.tag }, pair],
      [{ ...pair, tag: "fixed-producer" }],
    ]) {
      expect((await call(value)).status).toBe(400);
    }
    expect(await snapshot()).toEqual(before);
  });
});
