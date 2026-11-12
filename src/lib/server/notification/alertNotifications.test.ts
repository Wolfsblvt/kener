import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { sendAlertNotifications } from "./alertNotifications.js";
import sendEmail from "./email_notification.js";
import { recordNotificationEvidence } from "./notificationEvidence.js";
import { readNotificationEvidence } from "../../../../wolf/notification/read.mjs";
import type { MonitorAlertConfigRecord, MonitorAlertV2Record, TriggerRecord } from "../types/db.js";
import type { SiteDataForNotification } from "./types.js";

vi.mock("./email_notification.js", () => ({ default: vi.fn() }));
const config = {
  id: 2,
  monitor_tag: "downloads",
  alert_for: "STATUS",
  alert_value: "DOWN",
  severity: "CRITICAL",
  alert_description: "The stable link may not resolve",
  failure_threshold: 2,
  success_threshold: 1,
} as MonitorAlertConfigRecord;
const alert = {
  id: 7,
  config_id: 2,
  alert_status: "TRIGGERED",
  created_at: new Date("2026-11-01T08:00:00Z"),
  updated_at: new Date("2026-11-01T08:00:00Z"),
} as MonitorAlertV2Record;
const site = { site_url: "https://status.example/" } as SiteDataForNotification;
const monitor = { tag: "downloads", name: "Product downloads" };
const trigger = (
  id = 3,
  type = "webhook",
  meta = JSON.stringify({
    url: "https://endpoint.example/SECRET",
    headers: [],
    webhook_body:
      "{{monitor_name}} {{monitor_tag}} {{alert_transition}} {{alert_started_at}} {{alert_transition_at}} {{alert_message}}",
    to: "operator@example.invalid",
    email_body: "body",
    email_subject: "subject",
  }),
) => ({ id, trigger_type: type, trigger_meta: meta }) as TriggerRecord;
let directory: string;
let fetchMock: ReturnType<typeof vi.fn>;
const read = (transition = "TRIGGERED", triggerId = 3) => readNotificationEvidence(directory, 7, transition, triggerId);

