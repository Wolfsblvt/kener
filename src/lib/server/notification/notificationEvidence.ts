import { appendFileSync, lstatSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export type SendOutcome = "accepted" | "failed" | "unknown" | "not_attempted";
export interface NotificationEvidence {
  attempt_id: string;
  alert_id: number;
  config_id: number;
  trigger_id: number;
  transition: "TRIGGERED" | "RESOLVED";
  transition_at: string;
  channel: "email" | "webhook" | "slack" | "discord" | "unsupported";
  phase: "attempt" | "result";
  outcome: SendOutcome;
  reason:
    | "pending"
    | "http_accepted"
    | "http_rejected"
    | "mail_accepted"
    | "mail_rejected"
    | "partial_mail_acceptance"
    | "unclassified_result"
    | "send_exception"
    | "invalid_configuration"
    | "no_recipients"
    | "unsupported_channel"
    | "earlier_trigger_aborted";
  http_status?: number;
  duration_ms?: number;
}

const RETENTION_DAYS = 90;
const DAILY_BYTES = 4 * 1024 * 1024;
const LOG_FILE = /^notification-\d{4}-\d{2}-\d{2}\.jsonl$/;

/** Append reduced operational evidence. Logging failure never changes notification policy. */
export function recordNotificationEvidence(record: NotificationEvidence): void {
  let failureReason = "storage_unavailable";
  try {
    const directory = process.env.KENER_NOTIFICATION_LOG_DIR || "./database/notification-outcomes";
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const dir = lstatSync(directory);
    if (!dir.isDirectory() || dir.isSymbolicLink() || (process.platform !== "win32" && (dir.mode & 0o077) !== 0)) {
      failureReason = "unsafe_permissions_or_path";
      throw new Error("unsafe_directory");
    }
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86400_000).toISOString().slice(0, 10);
    for (const file of readdirSync(directory)) {
      if (LOG_FILE.test(file) && file.slice(13, 23) < cutoff) unlinkSync(join(directory, file));
    }
    const path = join(directory, `notification-${day}.jsonl`);
    let size = 0;
    try {
      const file = lstatSync(path);
      if (!file.isFile() || file.isSymbolicLink() || (process.platform !== "win32" && (file.mode & 0o077) !== 0)) {
        failureReason = "unsafe_permissions_or_path";
        throw new Error("unsafe_file");
      }
      size = file.size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    // Explicit allowlist: never serialize a sender response, exception, template or trigger record.
    const line =
      JSON.stringify({
        event: "notification.send",
        timestamp: now.toISOString(),
        attempt_id: record.attempt_id,
        alert_id: record.alert_id,
        config_id: record.config_id,
        trigger_id: record.trigger_id,
        transition: record.transition,
        transition_at: record.transition_at,
        channel: record.channel,
        phase: record.phase,
        outcome: record.outcome,
        reason: record.reason,
        http_status: record.http_status,
        duration_ms: record.duration_ms,
      }) + "\n";
    if (size + Buffer.byteLength(line) > DAILY_BYTES) {
      failureReason = "daily_capacity";
      throw new Error("daily_capacity");
    }
    appendFileSync(path, line, { mode: 0o600 });
  } catch {
    // No raw filesystem errors: they can contain private paths. The retained read must treat absence as unknown.
    console.error(
      JSON.stringify({
        event: "notification.evidence_unavailable",
        timestamp: new Date().toISOString(),
        alert_id: record.alert_id,
        trigger_id: record.trigger_id,
        transition: record.transition,
        attempt_id: record.attempt_id,
        phase: record.phase,
        reason: failureReason,
      }),
    );
  }
}
