import { GetMinuteStartNowTimestampUTC } from "../tool.js";
import GC from "../../global-constants.js";
import type { GroupMonitor, GroupMonitorMember, MonitoringResult } from "../types/monitor.js";
import { GetLastMonitoringValue } from "../cache/setGet.js";
import { GetLatestMonitoringData, GetMonitorsParsed } from "../controllers/controller.js";
import { IsCurrentResult } from "./statusFreshness.js";

/**
 * Numeric scores for each status (normalized 0–1).
 * UP = 1, DEGRADED = 0.5, DOWN = 0
 * MAINTENANCE members are treated as UP (score 1).
 *
 * Weighted sum = Σ(weight × score), weights should sum to 1.
 * Result: 1 → UP, (0, 1) → DEGRADED, 0 → DOWN
 */
const STATUS_SCORE: Record<string, number> = {
  [GC.UP]: 1,
  [GC.DEGRADED]: 0.5,
  [GC.DOWN]: 0,
};

/** Map a weighted score back to a status string. */
function scoreToStatus(score: number): string {
  if (score >= 1) return GC.UP;
  if (score > 0) return GC.DEGRADED;
  return GC.DOWN;
}

/**
 * Derive a group's status from its members' latest statuses.
 *
 * Without roles this is the weighted score above, unchanged: members without data are left out.
 *
 * With roles, the group answers "can people use this?" and every configured member counts. A member is unknown when
 * it has no current result or its result is NO_DATA. In order: a group whose members are all unknown is NO_DATA;
 * a group whose members are all down is DOWN; a required member that is down makes the group DOWN; a required member
 * that is unknown makes it NO_DATA, never UP and never an invented outage; all members in maintenance, or a required
 * member in maintenance, make it MAINTENANCE; anything else that is not up, including an unknown supporting member,
 * makes it DEGRADED. A member without a role counts as required.
 */
export function RollupGroupStatus(members: GroupMonitorMember[], statusByTag: Map<string, string>): string {
  if (!members.some((m) => m.role)) {
    let weightedScore = 0;
    let totalWeight = 0;
    for (const member of members) {
      const status = statusByTag.get(member.tag);
      if (status === undefined) continue;
      weightedScore += member.weight * (STATUS_SCORE[status] ?? 1);
      totalWeight += member.weight;
    }
    // Normalize if weights don't sum to 1 (safety net)
    if (totalWeight > 0 && totalWeight !== 1) {
      weightedScore = weightedScore / totalWeight;
    }
    return scoreToStatus(weightedScore);
  }

  const statusOf = (m: GroupMonitorMember) => statusByTag.get(m.tag) ?? GC.NO_DATA;
  const required = members.filter((m) => (m.role ?? "required") === "required");

  if (members.every((m) => statusOf(m) === GC.NO_DATA)) return GC.NO_DATA;
  if (members.every((m) => statusOf(m) === GC.DOWN)) return GC.DOWN;
  if (required.some((m) => statusOf(m) === GC.DOWN)) return GC.DOWN;
  if (required.some((m) => statusOf(m) === GC.NO_DATA)) return GC.NO_DATA;
  if (members.every((m) => statusOf(m) === GC.MAINTENANCE)) return GC.MAINTENANCE;
  if (required.some((m) => statusOf(m) === GC.MAINTENANCE)) return GC.MAINTENANCE;
  if (members.some((m) => statusOf(m) !== GC.UP)) return GC.DEGRADED;
  return GC.UP;
}

/**
 * Whether this monitor is a role-aware group. Its NO_DATA is a finding (a required member cannot be seen), not a
 * missing check result, so a configured default status must not replace it.
 */
export function IsRoleAwareGroup(monitor: { monitor_type?: string | null; type_data?: unknown }): boolean {
  const members = (monitor.type_data as { monitors?: unknown } | null | undefined)?.monitors;
  return (
    monitor.monitor_type === "GROUP" &&
    Array.isArray(members) &&
    members.some((m: GroupMonitorMember | null) => !!m?.role)
  );
}

class GroupCall {
  monitor: GroupMonitor;

  constructor(monitor: GroupMonitor, _timestamp?: number) {
    this.monitor = monitor;
  }

  async execute(startOfMinute?: number): Promise<MonitoringResult> {
    if (!startOfMinute) {
      startOfMinute = GetMinuteStartNowTimestampUTC();
    }
    const members = this.monitor.type_data.monitors;

    // Collect each member's latest status + latency
    const statusMap = new Map<string, { status: string; latency: number; timestamp: number }>();

    for (const member of members) {
      const lastObj = (await GetLastMonitoringValue(member.tag, () => GetLatestMonitoringData(member.tag))) as {
        status: string;
        latency: number;
        timestamp: number;
      } | null;
      if (lastObj) {
        statusMap.set(member.tag, lastObj);
      }
    }

    // --- Latency calculation ---
    const latencyValues = [...statusMap.values()].map((v) => v.latency);
    const latencyCalculationType = this.monitor.type_data.latencyCalculation || "AVG";
    let latency = 0;
    if (latencyValues.length > 0) {
      if (latencyCalculationType === "AVG") {
        latency = latencyValues.reduce((a, b) => a + b, 0) / latencyValues.length;
      } else if (latencyCalculationType === "MAX") {
        latency = Math.max(...latencyValues);
      } else if (latencyCalculationType === "MIN") {
        latency = Math.min(...latencyValues);
      }
    }

    const statusByTag = new Map([...statusMap].map(([tag, value]) => [tag, value.status]));
    if (members.some((m) => m.role)) {
      // A role-aware group must not report last-known results as current. Keep only results from each member's
      // latest scheduled runs; an inactive or deleted member has no schedule and so no current result.
      const cronByTag = new Map(
        (await GetMonitorsParsed({ tags: members.map((m) => m.tag), status: "ACTIVE" })).map((m) => [m.tag, m.cron]),
      );
      for (const [tag, value] of statusMap) {
        if (!IsCurrentResult(cronByTag.get(tag), value.timestamp, startOfMinute)) statusByTag.delete(tag);
      }
    }
    const status = RollupGroupStatus(members, statusByTag);

    return { status, latency, type: GC.REALTIME };
  }
}

export default GroupCall;
