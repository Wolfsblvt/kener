import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseNotificationEvidence } from "./evidence-contract.mjs";

/**
 * Read retained native alert attempts. Missing evidence never proves a send was not attempted.
 * @param {string} directory
 * @param {number} alertId
 * @param {string} transition
 * @param {number} triggerId
 */
export function readNotificationEvidence(directory, alertId, transition, triggerId) {
  if (
    ![alertId, triggerId].every((id) => Number.isSafeInteger(id) && id > 0) ||
    !["TRIGGERED", "RESOLVED"].includes(transition)
  )
    throw new Error("Invalid evidence query");
  const attempts = new Map();
  const conflicts = new Set();
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
      const safe = parseNotificationEvidence(row);
      if (!safe) {
        incomplete = true;
        if (typeof row?.attempt_id === "string" && row.attempt_id.length === 36) conflicts.add(row.attempt_id);
        continue;
      }
      const previous = attempts.get(safe.attempt_id) || {};
      const samePhase = previous[safe.phase];
      if (samePhase && JSON.stringify(samePhase) !== JSON.stringify(safe)) conflicts.add(safe.attempt_id);
      previous[safe.phase] = safe;
      attempts.set(safe.attempt_id, previous);
    }
  }
  const selected = [];
  for (const [id, phases] of attempts) {
    const { attempt, result } = phases;
    const row = result || attempt;
    if (attempt && result) {
      const identity = ["alert_id", "config_id", "trigger_id", "transition", "transition_at", "channel"];
      if (identity.some((key) => attempt[key] !== result[key]) || result.timestamp < attempt.timestamp)
        conflicts.add(id);
    }
    // A transport result without its start can be genuine after a logging outage,
    // but cannot supply complete acknowledgement evidence on its own.
    if (result && result.outcome !== "not_attempted" && !attempt) conflicts.add(id);
    if (conflicts.has(id)) incomplete = true;
    if (row.alert_id !== alertId || row.transition !== transition || row.trigger_id !== triggerId) continue;
    if (!conflicts.has(id)) selected.push(row);
  }
  return {
    alert_id: alertId,
    transition,
    trigger_id: triggerId,
    read_incomplete: incomplete,
    outcome_if_absent: "unknown",
    attempts: selected,
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
      !Number.isSafeInteger(Number(alert)) ||
      transitionFlag !== "--transition" ||
      !["TRIGGERED", "RESOLVED"].includes(transition) ||
      triggerFlag !== "--trigger" ||
      !/^[1-9]\d*$/.test(trigger || "") ||
      !Number.isSafeInteger(Number(trigger)) ||
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
