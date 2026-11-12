const CHANNELS = new Set(["email", "webhook", "slack", "discord", "unsupported"]);
const HTTP_CHANNELS = new Set(["webhook", "slack", "discord"]);
const FIELDS = [
  "timestamp",
  "attempt_id",
  "alert_id",
  "config_id",
  "trigger_id",
  "transition",
  "transition_at",
  "channel",
  "phase",
  "outcome",
  "reason",
  "http_status",
  "duration_ms",
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** @param {unknown} value */
const positiveId = (value) => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
/** @param {unknown} value */
const isoTime = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return false;
  return Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
};

/**
 * Validate the finite producer row and return only safe fields, or null. No raw value is returned on refusal.
 * @param {unknown} value
 * @returns {(import("../../src/lib/server/notification/notificationEvidence.js").NotificationEvidence & { timestamp: string }) | null}
 */
export function parseNotificationEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = /** @type {Record<string, unknown>} */ (value);
  if (Object.keys(row).some((key) => key !== "event" && !FIELDS.includes(key))) return null;
  if (row.event !== "notification.send" || typeof row.attempt_id !== "string" || !UUID.test(row.attempt_id))
    return null;
  if (![row.alert_id, row.config_id, row.trigger_id].every(positiveId)) return null;
  if (typeof row.transition !== "string" || !["TRIGGERED", "RESOLVED"].includes(row.transition)) return null;
  if (typeof row.channel !== "string" || !CHANNELS.has(row.channel) || typeof row.reason !== "string") return null;
  if (!isoTime(row.timestamp) || !isoTime(row.transition_at)) return null;
  if (
    row.duration_ms !== undefined &&
    (typeof row.duration_ms !== "number" || !Number.isSafeInteger(row.duration_ms) || row.duration_ms < 0)
  )
    return null;

  const http = HTTP_CHANNELS.has(row.channel);
  const status = row.http_status;
  const hasStatus = status !== undefined;
  const validStatus = typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599;
  if (hasStatus && (!http || !validStatus)) return null;
  if (row.phase === "attempt") {
    if (
      row.channel === "unsupported" ||
      row.outcome !== "unknown" ||
      row.reason !== "pending" ||
      hasStatus ||
      row.duration_ms !== undefined
    )
      return null;
  } else if (row.phase === "result") {
    let valid = false;
    if (row.outcome === "not_attempted" && !hasStatus) {
      valid =
        ["invalid_configuration", "earlier_trigger_aborted"].includes(row.reason) ||
        (row.reason === "no_recipients" && row.channel === "email") ||
        (row.reason === "unsupported_channel" && row.channel === "unsupported");
    } else if (row.duration_ms !== undefined && row.channel !== "unsupported") {
      if (row.reason === "http_accepted")
        valid = http && row.outcome === "accepted" && validStatus && status >= 200 && status < 300;
      if (row.reason === "http_rejected")
        valid = http && row.outcome === "failed" && validStatus && (status < 200 || status >= 300);
      if (!hasStatus) {
        if (row.reason === "mail_accepted") valid = row.channel === "email" && row.outcome === "accepted";
        if (row.reason === "mail_rejected") valid = row.channel === "email" && row.outcome === "failed";
        if (row.reason === "partial_mail_acceptance") valid = row.channel === "email" && row.outcome === "unknown";
        if (["send_exception", "unclassified_result"].includes(row.reason)) valid = row.outcome === "unknown";
      }
    }
    if (!valid) return null;
  } else return null;

  return /** @type {import("../../src/lib/server/notification/notificationEvidence.js").NotificationEvidence & { timestamp: string }} */ (
    /** @type {unknown} */ (
      Object.fromEntries(FIELDS.filter((key) => row[key] !== undefined).map((key) => [key, row[key]]))
    )
  );
}
