import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Knex } from "knex";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

vi.mock("$lib/server/db/db", async () => {
  const { CreateTestDb } = await import("$lib/server/db/testDatabase");
  return { default: await CreateTestDb() };
});
vi.mock("../cache/cache", () => ({
  getCache: async (_key: string, fetcher?: () => unknown) => fetcher?.(),
  setCache: async () => {},
  deleteCache: async () => {},
}));
const queue = vi.hoisted(() => ({
  run: null as null | ((job: { data: unknown }) => Promise<unknown>),
  scheduler: null as null | ((job: { data: unknown }) => Promise<unknown>),
}));
vi.mock("../schedulers/monitorSchedulers.js", () => ({
  getSchedulers: async () => [],
  addJobToSchedulerQueue: async () => {},
  removeJobFromSchedulerQueue: async () => {},
}));
vi.mock("../queues/q.js", () => ({
  default: {
    createQueue: (name: string) => ({
      name,
      add: async (_name: string, data: unknown) => queue.run!({ data }),
      upsertJobScheduler: async () => {},
    }),
    createWorker: (target: { name: string }, run: typeof queue.run) => {
      if (target.name === "appSchedulerQueue") queue.scheduler = run;
      else queue.run = run;
      return { on: vi.fn(), close: vi.fn() };
    },
  },
}));
import db from "../db/db.js";
import { push, shutdown } from "../queues/alertingQueue.js";
import { sendAlertNotifications } from "./alertNotifications.js";
import { loadAttentionComposer } from "./attentionComposer.js";
import { attentionReceipt } from "./attentionDispatch.js";
import { applyAttentionChange } from "./attentionOperator.js";
import appScheduler from "../schedulers/appScheduler.js";
import sendWebhook from "./webhook_notification.js";
import type { MonitorAlertConfigRecord, MonitorAlertV2Record, TriggerRecord } from "../types/db.js";
import type { SiteDataForNotification } from "./types.js";
import * as attentionApi from "../../../routes/(api)/api/v4/attention/[alert_id]/[trigger_id]/+server";

const knex = (db as unknown as { knex: Knex }).knex;
const migrations = import.meta.glob<Knex.Migration>("/migrations/*.ts", { eager: true });
let directory: string, configPath: string;
let trigger: TriggerRecord;
const at = "2026-11-12T10:00:00Z";
const site = { site_url: "https://status.example/" } as SiteDataForNotification;
const monitor = { tag: "fixture", name: "Untrusted native description" };
const config = {
  id: 2,
  alert_for: "STATUS",
  alert_value: "DOWN",
  failure_threshold: 1,
  success_threshold: 1,
  severity: "WARNING",
  create_incident: "NO",
  is_active: "YES",
} as MonitorAlertConfigRecord;
const alert = {
  id: 7,
  config_id: 2,
  monitor_tag: "fixture",
  incident_id: null,
  alert_status: "TRIGGERED",
  created_at: at,
  updated_at: at,
} as MonitorAlertV2Record;

function pin(path: string) {
  return { path: resolve(path), sha256: createHash("sha256").update(readFileSync(path)).digest("hex") };
}
function configure(composerPath: string, declaration: unknown = {}) {
  const declarationPath = join(directory, "declaration.json");
  writeFileSync(declarationPath, JSON.stringify(declaration));
  configPath = join(directory, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({ version: 1, triggerIds: [3], composer: pin(composerPath), declaration: pin(declarationPath) }),
  );
  process.env.KENER_ATTENTION_CONFIG = configPath;
}
const fetchReceipt = (text?: string) =>
  vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        ok: true,
        result: { message_id: 23, date: 1794477600, chat: { id: Number(body.chat_id) }, text: text ?? body.text },
      }),
      { status: 200 },
    );
  });

