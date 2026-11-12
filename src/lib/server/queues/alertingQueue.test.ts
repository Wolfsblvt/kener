import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { readNotificationEvidence } from "../../../../wolf/notification/read.mjs";

// Substitute queue/database transports only. The production worker, variables, channel sender,
// evidence append and operator read run together; no Redis, provider or live database is used.
const state = vi.hoisted(() => ({
  process: undefined as undefined | ((job: { data: unknown }) => Promise<unknown>),
  active: null as null | { id: number; config_id: number; alert_status: string; created_at: Date; updated_at: Date },
  status: "DOWN",
  created: 0,
  resolved: 0,
}));
vi.mock("./q.js", () => ({
  default: {
    createQueue: () => ({ add: async (_name: string, data: unknown) => state.process!({ data }) }),
    createWorker: (_queue: unknown, process: typeof state.process) => {
      state.process = process;
      return { on: vi.fn(), close: vi.fn() };
    },
  },
}));
vi.mock("../db/db.js", () => ({
  default: { consecutivelyStatusFor: async (_tag: string, value: string) => value === state.status },
}));
vi.mock("../controllers/controller.js", () => ({
  GetAllSiteData: async () => ({ siteURL: "https://status.example/", siteName: "Status", logo: "", colors: {} }),
  GetMonitorsParsed: async () => [
    { tag: "downloads", name: "Product downloads", monitor_type: "NONE", monitor_settings_json: {} },
  ],
}));
vi.mock("../controllers/monitorAlertConfigController.js", () => ({
  GetMonitorAlertConfigs: async () => [
    {
      id: 2,
      monitor_tag: "downloads",
      alert_for: "STATUS",
      alert_value: "DOWN",
      failure_threshold: 2,
      success_threshold: 1,
      severity: "CRITICAL",
      create_incident: "NO",
    },
  ],
  GetMonitorAlertsV2: async () => (state.active?.alert_status === "TRIGGERED" ? [state.active] : []),
  CreateMonitorAlertV2: async () => {
    state.created++;
    state.active = {
      id: 7,
      config_id: 2,
      alert_status: "TRIGGERED",
      created_at: new Date("2026-11-01T08:00:00Z"),
      updated_at: new Date("2026-11-01T08:00:00Z"),
    };
    return state.active;
  },
  UpdateMonitorAlertV2Status: async () => {
    state.resolved++;
    state.active = { ...state.active!, alert_status: "RESOLVED", updated_at: new Date("2026-11-01T09:00:00Z") };
    return state.active;
  },
  GetTriggersByMonitorAlertConfigId: async () => [
    {
      id: 3,
      trigger_type: "webhook",
      trigger_meta: JSON.stringify({
        url: "https://provider.example/",
        headers: [],
        webhook_body: "{{monitor_name}} {{alert_transition}} {{alert_transition_at}}",
      }),
    },
  ],
}));
import queue from "./alertingQueue.js";
let directory: string;
beforeAll(() => {
  mkdirSync("artifacts/tests", { recursive: true });
  directory = mkdtempSync("artifacts/tests/notification-queue-");
  vi.stubEnv("KENER_NOTIFICATION_LOG_DIR", directory);
});
afterAll(async () => {
  await queue.shutdown();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(directory, { recursive: true, force: true });
});

it("keeps one send per new episode and one recovery; failed submission is not a job-completion receipt", async () => {
  const fetchMock = vi.fn().mockImplementation(async () => new Response("provider declined", { status: 503 }));
  vi.stubGlobal("fetch", fetchMock);
  await queue.push("downloads", 1, "DOWN");
  await queue.push("downloads", 2, "DOWN");
  expect(state.created).toBe(1);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][1].body).toBe("Product downloads failing 2026-11-01T08:00:00.000Z");
  expect(readNotificationEvidence(directory, 7, "TRIGGERED", 3).attempts[0]).toMatchObject({
    outcome: "failed",
    http_status: 503,
  });
  state.status = "UP";
  fetchMock.mockImplementation(async () => new Response("ok", { status: 200 }));
  await queue.push("downloads", 3, "UP");
  await queue.push("downloads", 4, "UP");
  expect(state.resolved).toBe(1);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1][1].body).toBe("Product downloads recovered 2026-11-01T09:00:00.000Z");
  expect(readNotificationEvidence(directory, 7, "RESOLVED", 3).attempts[0]).toMatchObject({
    outcome: "accepted",
    transition_at: "2026-11-01T09:00:00.000Z",
  });
});
