import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { readNotificationEvidence } from "./read.mjs";

const attempt = {
  event: "notification.send",
  timestamp: "2026-11-12T10:00:00.000Z",
  attempt_id: "d279c732-df78-4b2b-a256-ae9c45046274",
  alert_id: 7,
  config_id: 2,
  trigger_id: 3,
  transition: "TRIGGERED",
  transition_at: "2026-11-12T09:59:00.000Z",
  channel: "webhook",
  phase: "attempt",
  outcome: "unknown",
  reason: "pending",
};
const accepted = {
  ...attempt,
  timestamp: "2026-11-12T10:00:00.010Z",
  phase: "result",
  outcome: "accepted",
  reason: "http_accepted",
  http_status: 200,
  duration_ms: 10,
};
let directory;
beforeEach(() => {
  mkdirSync("artifacts/tests", { recursive: true });
  directory = mkdtempSync("artifacts/tests/evidence-contract-");
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));
const read = (rows) => {
  writeFileSync(join(directory, "notification-2026-11-12.jsonl"), rows.map(JSON.stringify).join("\n") + "\n");
  return readNotificationEvidence(directory, 7, "TRIGGERED", 3);
};

test("joins an actual attempt/result, tolerates identical copies and reversed file order", () => {
  for (const rows of [
    [attempt, accepted],
    [accepted, attempt],
    [accepted, accepted, attempt],
  ]) {
    const result = read(rows);
    assert.equal(result.read_incomplete, false);
    assert.equal(result.attempts.length, 1);
    assert.equal(result.attempts[0].outcome, "accepted");
  }
});

test("hostile nested values and forged acknowledgements never escape", () => {
  const result = read([
    attempt,
    { ...accepted, timestamp: { private: "HOSTILE_SENTINEL" }, reason: { private: "HOSTILE_SENTINEL" } },
  ]);
  assert.equal(result.read_incomplete, true);
  assert.deepEqual(result.attempts, []);
  assert.equal(JSON.stringify(result).includes("HOSTILE_SENTINEL"), false);
  assert.equal(read([accepted]).read_incomplete, true);
  assert.deepEqual(read([accepted]).attempts, []);
});

test("rejects invalid producer values and phase/outcome/channel relationships", () => {
  const invalid = [
    null,
    [],
    7,
    { ...accepted, attempt_id: "not-a-uuid" },
    { ...accepted, alert_id: -1 },
    { ...accepted, config_id: {} },
    { ...accepted, trigger_id: 1.5 },
    { ...accepted, timestamp: "2026-02-30T10:00:00.000Z" },
    { ...accepted, transition_at: "yesterday" },
    { ...accepted, channel: "PRIVATE_SENTINEL" },
    { ...accepted, outcome: { private: "PRIVATE_SENTINEL" } },
    { ...accepted, http_status: 503 },
    { ...accepted, http_status: 600 },
    { ...accepted, duration_ms: -1 },
    { ...accepted, duration_ms: 1.5 },
    { ...accepted, reason: "mail_accepted" },
    { ...attempt, http_status: 200 },
    { ...attempt, outcome: "accepted" },
    { ...attempt, channel: "unsupported" },
    { ...accepted, outcome: "not_attempted", reason: "no_recipients" },
  ];
  for (const row of invalid) {
    const result = read([row]);
    assert.equal(result.read_incomplete, true);
    assert.deepEqual(result.attempts, []);
    assert.equal(JSON.stringify(result).includes("PRIVATE_SENTINEL"), false);
  }
});

test("conflicting results, identities and backwards times cannot count as acceptance", () => {
  for (const row of [
    { ...accepted, outcome: "failed", reason: "http_rejected", http_status: 503 },
    { ...accepted, config_id: 9 },
    { ...accepted, trigger_id: 9 },
    { ...accepted, alert_id: 9 },
    { ...accepted, transition: "RESOLVED" },
    { ...accepted, transition_at: "2026-11-12T09:58:00.000Z" },
    { ...accepted, timestamp: "2026-11-12T09:59:59.000Z" },
  ]) {
    const result = read([attempt, accepted, row]);
    assert.equal(result.read_incomplete, true);
    assert.deepEqual(result.attempts, []);
  }
});

test("keeps pending uncertainty and valid standalone no-send evidence", () => {
  assert.equal(read([attempt]).attempts[0].outcome, "unknown");
  const skipped = { ...attempt, phase: "result", outcome: "not_attempted", reason: "invalid_configuration" };
  assert.equal(read([skipped]).read_incomplete, false);
  assert.equal(read([skipped]).attempts[0].outcome, "not_attempted");
});