beforeAll(async () => {
  await knex.migrate.latest({
    migrationSource: {
      getMigrations: async () => Object.keys(migrations).sort(),
      getMigrationName: (name: string) => name.slice("/migrations/".length),
      getMigration: async (name: string) => migrations[name],
    },
  });
  await knex("site_data").where({ key: "colors" }).del();
  await knex("site_data").insert({ key: "colors", value: "{}", data_type: "object" });
});
beforeEach(async () => {
  mkdirSync("artifacts/tests", { recursive: true });
  directory = resolve(mkdtempSync("artifacts/tests/attention-"));
  process.env.KENER_NOTIFICATION_LOG_DIR = join(directory, "evidence");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at);
  await knex("alert_notification_state").del();
  await knex("monitor_alerts_v2").del();
  await knex("monitor_alerts_config_triggers").del();
  await knex("monitor_alerts_config_monitors").del();
  await knex("monitor_alerts_config").del();
  await knex("triggers").del();
  await knex("monitoring_data").del();
  await knex("monitors").del();
  await knex("monitors").insert({
    tag: "fixture",
    name: "Fixture",
    status: "ACTIVE",
    monitor_type: "API",
    cron: "* * * * *",
    type_data: "{}",
    monitor_settings_json: "{}",
  });
  await knex("monitor_alerts_config").insert(config);
  await knex("monitor_alerts_config_monitors").insert({ monitor_alerts_id: 2, monitor_tag: "fixture" });
  trigger = {
    id: 3,
    name: "Fixture",
    trigger_status: "ACTIVE",
    trigger_type: "webhook",
    trigger_meta: JSON.stringify({
      url: "https://api.telegram.org/botTEST/sendMessage",
      headers: [],
      webhook_body: JSON.stringify({ chat_id: "42", text: "Old template sentence", parse_mode: "HTML" }),
    }),
  } as TriggerRecord;
  await knex("triggers").insert(trigger);
  await knex("monitor_alerts_config_triggers").insert({ monitor_alerts_id: 2, trigger_id: 3 });
  await knex("monitor_alerts_v2").insert({
    ...alert,
    created_at: "2026-11-12 10:00:00",
    updated_at: "2026-11-12 10:00:00",
  });
  const fixture = join(directory, "composer.mjs");
  writeFileSync(
    fixture,
    "export function validateDeclaration(){}; export function composeKener(d,v,n,f){return {text:'Synthetic contract message',row:{systemId:'fixture'},notification:{event:f.deliveryUncertain||f.messages.some(m=>m.outcome==='sent')?null:'opening',next:'fixture'}}}",
  );
  configure(fixture);
  vi.stubGlobal("fetch", fetchReceipt());
});
afterEach(async () => {
  await shutdown();
  await appScheduler.shutdown();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.KENER_ATTENTION_CONFIG;
  delete process.env.KENER_NOTIFICATION_LOG_DIR;
  rmSync(directory, { recursive: true, force: true });
});
afterAll(async () => {
  await knex.destroy();
});

it("migrates idempotently and preserves CAS claims/operator edits on the actual database", async () => {
  const migration = await import("../../../../migrations/20261113010000_attention_delivery_state");
  await migration.up(knex);
  const first = await db.ensureAttentionState(7, 3);
  expect(await db.saveAttentionState(7, 3, first.revision, { facts: { pickupKnown: true }, messages: [] })).toBe(true);
  expect(await db.saveAttentionState(7, 3, first.revision, { facts: {}, messages: [] })).toBe(false);
  expect((await db.ensureAttentionState(7, 3)).state.facts.pickupKnown).toBe(true);
});

it("adds a retry clock to older rejected recovery without arming uncertain effects or changing receipts", async () => {
  const migration = await import("../../../../migrations/20261113020000_attention_retry_due");
  await migration.down(knex);
  const failedState = {
    facts: {},
    messages: [{ attempt: "old-recovery", event: "recovery", at, outcome: "failed", boundary: "operator" }],
  };
  await knex("alert_notification_state").insert({
    alert_id: 7,
    trigger_id: 3,
    revision: 4,
    state_json: JSON.stringify(failedState),
  });
  await migration.up(knex);
  await migration.up(knex);
  expect(await db.getDueAttentionRetries(Date.parse(at) / 1000, [3])).toEqual([{ alert_id: 7, trigger_id: 3 }]);
  expect(await db.getAttentionState(7, 3)).toEqual({ revision: 4, state: failedState });
  for (const held of [
    { outcome: "unknown", boundary: "operator" },
    { outcome: "failed", boundary: "http" },
  ]) {
    await migration.down(knex);
    await knex("alert_notification_state").update({
      state_json: JSON.stringify({ ...failedState, messages: [{ ...failedState.messages[0], ...held }] }),
    });
    await migration.up(knex);
    expect(await db.getDueAttentionRetries(Date.parse(at) / 1000, [3])).toEqual([]);
  }
});

