import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Read retained native alert attempts. Missing evidence never proves a send was not attempted.
 * @param {string} directory
 * @param {number} alertId
 * @param {string} transition
 * @param {number} triggerId
 */
export function readNotificationEvidence(directory, alertId, transition, triggerId) {
  const attempts = new Map();
  let incomplete = false;
  const files = readdirSync(directory)
    .filter((file) => /^notification-\d{4}-\d{2}-\d{2}\.jsonl$/.test(file))
    .sort();
  for (const file of files) {
    const path = join(directory, file);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) {
      incomplete = true;
      continue;
    }
    for (const line of readFileSync(path, "utf8").split("\n").filter(Boolean)) {
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        incomplete = true;
        continue;
      }
      if (row.alert_id !== alertId || row.transition !== transition || row.trigger_id !== triggerId) continue;
      if (row.event !== "notification.send" || typeof row.attempt_id !== "string") {
        incomplete = true;
        continue;
      }
      // Closed fields only; never echo arbitrary JSON or a raw parse exception.
      const safe = Object.fromEntries(
        [
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
        ].map((key) => [key, row[key]]),
      );
      if (safe.phase === "attempt") safe.outcome = "unknown";
      const previous = attempts.get(row.attempt_id);
      if (!previous || safe.phase === "result") attempts.set(row.attempt_id, safe);
    }
  }
  return {
    alert_id: alertId,
    transition,
    trigger_id: triggerId,
    read_incomplete: incomplete,
    outcome_if_absent: "unknown",
    attempts: [...attempts.values()],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [directoryFlag, directory, alertFlag, alert, transitionFlag, transition, triggerFlag, trigger, ...extra] =
      process.argv.slice(2);
    if (
      directoryFlag !== "--directory" ||
      !directory ||
      alertFlag !== "--alert" ||
      !/^[1-9]\d*$/.test(alert || "") ||
      transitionFlag !== "--transition" ||
      !["TRIGGERED", "RESOLVED"].includes(transition) ||
      triggerFlag !== "--trigger" ||
      !/^[1-9]\d*$/.test(trigger || "") ||
      extra.length
    ) {
      throw new Error("usage");
    }
    const result = readNotificationEvidence(directory, Number(alert), transition, Number(trigger));
    console.log(JSON.stringify(result, null, 2));
    if (result.read_incomplete) process.exitCode = 2;
  } catch {
    console.error(
      "Notification evidence read unavailable. Usage: node wolf/notification/read.mjs --directory <retained-log-directory> --alert <id> --transition TRIGGERED|RESOLVED --trigger <id>. Absence/unreadable evidence means unknown.",
    );
    process.exitCode = 2;
  }
}