beforeEach(() => {
  mkdirSync("artifacts/tests", { recursive: true });
  directory = mkdtempSync("artifacts/tests/notification-");
  vi.stubEnv("KENER_NOTIFICATION_LOG_DIR", directory);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

describe("native notification dispatch and retained operator read", () => {
  it("carries readable variables through the real webhook sender and retains HTTP acknowledgement only", async () => {
    fetchMock.mockResolvedValue(new Response('{"private":"SECRET"}', { status: 200 }));
    await sendAlertNotifications(alert, config, site, monitor, [trigger()]);
    expect(fetchMock.mock.calls[0][1].body).toContain("Product downloads downloads failing 2026-11-01T08:00:00.000Z");
    expect(read().attempts).toEqual([
      expect.objectContaining({
        outcome: "accepted",
        reason: "http_accepted",
        http_status: 200,
        alert_id: 7,
        config_id: 2,
        trigger_id: 3,
        transition: "TRIGGERED",
        phase: "result",
      }),
    ]);
    const raw = readdirSync(directory)
      .map((file) => readFileSync(join(directory, file), "utf8"))
      .join("");
    expect(raw).not.toMatch(/SECRET|endpoint|operator@|Product downloads|stable link/);
  });
  it("keeps recovery correlated to the same event but records its own transition time", async () => {
    fetchMock.mockImplementation(async () => new Response("", { status: 200 }));
    await sendAlertNotifications(alert, config, site, monitor, [trigger()]);
    await sendAlertNotifications(
      { ...alert, alert_status: "RESOLVED", updated_at: new Date("2026-11-01T09:00:00Z") },
      config,
      site,
      monitor,
      [trigger()],
    );
    expect(read().attempts[0].transition_at).toBe("2026-11-01T08:00:00.000Z");
    expect(read("RESOLVED").attempts[0]).toMatchObject({
      outcome: "accepted",
      transition_at: "2026-11-01T09:00:00.000Z",
    });
    expect(fetchMock.mock.calls[1][1].body).toContain("recovered 2026-11-01T08:00:00.000Z 2026-11-01T09:00:00.000Z");
  });
  it("retains HTTP rejection without raw provider text and continues the existing trigger loop", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValue(new Response("SECRET endpoint error", { status: 503 }));
    await sendAlertNotifications(alert, config, site, monitor, [trigger(), trigger(4)]);
    expect(read().attempts[0]).toMatchObject({ outcome: "failed", http_status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(errors).not.toHaveBeenCalled();
  });
  it("does not turn transport uncertainty or a completed dispatch into delivery", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockRejectedValue(new TypeError("SECRET endpoint failed"));
    await sendAlertNotifications(alert, config, site, monitor, [trigger()]);
    expect(read().attempts[0].outcome).toBe("unknown");
    expect(errors).not.toHaveBeenCalled();
  });
  it("keeps a known HTTP acknowledgement if reading the response body fails", async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      text: async () => {
        throw new Error("SECRET body error");
      },
    });
    await sendAlertNotifications(alert, config, site, monitor, [trigger()]);
    expect(read().attempts[0]).toMatchObject({ outcome: "accepted", reason: "http_accepted", http_status: 200 });
  });
  it("does not interpret a generic HTTP 200 body as application or human delivery", async () => {
    fetchMock.mockResolvedValue(new Response('{"ok":false,"description":"SECRET"}', { status: 200 }));
    await sendAlertNotifications(alert, config, site, monitor, [trigger()]);
    expect(read().attempts[0]).toMatchObject({ outcome: "accepted", reason: "http_accepted" });
    expect(read().attempts[0]).not.toHaveProperty("delivered");
  });
  it("records malformed trigger metadata as not attempted and leaves later channels unsent", async () => {
    await expect(
      sendAlertNotifications(alert, config, site, monitor, [trigger(3, "webhook", "invalid SECRET"), trigger(4)]),
    ).rejects.toThrow("dispatch aborted");
    expect(read().attempts[0]).toMatchObject({ outcome: "not_attempted", reason: "invalid_configuration" });
    expect(read("TRIGGERED", 4).attempts[0]).toMatchObject({
      outcome: "not_attempted",
      reason: "earlier_trigger_aborted",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("records skipped and aborted sends explicitly and preserves thrown-email abort behavior", async () => {
    await sendAlertNotifications(alert, config, site, monitor, [trigger(3, "email", '{"to":" , "}')]);
    expect(read().attempts[0]).toMatchObject({ outcome: "not_attempted", reason: "no_recipients" });
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error("SECRET provider rejection"));
    await expect(
      sendAlertNotifications(alert, config, site, monitor, [trigger(4, "email"), trigger(5)]),
    ).rejects.toThrow("dispatch aborted");
    expect(read("TRIGGERED", 4).attempts[0]).toMatchObject({ outcome: "unknown", reason: "send_exception" });
    expect(read("TRIGGERED", 5).attempts[0]).toMatchObject({
      outcome: "not_attempted",
      reason: "earlier_trigger_aborted",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["slack", "discord"])("records %s acceptance through its real sender", async (type) => {
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));
    await sendAlertNotifications(alert, config, site, monitor, [
      trigger(3, type, JSON.stringify({ url: "https://example.invalid/SECRET", [`${type}_body`]: "{{monitor_name}}" })),
    ]);
    expect(read().attempts[0]).toMatchObject({ channel: type, outcome: "accepted" });
  });
  it.each([
    [{ accepted: ["SECRET"], rejected: [] }, "accepted"],
    [{ accepted: ["SECRET"], rejected: ["SECRET"] }, "unknown"],
    [{ accepted: [], rejected: ["SECRET"] }, "failed"],
    [{ data: { id: "SECRET" }, error: null }, "accepted"],
    [undefined, "unknown"],
  ])("reduces the mail result %j to %s", async (response, outcome) => {
    vi.mocked(sendEmail).mockResolvedValueOnce(response as never);
    await sendAlertNotifications(alert, config, site, monitor, [trigger(3, "email")]);
    expect(read().attempts[0].outcome).toBe(outcome);
  });
  it("leaves missing or interrupted evidence unknown and does not guess not-attempted", () => {
    expect(read()).toMatchObject({ outcome_if_absent: "unknown", attempts: [] });
    recordNotificationEvidence({
      attempt_id: "interrupted",
      alert_id: 7,
      config_id: 2,
      trigger_id: 3,
      transition: "TRIGGERED",
      transition_at: "2026-11-01T08:00:00Z",
      channel: "webhook",
      phase: "attempt",
      outcome: "unknown",
      reason: "pending",
    });
    expect(read().attempts[0]).toMatchObject({ outcome: "unknown", phase: "attempt" });
  });
  it("exercises the supported CLI against retained evidence and reports a truncated read honestly", async () => {
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));
    await sendAlertNotifications(alert, config, site, monitor, [trigger()]);
    const args = [
      "wolf/notification/read.mjs",
      "--directory",
      directory,
      "--alert",
      "7",
      "--transition",
      "TRIGGERED",
      "--trigger",
      "3",
    ];
    const result = spawnSync(process.execPath, args, { encoding: "utf8", windowsHide: true, stdio: "pipe" });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).attempts[0]).toMatchObject({ outcome: "accepted", reason: "http_accepted" });
    writeFileSync(join(directory, "notification-2026-01-01.jsonl"), '{"truncated SECRET');
    const incomplete = spawnSync(process.execPath, args, { encoding: "utf8", windowsHide: true, stdio: "pipe" });
    expect(incomplete.status).toBe(2);
    expect(JSON.parse(incomplete.stdout)).toMatchObject({ read_incomplete: true });
    expect(incomplete.stdout + incomplete.stderr).not.toContain("SECRET");
  });
  it("expires only owned old segments, enforces the daily bound, and signals evidence failure safely", async () => {
    writeFileSync(join(directory, "notification-2000-01-01.jsonl"), "old");
    writeFileSync(join(directory, "keep.txt"), "keep");
    fetchMock.mockImplementation(async () => new Response("", { status: 200 }));
    await sendAlertNotifications(alert, config, site, monitor, [trigger()]);
    expect(readdirSync(directory)).not.toContain("notification-2000-01-01.jsonl");
    expect(readdirSync(directory)).toContain("keep.txt");
    const path = join(directory, `notification-${new Date().toISOString().slice(0, 10)}.jsonl`);
    writeFileSync(path, " ".repeat(4 * 1024 * 1024));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await sendAlertNotifications(alert, config, site, monitor, [trigger()]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("notification.evidence_unavailable"));
    expect(readFileSync(path).length).toBe(4 * 1024 * 1024);
  });
});