it("holds legacy unqualified failed receipts until explicit no-effect reconciliation", async () => {
  const record = await db.ensureAttentionState(7, 3);
  await db.saveAttentionState(7, 3, record.revision, {
    facts: {},
    messages: [{ attempt: "old-http-only", event: "opening", at, outcome: "failed", boundary: "http" }],
  });
  await sendAlertNotifications(alert, config, site, monitor, [trigger], true);
  expect(fetch).not.toHaveBeenCalled();
  const current = (await db.getAttentionState(7, 3))!;
  expect(
    (
      await attentionApi.PATCH(
        apiEvent({
          action: "reconcile",
          revision: current.revision,
          reference: "fixture-no-effect-investigation",
          attempt: "old-http-only",
          outcome: "failed",
        }),
      )
    ).status,
  ).toBe(200);
  await sendAlertNotifications(alert, config, site, monitor, [trigger], true);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("refuses a changed operated artifact before HTTP and without falling back to templates", async () => {
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  writeFileSync(
    config.composer.path,
    "export function validateDeclaration(){}; export function composeKener(){return {text:'Changed usable contract',row:{systemId:'fixture'},notification:{event:'opening',next:'fixture'}}}",
  );
  await expect(
    sendAlertNotifications(alert, { ...config, id: 2, alert_for: "STATUS", alert_value: "DOWN" }, site, monitor, [
      trigger,
    ]),
  ).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
  expect(await db.getAttentionState(7, 3)).toBeUndefined();
});

it("keeps non-opted triggers usable and never repeats them on a native cadence", async () => {
  delete process.env.KENER_ATTENTION_CONFIG;
  await sendAlertNotifications(alert, config, site, monitor, [trigger], true);
  expect(fetch).not.toHaveBeenCalled();
  await sendAlertNotifications(alert, config, site, monitor, [trigger]);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("retains HTTP acceptance without a matching Message as uncertain and refuses blind retry", async () => {
  vi.stubGlobal("fetch", fetchReceipt("Different text"));
  await sendAlertNotifications(alert, config, site, monitor, [trigger]);
  expect((await db.getAttentionState(7, 3))!.state.messages[0].outcome).toBe("accepted");
  await sendAlertNotifications(alert, config, site, monitor, [trigger], true);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("escapes quotes/newlines and never templates the composed meaning", async () => {
  const text = 'Plain "quoted"\n{{alert_message}} $TELEGRAM_CHAT_ID <tag>';
  const result = await sendWebhook(
    JSON.stringify({ chat_id: "42", text: "old", parse_mode: "HTML" }),
    {},
    "https://api.telegram.org/botTEST/sendMessage",
    "[]",
    text,
  );
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual({ chat_id: "42", text });
  expect(attentionReceipt(result).outcome).toBe("sent");
});

it("does not count a provider rejection or missing response as sent", () => {
  expect(attentionReceipt({ status: 400 }).outcome).toBe("unknown");
  expect(
    attentionReceipt({ status: 400, data: '{"ok":false,"error_code":400,"description":"Rejected"}' }).outcome,
  ).toBe("failed");
  expect(attentionReceipt({ status: 200, data: "unreadable" }).outcome).toBe("accepted");
  expect(attentionReceipt({ error: "timeout" }).outcome).toBe("unknown");
});

const apiEvent = (input: unknown = {}) =>
  ({
    params: { alert_id: "7", trigger_id: "3" },
    request: new Request("https://example.invalid/api/v4/attention/7/3", {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  }) as Parameters<typeof attentionApi.PATCH>[0];
const rejection = (retryAfter?: number) =>
  new Response(
    JSON.stringify({
      ok: false,
      error_code: 429,
      description: "Synthetic rejection",
      ...(retryAfter ? { parameters: { retry_after: retryAfter } } : {}),
    }),
    { status: 429 },
  );

it.each(["mismatch", "missing-composer", "missing-declaration", "invalid-declaration", "missing-config"])(
  "keeps persisted recovery accessible with %s while evaluation refuses",
  async (broken) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Synthetic interruption");
      }),
    );
    await sendAlertNotifications(alert, config, site, monitor, [trigger]);
    const operated = JSON.parse(readFileSync(configPath, "utf8"));
    if (broken === "mismatch") writeFileSync(operated.composer.path, "export const changed=true;");
    if (broken === "missing-composer") rmSync(operated.composer.path);
    if (broken === "missing-declaration") rmSync(operated.declaration.path);
    if (broken === "invalid-declaration") {
      writeFileSync(operated.declaration.path, "invalid json");
      operated.declaration = pin(operated.declaration.path);
      writeFileSync(configPath, JSON.stringify(operated));
    }
    if (broken === "missing-config") rmSync(configPath);
    const readResponse = await attentionApi.GET(apiEvent());
    expect(readResponse.status).toBe(200);
    const { record } = await readResponse.json();
    expect(record.state.messages[0].outcome).toBe("unknown");
    expect(
      (
        await attentionApi.PATCH(
          apiEvent({ action: "retry", revision: record.revision, reference: "fixture-no-proof" }),
        )
      ).status,
    ).toBe(409);
    const reconciled = await attentionApi.PATCH(
      apiEvent({
        revision: record.revision,
        reference: "fixture-no-effect-proof",
        action: "reconcile",
        attempt: record.state.messages[0].attempt,
        outcome: "failed",
      }),
    );
    expect(reconciled.status).toBe(200);
    expect((await attentionApi.POST(apiEvent({ action: "evaluate", revision: record.revision + 1 }))).status).toBe(503);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await (await attentionApi.GET(apiEvent())).json()).record.state.messages[0].reference).toBe(
      "fixture-no-effect-proof",
    );
  },
);

it("clears and replaces scalar/custody facts without stale cause or contradictory recovery", async () => {
  let record = await db.ensureAttentionState(7, 3);
  const change = async (facts: unknown) => {
    const response = await attentionApi.PATCH(
      apiEvent({ action: "facts", revision: record.revision, reference: "fixture-correction", facts }),
    );
    record = (await db.getAttentionState(7, 3))!;
    return response;
  };
  expect(
    (
      await change({
        failureKind: "configuration-error",
        reason: "Old cause",
        endedBy: "Operator",
        pickupKnown: true,
        pickup: { who: "Operator", session: "fixture", since: at, current: true },
      })
    ).status,
  ).toBe(200);
  expect((await change({ pickupKnown: false })).status).toBe(409);
  expect((await change({ endedOnItsOwn: true })).status).toBe(409);
  expect(
    (await change({ failureKind: "unavailable", endedBy: null, endedOnItsOwn: true, pickupKnown: false, pickup: null }))
      .status,
  ).toBe(200);
  expect(record.state.facts).toEqual({
    failureKind: "unavailable",
    endedOnItsOwn: true,
    pickupKnown: false,
    pickup: null,
  });
  expect((await change({ reason: "Corrected", failureKind: null, endedOnItsOwn: false })).status).toBe(200);
  expect(record.state.facts).not.toHaveProperty("failureKind");
  expect((await change({ reason: null })).status).toBe(200);
  expect(record.state.facts).not.toHaveProperty("reason");
  expect(fetch).not.toHaveBeenCalled();
});

it.each(["server", "body-read", "transport", "unqualified-400"])(
  "holds %s ambiguity through the real sender on later cadence",
  async (failure) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (failure === "transport") throw new TypeError("Synthetic interruption");
        if (failure === "body-read")
          return {
            ok: false,
            status: 400,
            text: async () => {
              throw new TypeError("Body interrupted");
            },
          };
        return new Response(
          failure === "server" ? '{"ok":false,"error_code":500,"description":"Server failed"}' : "Bad gateway body",
          { status: failure === "server" ? 503 : 400 },
        );
      }),
    );
    await sendAlertNotifications(alert, config, site, monitor, [trigger]);
    vi.setSystemTime(Date.parse(at) + 3600_000);
    await sendAlertNotifications(alert, config, site, monitor, [trigger], true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await db.getAttentionState(7, 3))!.state.messages[0].outcome).toBe("unknown");
    expect(await db.getDueAttentionRetries(Math.floor(Date.now() / 1000), [3])).toEqual([]);
  },
);

