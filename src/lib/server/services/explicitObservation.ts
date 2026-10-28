import GC from "../../global-constants.js";
import db from "../db/db.js";
import { CurrentStatusOf, HasMissedObservationRuns } from "./statusFreshness.js";
import { parseDbTimestamp } from "../tool.js";
import type { MonitoringData } from "../types/db.js";

/** Finite capability marker, exposed only through the existing authenticated monitor API. */
export const EXPLICIT_API_OBSERVATION_CONTRACT = "wolf-explicit-api-observation-v1";

type ObservationMonitor = {
  tag: string;
  monitor_type: string;
  type_data?: unknown;
  cron?: string | null;
  created_at?: string | Date;
};
const observationTypes: string[] = [GC.REALTIME, GC.ERROR, GC.TIMEOUT, GC.MAINTENANCE, GC.INCIDENT];
const overlayTypes: string[] = [GC.MAINTENANCE, GC.INCIDENT];
const knownStatuses: string[] = [GC.UP, GC.DOWN, GC.DEGRADED];

/** Both parsed runtime monitors and database/API records use this same opt-in. */
export function IsExplicitApiObservation(monitor: ObservationMonitor): boolean {
  let data = monitor.type_data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return false;
    }
  }
  return (
    monitor.monitor_type === "API" &&
    !!data &&
    typeof data === "object" &&
    (data as { observation_mode?: unknown }).observation_mode === "explicit"
  );
}

/** Interpret a current native observation without converting manual/default values into evidence. */
export function ObservationStatusOf(
  monitor: ObservationMonitor,
  latest: MonitoringData | null | undefined,
  nowTs: number,
): string {
  if (
    !latest ||
    !observationTypes.includes(latest.type ?? "") ||
    latest.type === GC.ERROR ||
    latest.type === GC.TIMEOUT
  )
    return GC.NO_DATA;
  const observed = overlayTypes.includes(latest.type ?? "") ? { ...latest, status: latest.raw_status } : latest;
  return CurrentStatusOf(monitor.cron, observed, nowTs);
}

async function HasActiveObservationMaintenance(monitor: ObservationMonitor, nowTs: number): Promise<boolean> {
  const maintenance = await db.getMaintenancesByMonitorTagRealtime(monitor.tag, nowTs);
  return maintenance.some(
    (row) =>
      row.monitor_impact === GC.MAINTENANCE &&
      row.end_date_time !== null &&
      Number.isFinite(row.end_date_time) &&
      row.start_date_time <= nowTs &&
      nowTs < row.end_date_time,
  );
}

/** Active events retain their presentation impact; ended overlays expose the underlying observation. */
export async function ReadObservationStatus(
  monitor: ObservationMonitor,
  latest: MonitoringData | null | undefined,
  nowTs: number,
): Promise<string> {
  if (!IsExplicitApiObservation(monitor)) return latest?.status || GC.NO_DATA;
  if (await HasActiveObservationMaintenance(monitor, nowTs)) return GC.MAINTENANCE;
  const incidents = await db.getIncidentsByMonitorTagRealtime(monitor.tag, nowTs);
  // Match the native execution overlay's impact selection, including manual maintenance incidents.
  let incidentImpact: string | undefined;
  for (const incident of incidents) {
    if (incident.monitor_impact === GC.MAINTENANCE || incident.monitor_impact === GC.DOWN)
      return incident.monitor_impact;
    if (incident.monitor_impact === GC.DEGRADED) incidentImpact = GC.DEGRADED;
  }
  if (incidentImpact) return incidentImpact;
  return ObservationStatusOf(monitor, latest, nowTs);
}

/** Unknown is an observation alert, separate from known response failures; planned downtime freezes it. */
export async function ReadObservationAlertState(
  monitor: ObservationMonitor,
  failureThreshold: number,
  successThreshold: number,
  nowTs: number,
): Promise<{ affected: boolean; recovered: boolean }> {
  const rows = await db.getObservationSamples(monitor.tag, nowTs, Math.max(failureThreshold, successThreshold));
  const latest = rows[0];
  // Application incidents affect presentation, never the independent observation clock or notices.
  if (await HasActiveObservationMaintenance(monitor, nowTs)) return { affected: false, recovered: false };
  const current = ObservationStatusOf(monitor, latest, nowTs);
  const observedStatus = (row: MonitoringData) =>
    overlayTypes.includes(row.type ?? "") ? row.raw_status : (row.raw_status ?? row.status);
  const unknown = rows.slice(0, failureThreshold);
  const known = rows.slice(0, successThreshold);
  let anchor = latest?.timestamp;
  if (anchor === undefined && monitor.created_at)
    anchor = Math.floor(parseDbTimestamp(monitor.created_at).getTime() / 1000);
  const missed = anchor !== undefined && HasMissedObservationRuns(monitor.cron, anchor, nowTs, failureThreshold);
  return {
    affected:
      current === GC.NO_DATA &&
      (missed || (unknown.length === failureThreshold && unknown.every((row) => observedStatus(row) === GC.NO_DATA))),
    // An observed HTTP failure restores observation, even when the app's own DOWN alert must stay active.
    recovered:
      current !== GC.NO_DATA &&
      known.length === successThreshold &&
      known.every(
        (row) =>
          (row.type === GC.REALTIME || overlayTypes.includes(row.type ?? "")) &&
          knownStatuses.includes(observedStatus(row) ?? ""),
      ),
  };
}
