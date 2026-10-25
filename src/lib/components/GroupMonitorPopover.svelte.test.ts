// Wolfsblvt fork: the inline group disclosure and its keyboard contract. Adapted from the disclosure test of the
// interrupted candidate commit c46ed989 to the replayed component.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { userEvent } from "vitest/browser";
import { createRawSnippet } from "svelte";
import GroupMonitorPopover from "./GroupMonitorPopover.svelte";
import type { MonitorBarResponse } from "$lib/server/api-server/monitor-bar/get";

vi.mock("$app/environment", () => ({ browser: true, dev: true, building: false, version: "test" }));
vi.mock("$app/state", () => ({
  page: {
    data: {
      monitorGroupMembersByTag: {},
      siteStatusColors: { UP: "#00ff00", DOWN: "#ff0000", DEGRADED: "#ffff00", MAINTENANCE: "#0000ff" },
      siteStatusColorsDark: { UP: "#3b9f70", DOWN: "#e0504d", DEGRADED: "#c9971b", MAINTENANCE: "#6f7fe8" },
      dateAndTimeFormat: { datePlusTime: "PPp", dateOnly: "yyyy-MM-dd", timeOnly: "HH:mm" },
      nowAtTz: 1768478400,
    },
    url: new URL("http://localhost/"),
    params: {},
    route: { id: null },
    status: 200,
    error: null,
    form: null,
    state: {},
  },
}));

const NOON_UTC = 1768478400;

const bar = (name: string): MonitorBarResponse => ({
  name,
  description: "",
  image: null,
  currentStatus: "UP",
  uptime: "100",
  avgLatency: "120ms",
  uptimeData: [
    {
      ts: NOON_UTC,
      countOfUp: 10,
      countOfDown: 0,
      countOfDegraded: 0,
      countOfMaintenance: 0,
      avgLatency: 120,
      maxLatency: 120,
      minLatency: 120,
    },
  ],
  fromTimeStamp: NOON_UTC,
  toTimeStamp: NOON_UTC,
  maxLatency: "120ms",
  minLatency: "120ms",
});

const requestMonitorBar = vi.hoisted(() => vi.fn());
vi.mock("$lib/client/monitor-bar-client", () => ({ requestMonitorBar }));

const label = createRawSnippet(() => ({ render: () => "<span>Included Monitors (2)</span>" }));

const renderGroup = (tags = ["website", "manual"]) =>
  render(GroupMonitorPopover, { tags, days: 90, endOfDayTodayAtTz: NOON_UTC, children: label });

describe("GroupMonitorPopover inline disclosure", () => {
  beforeEach(() => {
    requestMonitorBar.mockReset();
    requestMonitorBar.mockImplementation(async (tag: string) => bar(tag === "website" ? "Website" : "Manual & FAQ"));
  });

  it("starts collapsed, controls a hidden panel and loads nothing", async () => {
    const screen = await renderGroup();
    const toggle = screen.getByRole("button", { name: "Included Monitors (2)" });

    await expect.element(toggle).toHaveAttribute("aria-expanded", "false");
    const panel = document.getElementById(toggle.element().getAttribute("aria-controls") as string);
    expect(panel).not.toBeNull();
    expect(panel!.hidden).toBe(true);
    expect(requestMonitorBar).not.toHaveBeenCalled();
  });

  it("expands the members in place, below the toggle, without a modal", async () => {
    const screen = await renderGroup();
    const toggle = screen.getByRole("button", { name: "Included Monitors (2)" });

    await toggle.click();

    await expect.element(toggle).toHaveAttribute("aria-expanded", "true");
    await expect.element(screen.getByText("Website")).toBeVisible();
    await expect.element(screen.getByText("Manual & FAQ")).toBeVisible();
    expect(requestMonitorBar).toHaveBeenCalledTimes(2);
    expect(requestMonitorBar).toHaveBeenCalledWith("website", 90, NOON_UTC);
    const panel = document.getElementById(toggle.element().getAttribute("aria-controls") as string)!;
    expect(screen.container.contains(panel)).toBe(true);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(screen.container.querySelector(".kener-group")?.getAttribute("data-state")).toBe("open");
  });

  it("toggles from the keyboard and keeps focus on the toggle", async () => {
    const screen = await renderGroup();
    const toggle = screen.getByRole("button", { name: "Included Monitors (2)" });

    await userEvent.tab();
    expect(document.activeElement).toBe(toggle.element());

    await userEvent.keyboard("{Enter}");
    await expect.element(toggle).toHaveAttribute("aria-expanded", "true");
    await expect.element(screen.getByText("Website")).toBeVisible();

    await userEvent.keyboard(" ");
    await expect.element(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(toggle.element());
  });

  it("collapses and reopens without fetching the members again", async () => {
    const screen = await renderGroup();
    const toggle = screen.getByRole("button", { name: "Included Monitors (2)" });

    await toggle.click();
    await expect.element(screen.getByText("Website")).toBeVisible();
    await toggle.click();
    await expect.element(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect.element(screen.getByText("Website")).toBeVisible();

    expect(requestMonitorBar).toHaveBeenCalledTimes(2);
  });

  it("puts the group name in the toggle's accessible name without replacing the disclosure", async () => {
    const screen = await render(GroupMonitorPopover, {
      tags: ["website", "manual"],
      days: 90,
      endOfDayTodayAtTz: NOON_UTC,
      groupName: "diffdevil",
      children: label,
    });
    const toggle = screen.getByRole("button", { name: "diffdevil: Included Monitors (2)" });

    await expect.element(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect.element(toggle).toHaveAttribute("aria-expanded", "true");
    await expect.element(screen.getByText("Website")).toBeVisible();
  });

  it("shows a member that fails to load as an error, not as a missing row", async () => {
    requestMonitorBar.mockImplementation(async (tag: string) => {
      if (tag === "manual") throw new Error("Monitor not found");
      return bar("Website");
    });
    const screen = await renderGroup();

    await screen.getByRole("button", { name: "Included Monitors (2)" }).click();

    await expect.element(screen.getByText("Website")).toBeVisible();
    await expect.element(screen.getByText(/Monitor not found/)).toBeVisible();
  });
});