it("persists rejection backoff/budget across monitor samples and supports explicit coworker rearm", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => rejection()),
  );
  await sendAlertNotifications(alert, config, site, monitor, [trigger]);
  for (let seconds = 1; seconds < 60; seconds++) {
    vi.setSystemTime(Date.parse(at) + seconds * 1000);
    await sendAlertNotifications(alert, config, site, monitor, [trigger], true);
  }
  expect(fetch).toHaveBeenCalledTimes(1);
  for (const seconds of [60, 360, 2160]) {
    vi.setSystemTime(Date.parse(at) + seconds * 1000);
    await sendAlertNotifications(alert, config, site, monitor, [trigger], true);
  }
  vi.setSystemTime(Date.parse(at) + 86400_000);
  await sendAlertNotifications(alert, config, site, monitor, [trigger], true);
  const record = (await db.getAttentionState(7, 3))!;
  expect(fetch).toHaveBeenCalledTimes(4);
  expect(record.state.messages).toHaveLength(4);
  expect(record.state.retry).toMatchObject({ attempts: 4, exhausted: true, nextAt: null });
  expect(await db.getDueAttentionRetries(Math.floor(Date.now() / 1000), [3])).toEqual([]);
  expect(
    (
      await attentionApi.PATCH(
        apiEvent({ action: "retry", revision: record.revision, reference: "fixture-configuration-corrected" }),
      )
    ).status,
  ).toBe(200);
  vi.stubGlobal("fetch", fetchReceipt());
  await sendAlertNotifications(alert, config, site, monitor, [trigger], true);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect((await db.getAttentionState(7, 3))!.state.messages.at(-1)?.outcome).toBe("sent");
});

