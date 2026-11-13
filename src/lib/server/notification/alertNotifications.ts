import { randomUUID } from "node:crypto";
import type { MonitorAlertConfigRecord, MonitorAlertV2Record, TriggerMeta, TriggerRecord } from "../types/db.js";
import type { SiteDataForNotification } from "./types.js";
import { alertToVariables } from "./notification_utils.js";
import sendEmail from "./email_notification.js";
import sendWebhook, { InvalidWebhookHeadersError, parseWebhookHeaders } from "./webhook_notification.js";
import sendSlack from "./slack_notification.js";
import sendDiscord from "./discord_notification.js";
import { recordNotificationEvidence, type NotificationEvidence } from "./notificationEvidence.js";
import { dispatchAttention } from "./attentionDispatch.js";

/** Reduced notification boundary error; provider/configuration exceptions never escape as its cause. */
export class NotificationDispatchError extends Error {
  constructor() {
    super("Alert notification dispatch aborted; inspect retained notification evidence");
    this.name = "NotificationDispatchError";
  }
}

type ResultEvidence = Pick<NotificationEvidence, "outcome" | "reason" | "http_status">;

function classifyResult(channel: NotificationEvidence["channel"], result: unknown): ResultEvidence {
  if (!result || typeof result !== "object") return { outcome: "unknown", reason: "unclassified_result" };
  const value = result as Record<string, unknown>;
  if (channel !== "email") {
    const status =
      typeof value.status === "number" && Number.isInteger(value.status) && value.status >= 100 && value.status <= 599
        ? value.status
        : undefined;
    if (status !== undefined) {
      return status >= 200 && status < 300
        ? { outcome: "accepted", reason: "http_accepted", http_status: status }
        : { outcome: "failed", reason: "http_rejected", http_status: status };
    }
    return { outcome: "unknown", reason: value.error ? "send_exception" : "unclassified_result" };
  }
  // SMTP may accept only some recipients; never turn that into complete acceptance.
  if (Array.isArray(value.accepted) && Array.isArray(value.rejected)) {
    if (value.accepted.length > 0 && value.rejected.length === 0)
      return { outcome: "accepted", reason: "mail_accepted" };
    if (value.accepted.length > 0) return { outcome: "unknown", reason: "partial_mail_acceptance" };
    if (value.rejected.length > 0) return { outcome: "failed", reason: "mail_rejected" };
  }
  // Resend's SDK returns a data.id only on provider acceptance. Never retain the payload/id.
  const data = value.data as { id?: unknown } | null | undefined;
  if (!value.error && typeof data?.id === "string" && data.id.length > 0)
    return { outcome: "accepted", reason: "mail_accepted" };
  return { outcome: "unknown", reason: "unclassified_result" };
}

/** Native alert-channel dispatch, with retained evidence independent of job completion. */
export async function sendAlertNotifications(
  alert: MonitorAlertV2Record,
  config: MonitorAlertConfigRecord,
  site: SiteDataForNotification,
  monitor: { tag: string; name: string },
  triggers: TriggerRecord[],
  attentionOnly = false,
): Promise<void> {
  const variables = { ...alertToVariables(config, alert, site, monitor.tag, monitor.name), ...site };
  let aborted = false;
  for (const trigger of triggers) {
    const channel =
      (["email", "webhook", "slack", "discord"] as const).find((value) => value === trigger.trigger_type) ||
      "unsupported";
    const evidence: NotificationEvidence = {
      attempt_id: randomUUID(),
      alert_id: alert.id,
      config_id: config.id,
      trigger_id: trigger.id,
      transition: alert.alert_status === "RESOLVED" ? "RESOLVED" : "TRIGGERED",
      transition_at: variables.alert_transition_at,
      channel,
      phase: "result",
      outcome: "not_attempted",
      reason: "invalid_configuration",
    };
    if (aborted) {
      recordNotificationEvidence({ ...evidence, reason: "earlier_trigger_aborted" });
      continue;
    }
    let started = false;
    const start = performance.now();
    try {
      if (await dispatchAttention(alert, config, trigger, variables)) continue;
      if (attentionOnly) continue;
      const meta = JSON.parse(trigger.trigger_meta) as TriggerMeta;
      if (channel === "unsupported") {
        evidence.reason = "unsupported_channel";
        throw new Error("unsupported_channel");
      }
      // Preserve upstream's empty-recipient skip and its exception/abort semantics.
      const addresses =
        channel === "email"
          ? meta.to
              .trim()
              .split(",")
              .map((address) => address.trim())
              .filter(Boolean)
          : [];
      if (channel === "email" && addresses.length === 0) {
        recordNotificationEvidence({ ...evidence, reason: "no_recipients" });
        continue;
      }
      if (channel === "webhook") parseWebhookHeaders(JSON.stringify(meta.headers));
      recordNotificationEvidence({ ...evidence, phase: "attempt", outcome: "unknown", reason: "pending" });
      started = true;
      let result: unknown;
      if (channel === "email")
        result = await sendEmail(meta.email_body, meta.email_subject, variables, addresses, meta.from);
      else if (channel === "webhook")
        result = await sendWebhook(meta.webhook_body, variables, meta.url, JSON.stringify(meta.headers));
      else if (channel === "discord") result = await sendDiscord(meta.discord_body, variables, meta.url);
      else result = await sendSlack(meta.slack_body, variables, meta.url);
      recordNotificationEvidence({
        ...evidence,
        ...classifyResult(channel, result),
        duration_ms: Math.round(performance.now() - start),
      });
    } catch (error) {
      const invalidHeaders = error instanceof InvalidWebhookHeadersError;
      recordNotificationEvidence({
        ...evidence,
        outcome: started && !invalidHeaders ? "unknown" : "not_attempted",
        reason: invalidHeaders ? "invalid_configuration" : started ? "send_exception" : evidence.reason,
        duration_ms: Math.round(performance.now() - start),
      });
      aborted = true;
    }
  }
  // Upstream aborts remaining triggers on a thrown send; keep that behavior without exposing its raw error.
  if (aborted) throw new NotificationDispatchError();
}
