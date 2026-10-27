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
import { PATCH as patchPage } from "../pages/[page_path]/+server";

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

  for (const kind of ["history", "incident", "maintenance", "page", "group"]) {
    it(`refuses ${kind} collisions and rolls back earlier changes`, async () => {
      const tag = pair.replacement;
      if (kind === "history")
        await knex("monitoring_data").insert({ monitor_tag: tag, timestamp: 120, status: "UP", type: "MANUAL" });
      if (kind === "incident")
        await knex("incident_monitors").insert({ id: 2, incident_id: 1, monitor_tag: tag, monitor_impact: "DEGRADED" });
      if (kind === "maintenance")
        await knex("maintenance_monitors").insert({
          id: 2,
          maintenance_id: 1,
          monitor_tag: tag,
          monitor_impact: "DOWN",
        });
      if (kind === "page") await knex("pages_monitors").insert({ page_id: 1, monitor_tag: tag, position: 8 });
      if (kind === "group")
        await knex("monitors")
          .where({ tag: "group" })
          .update({
            type_data: JSON.stringify({
              monitors: [
                { tag: pair.tag, role: "required" },
                { tag, role: "supporting" },
              ],
            }),
          });
      const before = await snapshot();
      expect((await call()).status).toBe(409);
      expect(await snapshot()).toEqual(before);
    });
  }

  async function sharedSources() {
    await knex("monitors").insert({
      tag: "unknown-second",
      name: "Second",
      monitor_type: "NONE",
      default_status: "NO_DATA",
      type_data: "{}",
    });
    await knex("monitoring_data").insert([
      {
        monitor_tag: "unknown-second",
        timestamp: 120,
        status: "DOWN",
        raw_status: "DEGRADED",
        latency: 19,
        type: "ERROR",
        error_message: "synthetic timeout",
      },
      { monitor_tag: "unknown-second", timestamp: 150, status: "NO_DATA", type: "MANUAL" },
    ]);
    await knex("pages_monitors").insert({
      page_id: 1,
      monitor_tag: "unknown-second",
      position: 4,
      monitor_settings_json: '{"history":false}',
    });
    await knex("incident_monitors").insert({
      id: 2,
      incident_id: 1,
      monitor_tag: "unknown-second",
      monitor_impact: "DOWN",
    });
    await knex("maintenance_monitors").insert({
      id: 2,
      maintenance_id: 1,
      monitor_tag: "unknown-second",
      monitor_impact: "MAINTENANCE",
    });
    await knex("monitor_alerts_config_monitors").insert({ monitor_alerts_id: 1, monitor_tag: "unknown-second" });
    await knex("monitors")
      .where({ tag: "group" })
      .update({
        type_data: JSON.stringify({
          monitors: [
            { tag: pair.tag, role: "required", weight: 7 },
            { tag: "unknown-second", role: "required", weight: 7 },
          ],
          selected: "kept",
        }),
      });
    return [pair, { tag: "unknown-second", replacement: pair.replacement }];
  }

  it("retires a complete shared destination, collapses identical relations and samples once, and retries unchanged", async () => {
    const pairs = await sharedSources();
    const producer = await knex("monitors").where({ tag: pair.replacement }).first();
    const association = await knex("pages_monitors").where({ monitor_tag: pair.tag }).first();
    expect((await call(pairs)).status).toBe(200);
    expect(
      await knex("monitoring_data").where({ monitor_tag: pair.replacement }).orderBy("timestamp").pluck("timestamp"),
    ).toEqual([120, 150, 180]);
    expect(await knex("pages_monitors").where({ page_id: 1 })).toEqual([
      { ...association, monitor_tag: pair.replacement },
    ]);
    for (const table of ["incident_monitors", "maintenance_monitors", "monitor_alerts_config_monitors"]) {
      expect(await knex(table).where({ monitor_tag: pair.replacement })).toHaveLength(1);
    }
    expect(JSON.parse((await knex("monitors").where({ tag: "group" }).first()).type_data).monitors).toEqual([
      { tag: pair.replacement, role: "required", weight: 7 },
    ]);
    expect(await knex("monitors").where({ tag: pair.replacement }).first()).toEqual(producer);
    expect(
      await knex("monitors").whereIn(
        "tag",
        pairs.map(({ tag }) => tag),
      ),
    ).toHaveLength(0);
    const after = await snapshot();
    deleteCache.mockRejectedValueOnce(new Error("cache interruption"));
    expect((await call(pairs)).status).toBe(500);
    expect((await call(pairs)).status).toBe(200);
    expect(await snapshot()).toEqual(after);
  });

  it("keeps an existing destination association and its position while collapsing both sources", async () => {
    const pairs = await sharedSources();
    await knex("pages_monitors").insert({
      page_id: 1,
      monitor_tag: pair.replacement,
      position: 9,
      monitor_settings_json: '{"history":false}',
    });
    const retained = await knex("pages_monitors").where({ monitor_tag: pair.replacement }).first();
    await knex("monitors")
      .where({ tag: "group" })
      .update({
        type_data: JSON.stringify({
          monitors: [
            { tag: pair.tag, role: "required", weight: 7 },
            { tag: "unknown-unrelated", role: "supporting", weight: 1 },
            { tag: pair.replacement, role: "required", weight: 7 },
            { tag: "unknown-second", role: "required", weight: 7 },
          ],
        }),
      });
    expect((await call(pairs)).status).toBe(200);
    expect(await knex("pages_monitors").where({ page_id: 1 })).toEqual([retained]);
    expect(JSON.parse((await knex("monitors").where({ tag: "group" }).first()).type_data).monitors).toEqual([
      { tag: "unknown-unrelated", role: "supporting", weight: 1 },
      { tag: pair.replacement, role: "required", weight: 7 },
    ]);
  });

  for (const conflict of ["history", "settings", "options"]) {
    it(`rolls back the whole shared group for conflicting ${conflict}`, async () => {
      const pairs = await sharedSources();
      if (conflict === "history")
        await knex("monitoring_data")
          .where({ monitor_tag: "unknown-second", timestamp: 120 })
          .update({ type: "MANUAL" });
      if (conflict === "settings")
        await knex("pages_monitors")
          .where({ monitor_tag: "unknown-second" })
          .update({ monitor_settings_json: '{"history":true}' });
      if (conflict === "options")
        await knex("monitors")
          .where({ tag: "group" })
          .update({
            type_data: JSON.stringify({
              monitors: [
                { tag: pair.tag, role: "required" },
                { tag: "unknown-second", role: "supporting" },
              ],
            }),
          });
      const before = await snapshot();
      expect((await call(pairs)).status).toBe(409);
      expect(await snapshot()).toEqual(before);
    });
  }

  async function pagePatch(body: unknown) {
    const request = new Request("http://localhost/api/v4/pages/test", {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
      body: JSON.stringify(body),
    });
    return handle({
      event: {
        request,
        url: new URL(request.url),
        route: { id: "/(api)/api/v4/pages/[page_path]" },
        params: { page_path: "test" },
        locals: {},
        cookies: { get: () => undefined },
      },
      resolve: (event: never) => patchPage(event),
    } as never);
  }

  it("preserves no-op/reorder/add/remove survivors through the actual page PATCH after retirement", async () => {
    expect((await call()).status).toBe(200);
    const before = await knex("pages_monitors").where({ page_id: 1 }).first();
    for (const monitors of [
      [pair.replacement],
      ["unknown-unrelated", pair.replacement],
      [pair.replacement, "unknown-unrelated"],
      [pair.replacement],
    ]) {
      const response = await pagePatch({ monitors });
      expect(response.status).toBe(200);
      expect((await response.json()).page.monitor_reconciliation).toBe("preserve");
      const survivor = await knex("pages_monitors").where({ monitor_tag: pair.replacement }).first();
      expect(survivor).toEqual({ ...before, position: monitors.indexOf(pair.replacement) });
      expect(await knex("pages_monitors").where({ page_id: 1 }).orderBy("position").pluck("monitor_tag")).toEqual(
        monitors,
      );
    }
  });

  it("rolls back metadata, removals and reorders when a later membership insert fails", async () => {
    const before = await snapshot();
    const page = await knex("pages").where({ id: 1 }).first();
    // A missing FK fails inside the production repository after removals, without a mocked transaction.
    await expect(
      db.reconcilePage(1, { page_title: "Must roll back" }, [pair.replacement, "absent-fk"]),
    ).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
    expect(await knex("pages").where({ id: 1 }).first()).toEqual(page);
  });

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