it("honors a provider's longer rejection retry_after", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => rejection(120)),
  );
  await sendAlertNotifications(alert, config, site, monitor, [trigger]);
  vi.setSystemTime(Date.parse(at) + 60_000);
  await sendAlertNotifications(alert, config, site, monitor, [trigger], true);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect((await db.getAttentionState(7, 3))!.state.retry?.nextAt).toBe("2026-11-12T10:02:00.000Z");
});

it("starts the rejection delay when the response is observed, after a slow request", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      vi.setSystemTime(Date.parse(at) + 120_000);
      return rejection();
    }),
  );
  await sendAlertNotifications(alert, config, site, monitor, [trigger]);
  expect((await db.getAttentionState(7, 3))!.state.retry?.nextAt).toBe("2026-11-12T10:03:00.000Z");
  await sendAlertNotifications(alert, config, site, monitor, [trigger], true);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("requires complete pickup and a current revision/reference; reconciliation does not erase an attempt", () => {
  const record = {
    revision: 2,
    state: { facts: {}, messages: [{ attempt: "id", event: "opening", at, outcome: "unknown" as const }] },
  };
  expect(() =>
    applyAttentionChange(record, { revision: 1, reference: "fixture", action: "facts", facts: {} }),
  ).toThrow();
  expect(() =>
    applyAttentionChange(record, {
      revision: 2,
      reference: "fixture",
      action: "facts",
      facts: { pickup: { who: "Mira" } },
    }),
  ).toThrow();
  const result = applyAttentionChange(record, {
    revision: 2,
    reference: "fixture-proof",
    action: "reconcile",
    attempt: "id",
    outcome: "sent",
    at,
  });
  expect(result.messages).toHaveLength(1);
  expect(result.messages[0]).toMatchObject({ outcome: "sent", reference: "fixture-proof", boundary: "operator" });
});

it("exercises exact native API read/change/conflict without triggering a pickup ping", async () => {
  const event = (input?: unknown) =>
    ({
      params: { alert_id: "7", trigger_id: "3" },
      request: new Request("https://example.invalid/api/v4/attention/7/3", {
        method: "PATCH",
        body: JSON.stringify(input ?? {}),
      }),
    }) as Parameters<typeof attentionApi.PATCH>[0];
  const initial = await attentionApi.GET(event());
  expect(await initial.json()).toMatchObject({ record: null });
  const facts = { pickup: { who: "Fixture operator", since: at, session: "fixture-session", current: true } };
  const changed = await attentionApi.PATCH(
    event({ revision: 0, reference: "fixture-current-work", action: "facts", facts }),
  );
  expect(changed.status).toBe(200);
  expect(await changed.json()).toMatchObject({
    revision: 1,
    evaluated: false,
    state: { facts, factsReference: "fixture-current-work" },
  });
  expect(
    (await attentionApi.PATCH(event({ revision: 0, reference: "stale", action: "facts", facts: { pickup: null } })))
      .status,
  ).toBe(409);
  expect((await attentionApi.GET({ ...event(), params: { alert_id: "7", trigger_id: "99" } })).status).toBe(404);
  expect(fetch).not.toHaveBeenCalled();
});

