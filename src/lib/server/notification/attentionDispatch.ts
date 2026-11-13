import { randomUUID } from "node:crypto";
import db from "../db/db.js";
import type { MonitorAlertConfigRecord, MonitorAlertV2Record, TriggerMeta, TriggerRecord } from "../types/db.js";
import type { AlertVariableMap } from "./types.js";
import type { AttentionReceipt } from "./attentionTypes.js";
import { hasUncertainAttention } from "./attentionTypes.js";
import { loadAttentionComposer, readAttentionConfig } from "./attentionComposer.js";
import { GetTriggersByMonitorAlertConfigId } from "../controllers/monitorAlertConfigController.js";
import { GetAllSiteData } from "../controllers/siteDataController.js";
import { alertToVariables, siteDataToVariables } from "./notification_utils.js";
import sendWebhook, { parseWebhookHeaders } from "./webhook_notification.js";
import { recordNotificationEvidence, type NotificationEvidence } from "./notificationEvidence.js";

/** HTTP acknowledgement alone does not prove sendMessage's useful submission. */
export function attentionReceipt(
  result: unknown,
): Pick<AttentionReceipt, "outcome" | "boundary" | "retryAfterSeconds"> {
  if (!result || typeof result !== "object") return { outcome: "unknown" };
  const value = result as { status?: number; data?: string; attentionSubmitted?: boolean; error?: unknown };
  if (!value.status || value.status >= 500 || (value.error && !value.data)) return { outcome: "unknown" };
  try {
    const body = JSON.parse(value.data ?? "");
    if (
      body.ok === false &&
      Number.isInteger(body.error_code) &&
      body.error_code >= 400 &&
      body.error_code < 500 &&
      typeof body.description === "string" &&
      body.description.trim() &&
      body.result === undefined
    ) {
      const retryAfter = body.parameters?.retry_after;
      return {
        outcome: "failed",
        boundary: "telegram-rejection",
        ...(Number.isSafeInteger(retryAfter) && retryAfter > 0 ? { retryAfterSeconds: retryAfter } : {}),
      };
    }
    if (value.status >= 200 && value.status < 300 && body.ok === true && value.attentionSubmitted === true)
      return { outcome: "sent", boundary: "telegram-message" };
  } catch {
    /* A successful HTTP response without a usable Message stays uncertain. */
  }
  return value.status >= 200 && value.status < 300 ? { outcome: "accepted", boundary: "http" } : { outcome: "unknown" };
}

// Delivery retries are distinct from the composer's alert timing. Four total
// attempts bound automatic noise/state; an operator can rearm after correction.
const retryDelaysSeconds = [60, 300, 1800];

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
      deliveryUncertain: hasUncertainAttention(record.state.messages),
    },
  });
  if (!composition.notification.event) {
    if (record.state.retry?.nextAt) {
      record.state.retry.nextAt = null;
      await db.saveAttentionState(alert.id, trigger.id, record.revision, record.state);
    }
    return true;
  }
  const key = JSON.stringify([
    composition.notification.event,
    composition.notification.standing,
    [...(facts.affectedSystems ?? [])].sort(),
  ]);
  const previous = record.state.retry?.key === key ? record.state.retry : undefined;
  if (previous && (previous.exhausted || (previous.nextAt && Date.parse(previous.nextAt) > Date.parse(now))))
    return true;
  const attempt: AttentionReceipt = {
    attempt: randomUUID(),
    event: composition.notification.event,
    at: now,
    outcome: "sending",
    standing: composition.notification.standing,
    affectedSystems: facts.affectedSystems ?? [],
  };
  const retry = { key, attempts: (previous?.attempts ?? 0) + 1, nextAt: null as string | null, exhausted: false };
  const state = { ...record.state, messages: [...record.state.messages, attempt], retry };
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
  let receipt: ReturnType<typeof attentionReceipt>;
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
  if (receipt.outcome === "failed") {
    const delay = retryDelaysSeconds[retry.attempts - 1];
    current.state.retry = {
      ...retry,
      exhausted: delay === undefined,
      nextAt:
        delay === undefined
          ? null
          : new Date(Date.now() + Math.max(delay, receipt.retryAfterSeconds ?? 0) * 1000).toISOString(),
    };
  } else if (receipt.outcome === "sent") delete current.state.retry;
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

/** Existing application cadence resumes durable retries even after RESOLVED. */
export async function retryAttentionDeliveries(now = new Date().toISOString()) {
  const config = await readAttentionConfig();
  if (!config) return;
  const due = await db.getDueAttentionRetries(Math.floor(Date.parse(now) / 1000), config.triggerIds);
  if (!due.length) return;
  const site = siteDataToVariables(await GetAllSiteData());
  for (const item of due) {
    try {
      const alert = await db.getMonitorAlertV2WithConfig(item.alert_id);
      if (!alert || alert.config.is_active !== "YES" || !alert.monitor_tag) continue;
      const trigger = (await GetTriggersByMonitorAlertConfigId(alert.config_id)).find(
        (entry) => entry.id === item.trigger_id && entry.trigger_status === "ACTIVE",
      );
      if (!trigger) continue;
      await dispatchAttention(
        alert,
        alert.config,
        trigger,
        alertToVariables(alert.config, alert, site, alert.monitor_tag, alert.monitor_tag),
        now,
      );
    } catch {
      // Never disclose provider/configuration objects; the stored claim is retained.
      console.error("Attention retry held", { alert_id: item.alert_id, trigger_id: item.trigger_id });
    }
  }
}
