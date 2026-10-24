import { GetMinuteStartNowTimestampUTC } from "../tool.js";
import GC from "../../global-constants.js";
import type { GroupMonitor, GroupMonitorMember, MonitoringResult } from "../types/monitor.js";
import { GetLastMonitoringValue } from "../cache/setGet.js";
import { GetLatestMonitoringData } from "../controllers/controller.js";

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
 * Without roles this is the weighted score above, unchanged. With roles, the group answers "can people use this?":
 * a required member that is down makes the group down, required maintenance makes it maintenance, and anything
 * else that is not up makes it degraded. A supporting member can only degrade the group, unless every member is
 * down or in maintenance. Members without data are left out, as in the weighted path.
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

  const observed = members.filter((m) => statusByTag.has(m.tag));
  if (observed.length === 0) return GC.DOWN;
  const statusOf = (m: GroupMonitorMember) => statusByTag.get(m.tag) as string;
  const required = observed.filter((m) => (m.role ?? "required") === "required");

  if (observed.every((m) => statusOf(m) === GC.DOWN)) return GC.DOWN;
  if (required.some((m) => statusOf(m) === GC.DOWN)) return GC.DOWN;
  if (observed.every((m) => statusOf(m) === GC.MAINTENANCE)) return GC.MAINTENANCE;
  if (required.some((m) => statusOf(m) === GC.MAINTENANCE)) return GC.MAINTENANCE;
  if (observed.some((m) => statusOf(m) !== GC.UP)) return GC.DEGRADED;
  return GC.UP;
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
    const statusMap = new Map<string, { status: string; latency: number }>();

    for (const member of members) {
      const lastObj = (await GetLastMonitoringValue(member.tag, () => GetLatestMonitoringData(member.tag))) as {
        status: string;
        latency: number;
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
    const status = RollupGroupStatus(members, statusByTag);

    return { status, latency, type: GC.REALTIME };
  }
}

export default GroupCall;
