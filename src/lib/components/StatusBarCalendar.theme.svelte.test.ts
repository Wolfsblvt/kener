import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import type { TimestampStatusCount } from "$lib/server/types/db";

// Wolfsblvt fork: the calendar paints the dark status colours in dark mode.
const theme = vi.hoisted(() => ({ current: "dark" as "dark" | "light" }));

vi.mock("mode-watcher", () => ({ mode: theme }));
vi.mock("$app/state", () => ({
  page: {
    data: {
      siteStatusColors: { UP: "#00ff00", DOWN: "#ff0000", DEGRADED: "#ffff00", MAINTENANCE: "#0000ff" },
      siteStatusColorsDark: { UP: "#3b9f70", DOWN: "#e0504d", DEGRADED: "#c9971b", MAINTENANCE: "#6f7fe8" },
      dateAndTimeFormat: { dateOnly: "yyyy-MM-dd", timeOnly: "HH:mm" },
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

const { default: StatusBarCalendar } = await import("./StatusBarCalendar.svelte");

const upDay: TimestampStatusCount = {
  ts: 1768478400,
  countOfUp: 10,
  countOfDown: 0,
  countOfDegraded: 0,
  countOfMaintenance: 0,
  avgLatency: 0,
  maxLatency: 0,
  minLatency: 0,
};

async function centerPixel(): Promise<string> {
  const screen = await render(StatusBarCalendar, { data: [upDay, upDay, upDay], monitorTag: "t", disableClick: true });
  const canvas = screen.getByLabelText("Status calendar showing 3-day uptime data").element() as HTMLCanvasElement;
  await expect.poll(() => canvas.width).toBeGreaterThan(0);
  const [r, g, b] = canvas.getContext("2d")!.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

describe("StatusBarCalendar theme colours", () => {
  it("paints the dark UP colour in dark mode", async () => {
    theme.current = "dark";
    await expect.poll(centerPixel).toBe("#3b9f70");
  });

  it("paints the light UP colour in light mode", async () => {
    theme.current = "light";
    await expect.poll(centerPixel).toBe("#00ff00");
  });
});
