import { Cron } from "croner";
import GC from "../../global-constants.js";

const MINUTE_MS = 60_000;
const LONGEST_LOOKBACK_MS = 400 * 24 * 60 * MINUTE_MS;

/**
 * The minute (UTC seconds) of the second most recent minute in which `cron` was due at or before `atMs`, or null when
 * the pattern cannot be read or was not due in two minutes within the lookback. Results are stamped per minute, so a
 * schedule that fires several times a minute counts once. Croner only walks forward, so this widens the lookback
 * until it holds two run minutes.
 */
function PreviousScheduledMinute(cron: string, atMs: number, missedRuns = 1): number | null {
  let schedule: Cron;
  try {
    schedule = new Cron(cron, { paused: true });
  } catch {
    return null;
  }
  for (let lookback = 5 * MINUTE_MS; lookback <= LONGEST_LOOKBACK_MS; lookback *= 2) {
    const runMinutes = new Set<number>();
    let next = schedule.nextRun(new Date(atMs - lookback));
    while (next && next.getTime() <= atMs) {
      runMinutes.add(Math.floor(next.getTime() / MINUTE_MS) * 60);
      next = schedule.nextRun(next);
    }
    if (runMinutes.size > missedRuns) return [...runMinutes][runMinutes.size - missedRuns - 1];
  }
  return null;
}

/**
 * Whether a monitor's latest result still describes the minute `nowTs` (UTC seconds, minute start).
 *
 * A monitor writes one result per scheduled run, stamped with that run's minute. Its latest result is current when it
 * comes from its previous scheduled run or later: the run due in this minute may still be in flight. A monitor that
 * missed a whole run (stopped, deactivated, or failing before it records anything) has only last-known evidence, and
 * last-known is not current. A schedule that cannot be read cannot vouch for freshness either.
 */
export function IsCurrentResult(cron: string | null | undefined, resultTs: number, nowTs: number): boolean {
  if (!cron || !Number.isFinite(resultTs) || resultTs > nowTs) return false;
  const previousRunMinute = PreviousScheduledMinute(cron, nowTs * 1000 + MINUTE_MS - 1);
  return previousRunMinute !== null && resultTs >= previousRunMinute;
}

/** True only after the selected number of fully missed scheduled run minutes, allowing the current run in flight. */
export function HasMissedObservationRuns(
  cron: string | null | undefined,
  anchorTs: number,
  nowTs: number,
  runs: number,
): boolean {
  if (!cron || !Number.isFinite(anchorTs) || anchorTs > nowTs || !Number.isInteger(runs) || runs < 1) return false;
  const previous = PreviousScheduledMinute(cron, nowTs * 1000 + MINUTE_MS - 1, runs);
  return previous !== null && anchorTs < previous;
}

/**
 * The status a monitor's latest result supports right now: that result's own status when it is current, otherwise
 * NO_DATA. Badges and other current-status readers use this so a missing, NO_DATA or last-known result is shown as
 * unknown rather than as whatever the monitor last reported.
 */
export function CurrentStatusOf(
  cron: string | null | undefined,
  latest: { status?: string | null; timestamp: number } | null | undefined,
  nowTs: number,
): string {
  if (!latest?.status || !IsCurrentResult(cron, latest.timestamp, nowTs)) return GC.NO_DATA;
  return latest.status;
}
