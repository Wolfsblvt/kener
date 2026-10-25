import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";

// Wolfsblvt fork: the per-minute grid paints the dark status colours in dark mode, like the history calendar.
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

const { default: MinuteGrid } = await import("./MinuteGrid.harness.svelte");

const NOON_UTC = 1768478400; // 2026-01-15T12:00:00Z, the first minute of the 12:00-17:59 section
const minutes = (status: string) => Array.from({ length: 60 }, (_, i) => ({ timestamp: NOON_UTC + i * 60, status }));

// The first square sits under the 20px section label; sample its middle, scaled for the device pixel ratio.
async function renderFirstSquarePixel(status: string): Promise<() => string> {
  const screen = await render(MinuteGrid, { minutes: minutes(status), uptime: "100" });
  const canvas = screen.getByLabelText("Per-Minute Status").element() as HTMLCanvasElement;
  const dpr = window.devicePixelRatio || 1;
  return () => {
    const [r, g, b] = canvas.getContext("2d")!.getImageData(Math.floor(1.5 * dpr), Math.floor(21.5 * dpr), 1, 1).data;
    return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
  };
}

describe("MinuteGrid theme colours", () => {
  it("paints the dark UP colour in dark mode", async () => {
    theme.current = "dark";
    const pixel = await renderFirstSquarePixel("UP");
    await expect.poll(pixel).toBe("#3b9f70");
  });

  it("paints the dark DOWN colour in dark mode", async () => {
    theme.current = "dark";
    const pixel = await renderFirstSquarePixel("DOWN");
    await expect.poll(pixel).toBe("#e0504d");
  });

  it("paints the light UP colour in light mode", async () => {
    theme.current = "light";
    const pixel = await renderFirstSquarePixel("UP");
    await expect.poll(pixel).toBe("#00ff00");
  });
});