// The public fork has no dependency on the operated composer. A private operator
// may qualify that exact pinned module using this same synthetic/native path.
describe.skipIf(!process.env.KENER_TEST_ATTENTION_COMPOSER)(
  "operated composer → native queue → database → sender",
  () => {
    const declaration = (tier: string) => ({
      attention: {
        version: 1,
        kinds: {},
        ownerQuestions: [],
        tiers: {
          immediate: { waitSeconds: 0, followUpSeconds: 1800, recovery: "always" },
          public: { waitSeconds: 3600, followUpSeconds: null, recovery: "if-notified" },
          private: { waitSeconds: null, followUpSeconds: null, recovery: "never" },
        },
        renotify: { standingChange: true, expandedImpact: true },
        failureKinds: {
          unavailable: { standing: "unknown", reason: "Unobserved cause" },
          "observation-gap": { standing: "unknown", reason: "Observation unavailable" },
          "configuration-error": { standing: "needs-action", reason: "Correction required" },
        },
      },
      capabilities: {
        fixture: {
          attention: {
            name: "Fixture system",
            kind: "fixture",
            description: "A synthetic public system.",
            why: "Fixture impact",
            handler: "Operator",
            checkedBy: "Fixture",
            paidFeature: "no",
            tier,
            updates: "self",
            updatePolicyReference: "fixture",
          },
        },
      },
      subjects: [
        {
          id: "part",
          capability: "fixture",
          monitor: "fixture",
          attention: {
            name: "Fixture part",
            impact: "Fixture impact",
            checkedBy: "Fixture",
            check: { state: "exists", mail: "connected", reference: "fixture" },
          },
        },
      ],
    });
    async function sample(status: string, minutes = 0) {
      vi.setSystemTime(Date.parse(at) + minutes * 60000);
      const ts = Math.floor(Date.now() / 1000);
      await knex("monitoring_data").insert({
        monitor_tag: "fixture",
        timestamp: ts,
        status,
        raw_status: status,
        latency: 1,
        type: "REALTIME",
      });
      await push("fixture", ts, status);
    }
    it("retries a rejected RESOLVED recovery on the existing app cadence without another monitor sample", async () => {
      configure(process.env.KENER_TEST_ATTENTION_COMPOSER!, declaration("immediate"));
      await sample("DOWN");
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => rejection()),
      );
      await sample("UP", 1);
      expect((await db.getMonitorAlertV2WithConfig(7))!.alert_status).toBe("RESOLVED");
      const failed = (await db.getAttentionState(7, 3))!;
      expect(failed.state.messages.at(-1)).toMatchObject({ event: "recovery", outcome: "failed" });
      expect(await db.getDueAttentionRetries(Date.parse(at) / 1000 + 119, [3])).toEqual([]);
      expect(await db.getDueAttentionRetries(Date.parse(at) / 1000 + 120, [3])).toEqual([
        { alert_id: 7, trigger_id: 3 },
      ]);
      vi.setSystemTime(Date.parse(at) + 120_000);
      vi.stubGlobal("fetch", fetchReceipt());
      await appScheduler.start();
      await queue.scheduler!({ data: {} });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(
        (await db.getAttentionState(7, 3))!.state.messages
          .filter((item) => item.event === "recovery")
          .map((item) => item.outcome),
      ).toEqual(["failed", "sent"]);
      vi.setSystemTime(Date.parse(at) + 180_000);
      await queue.scheduler!({ data: {} });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(await db.getDueAttentionRetries(Math.floor(Date.now() / 1000), [3])).toEqual([]);
    });

    it("opens immediately, follows once at thirty minutes, then recovers using successful native receipts", async () => {
      configure(process.env.KENER_TEST_ATTENTION_COMPOSER!, declaration("immediate"));
      await sample("DOWN");
      await sample("DOWN", 29);
      expect(fetch).toHaveBeenCalledTimes(1);
      await sample("DOWN", 30);
      await sample("DOWN", 31);
      expect(fetch).toHaveBeenCalledTimes(2);
      await sample("UP", 32);
      expect(fetch).toHaveBeenCalledTimes(3);
      const messages = (await knex("alert_notification_state").first()).state_json;
      expect(JSON.parse(messages).messages.map((item: { event: string }) => item.event)).toEqual([
        "opening",
        "follow-up",
        "recovery",
      ]);
      expect(String(vi.mocked(fetch).mock.calls[0][1]?.body)).toContain("Who is looking at it is not established");
      expect(String(vi.mocked(fetch).mock.calls[0][1]?.body)).not.toContain("Old template sentence");
    });
    it("waits an hour for public and suppresses recovery if no down message was submitted", async () => {
      configure(process.env.KENER_TEST_ATTENTION_COMPOSER!, declaration("public"));
      await sample("DOWN");
      await sample("DOWN", 59);
      expect(fetch).not.toHaveBeenCalled();
      await sample("UP", 60);
      expect(fetch).not.toHaveBeenCalled();
    });
    it("submits once after an hour then permits public recovery", async () => {
      configure(process.env.KENER_TEST_ATTENTION_COMPOSER!, declaration("public"));
      await sample("DOWN");
      await sample("DOWN", 60);
      expect(fetch).toHaveBeenCalledTimes(1);
      await sample("DOWN", 61);
      expect(fetch).toHaveBeenCalledTimes(1);
      await sample("UP", 62);
      expect(fetch).toHaveBeenCalledTimes(2);
    });
    it("keeps private incidents weekly-only even when correction is required", async () => {
      configure(process.env.KENER_TEST_ATTENTION_COMPOSER!, declaration("private"));
      await sample("DOWN");
      await sample("DOWN", 60);
      await sample("UP", 61);
      expect(fetch).not.toHaveBeenCalled();
    });
    it("carries genuine pickup into the later due message without pinging for pickup", async () => {
      configure(process.env.KENER_TEST_ATTENTION_COMPOSER!, declaration("immediate"));
      await sample("DOWN");
      const current = (await db.getAttentionState(7, 3))!;
      const changed = applyAttentionChange(current, {
        revision: current.revision,
        action: "facts",
        reference: "fixture-work",
        facts: { pickup: { who: "Fixture operator", since: at, session: "fixture-session", current: true } },
      });
      expect(await db.saveAttentionState(7, 3, current.revision, changed)).toBe(true);
      await sample("DOWN", 29);
      expect(fetch).toHaveBeenCalledTimes(1);
      await sample("DOWN", 30);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(String(vi.mocked(fetch).mock.calls[1][1]?.body)).toContain("Fixture operator picked it up");
    });
    it("holds unqualified HTTP acceptance through the actual composer on the next native cadence", async () => {
      configure(process.env.KENER_TEST_ATTENTION_COMPOSER!, declaration("immediate"));
      vi.stubGlobal("fetch", fetchReceipt("Not the submitted message"));
      await sample("DOWN");
      await sample("DOWN", 1);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect((await db.getAttentionState(7, 3))!.state.messages[0].outcome).toBe("accepted");
    });
    it("holds an interrupted persisted claim, then permits separately reconciled recovery through the operator", async () => {
      configure(process.env.KENER_TEST_ATTENTION_COMPOSER!, declaration("immediate"));
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new TypeError("synthetic timeout");
        }),
      );
      await sample("DOWN");
      const uncertain = (await db.getAttentionState(7, 3))!;
      expect(uncertain.state.messages[0].outcome).toBe("unknown");
      uncertain.state.messages[0].outcome = "sending";
      expect(await db.saveAttentionState(7, 3, uncertain.revision, uncertain.state)).toBe(true);
      await sample("DOWN", 30);
      expect(fetch).toHaveBeenCalledTimes(1);
      await sample("UP", 31);
      expect(fetch).toHaveBeenCalledTimes(1);
      const read = await db.ensureAttentionState(7, 3);
      const changed = applyAttentionChange(read, {
        revision: read.revision,
        action: "reconcile",
        reference: "fixture-provider-proof",
        attempt: read.state.messages[0].attempt,
        outcome: "sent",
        at,
      });
      expect(await db.saveAttentionState(7, 3, read.revision, changed)).toBe(true);
      const revision = (await db.getAttentionState(7, 3))!.revision;
      const success = fetchReceipt();
      vi.stubGlobal("fetch", success);
      const event = {
        params: { alert_id: "7", trigger_id: "3" },
        request: new Request("https://example.invalid/api/v4/attention/7/3", {
          method: "POST",
          body: JSON.stringify({ action: "evaluate", revision }),
        }),
      } as Parameters<typeof attentionApi.POST>[0];
      expect((await attentionApi.POST(event)).status).toBe(200);
      expect(success).toHaveBeenCalledTimes(1);
      expect((await db.getAttentionState(7, 3))!.state.messages.map((item) => [item.event, item.outcome])).toEqual([
        ["opening", "sent"],
        ["recovery", "sent"],
      ]);
    });
  },
);
