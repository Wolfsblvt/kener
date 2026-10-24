import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GroupMonitor, GroupMonitorMember } from "../types/monitor";

const latest = new Map<string, { status: string; latency: number }>();

vi.mock("../cache/setGet.js", () => ({
  GetLastMonitoringValue: async (tag: string) => latest.get(tag) ?? null,
}));
vi.mock("../controllers/controller.js", () => ({
  GetLatestMonitoringData: async () => null,
}));

const { default: GroupCall } = await import("./groupCall");

function group(monitors: GroupMonitorMember[]): GroupMonitor {
  return {
    tag: "group",
    type_data: { monitors, executionDelay: 0, latencyCalculation: "AVG" },
  } as unknown as GroupMonitor;
}

async function statusOf(monitors: GroupMonitorMember[], states: Record<string, string>) {
  latest.clear();
  for (const [tag, status] of Object.entries(states)) latest.set(tag, { status, latency: 100 });
  return (await new GroupCall(group(monitors)).execute(1)).status;
}

const half = (tag: string, role?: "required" | "supporting"): GroupMonitorMember => ({ tag, weight: 0.5, ...(role ? { role } : {}) });

describe("GroupCall without roles keeps the weighted rollup", () => {
  beforeEach(() => latest.clear());

  it("reports DEGRADED when one of two members is down", async () => {
    expect(await statusOf([half("a"), half("b")], { a: "DOWN", b: "UP" })).toBe("DEGRADED");
  });

  it("treats maintenance as up", async () => {
    expect(await statusOf([half("a"), half("b")], { a: "MAINTENANCE", b: "MAINTENANCE" })).toBe("UP");
  });

  it("reports DOWN only when every member is down", async () => {
    expect(await statusOf([half("a"), half("b")], { a: "DOWN", b: "DOWN" })).toBe("DOWN");
  });
});

describe("GroupCall with roles", () => {
  const app = [half("live", "required"), half("ready", "required")];
  const lens = [half("page", "required"), half("analysis", "supporting")];

  it("reports DOWN when a required member is down and another is up", async () => {
    expect(await statusOf(app, { live: "UP", ready: "DOWN" })).toBe("DOWN");
  });

  it("only degrades for a supporting member that is down", async () => {
    expect(await statusOf(lens, { page: "UP", analysis: "DOWN" })).toBe("DEGRADED");
  });

  it("reports DOWN when the required page is down even though analysis is up", async () => {
    expect(await statusOf(lens, { page: "DOWN", analysis: "UP" })).toBe("DOWN");
  });

  it("reports MAINTENANCE when required members are in maintenance", async () => {
    expect(await statusOf(app, { live: "MAINTENANCE", ready: "MAINTENANCE" })).toBe("MAINTENANCE");
    expect(await statusOf(app, { live: "UP", ready: "MAINTENANCE" })).toBe("MAINTENANCE");
  });

  it("degrades when a required member is degraded", async () => {
    expect(await statusOf(app, { live: "UP", ready: "DEGRADED" })).toBe("DEGRADED");
  });

  it("reports DOWN when every supporting-only member is down", async () => {
    const product = [half("site", "supporting"), half("docs", "supporting")];
    expect(await statusOf(product, { site: "DOWN", docs: "DOWN" })).toBe("DOWN");
    expect(await statusOf(product, { site: "DOWN", docs: "UP" })).toBe("DEGRADED");
  });

  it("counts a member without a role as required once any role is set", async () => {
    expect(await statusOf([half("page"), half("analysis", "supporting")], { page: "DOWN", analysis: "UP" })).toBe("DOWN");
  });

  it("ignores members without data", async () => {
    expect(await statusOf(lens, { analysis: "UP" })).toBe("UP");
    expect(await statusOf(lens, {})).toBe("DOWN");
  });

  it("reports UP when everything is up", async () => {
    expect(await statusOf(app, { live: "UP", ready: "UP" })).toBe("UP");
  });
});
