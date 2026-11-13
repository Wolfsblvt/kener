import { randomUUID } from "node:crypto";
import db from "../db/db.js";
import type { MonitorAlertConfigRecord, MonitorAlertV2Record, TriggerMeta, TriggerRecord } from "../types/db.js";
import type { AlertVariableMap } from "./types.js";
import type { AttentionReceipt } from "./attentionTypes.js";
import { loadAttentionComposer } from "./attentionComposer.js";
import sendWebhook, { parseWebhookHeaders } from "./webhook_notification.js";
import { recordNotificationEvidence, type NotificationEvidence } from "./notificationEvidence.js";

/** HTTP acknowledgement alone does not prove sendMessage's useful submission. */
export function attentionReceipt(result: unknown): Pick<AttentionReceipt, "outcome" | "boundary"> {
  if (!result || typeof result !== "object") return { outcome: "unknown" };
  const value = result as { status?: number; data?: string; attentionSubmitted?: boolean };
  if (value.status && (value.status < 200 || value.status >= 300)) return { outcome: "failed", boundary: "http" };
  if (!value.status || value.status < 200 || value.status >= 300) return { outcome: "unknown" };
  try {
    const body = JSON.parse(value.data ?? "");
    if (body.ok === false) return { outcome: "failed", boundary: "http" };
    if (body.ok === true && value.attentionSubmitted === true) return { outcome: "sent", boundary: "telegram-message" };
  } catch {
    /* A successful HTTP response without a usable Message stays uncertain. */
  }
  return { outcome: "accepted", boundary: "http" };
}

/** Return false only for an unselected trigger. Repeat cadence never runs legacy sends. */
export async function dispatchAttention(
  alert: MonitorAlertV2Record,
  config: MonitorAlertConfigRecord,
  trigger: TriggerRecord,
  variables: AlertVariableMap,
  now = new Date().toISOString(),
  expectedRevision?: number,
): Promise<boolean> {
  const composer = await loadAttentionComposer(trigger.id);
  if (!composer) return false;
  if (config.alert_for !== "STATUS" || !["DOWN", "NO_DATA"].includes(config.alert_value))
    throw new Error("attention_alert_kind_unqualified");
  if (trigger.trigger_type !== "webhook") throw new Error("attention_channel_unqualified");
  const meta = JSON.parse(trigger.trigger_meta) as TriggerMeta;
  // Configuration refusal is before the durable sending claim and before HTTP.
  parseWebhookHeaders(JSON.stringify(meta.headers));
  const record = await db.ensureAttentionState(alert.id, trigger.id);
  if (expectedRevision !== undefined && record.revision !== expectedRevision)
    throw new Error("attention_revision_conflict");
  const facts = { ...record.state.facts };
  // Missing observation is always blindness; an operator cannot turn it into outage.
  if (config.alert_value === "NO_DATA") facts.failureKind = "observation-gap";
  const composition = composer.compose(variables, now, {
    ...facts,
    messages: record.state.messages,
    ...{
      deliveryUncertain: record.state.messages.some((item) =>
        ["sending", "unknown", "accepted"].includes(item.outcome),
      ),
    },
  });
  if (!composition.notification.event) return true;
  const attempt: AttentionReceipt = {
    attempt: randomUUID(),
    event: composition.notification.event,
    at: now,
    outcome: "sending",
    standing: composition.notification.standing,
    affectedSystems: facts.affectedSystems ?? [],
  };
  const state = { ...record.state, messages: [...record.state.messages, attempt] };
  if (!(await db.saveAttentionState(alert.id, trigger.id, record.revision, state))) return true;
  const evidence: NotificationEvidence = {
    attempt_id: attempt.attempt,
    alert_id: alert.id,
    config_id: config.id,
    trigger_id: trigger.id,
    transition: alert.alert_status === "RESOLVED" ? "RESOLVED" : "TRIGGERED",
    transition_at: variables.alert_transition_at,
    channel: "webhook",
    phase: "attempt",
    outcome: "unknown",
    reason: "pending",
  };
  recordNotificationEvidence(evidence);
  const start = performance.now();
  let httpStatus: number | undefined;
  let receipt: Pick<AttentionReceipt, "outcome" | "boundary">;
  try {
    const result = await sendWebhook(
      meta.webhook_body,
      { ...variables },
      meta.url,
      JSON.stringify(meta.headers),
      composition.text,
    );
    httpStatus = result.status;
    receipt = attentionReceipt(result);
  } catch {
    receipt = { outcome: "unknown" };
  }
  // If the process dies, sending remains authoritative and refuses blind retry.
  // Re-read allows a genuine pickup edit during HTTP without discarding it.
  const current = await db.getAttentionState(alert.id, trigger.id);
  if (
    !current ||
    !current.state.messages.some((item) => item.attempt === attempt.attempt && item.outcome === "sending")
  )
    throw new Error("attention_completion_conflict");
  current.state.messages = current.state.messages.map((item) =>
    item.attempt === attempt.attempt ? { ...item, ...receipt } : item,
  );
  if (!(await db.saveAttentionState(alert.id, trigger.id, current.revision, current.state)))
    throw new Error("attention_completion_conflict");
  // This pre-existing diagnostic contract records HTTP evidence only. The native
  // database above is authoritative for useful submission and reconciliation.
  recordNotificationEvidence({
    ...evidence,
    phase: "result",
    duration_ms: Math.round(performance.now() - start),
    ...(httpStatus === undefined
      ? { outcome: "unknown", reason: "unclassified_result" }
      : {
          http_status: httpStatus,
          outcome: httpStatus >= 200 && httpStatus < 300 ? "accepted" : "failed",
          reason: httpStatus >= 200 && httpStatus < 300 ? "http_accepted" : "http_rejected",
        }),
  });
  return true;
}
