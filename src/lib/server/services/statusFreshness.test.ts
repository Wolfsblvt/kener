import { describe, expect, it } from "vitest";
import { IsCurrentResult } from "./statusFreshness";

// 2027-01-15T08:00:00Z, a minute start that is also on the hour.
const NOW = Date.UTC(2027, 0, 15, 8, 0) / 1000;
const minutesAgo = (n: number) => NOW - n * 60;

describe("IsCurrentResult", () => {
  it("accepts this minute's or the previous minute's result for an every-minute schedule", () => {
    expect(IsCurrentResult("* * * * *", NOW, NOW)).toBe(true);
    expect(IsCurrentResult("* * * * *", minutesAgo(1), NOW)).toBe(true);
    expect(IsCurrentResult("* * * * *", minutesAgo(2), NOW)).toBe(false);
  });

  it("measures freshness by the monitor's own schedule", () => {
    expect(IsCurrentResult("*/5 * * * *", minutesAgo(5), NOW)).toBe(true);
    expect(IsCurrentResult("*/5 * * * *", minutesAgo(6), NOW)).toBe(false);
    expect(IsCurrentResult("0 * * * *", minutesAgo(60), NOW)).toBe(true);
    expect(IsCurrentResult("0 * * * *", minutesAgo(61), NOW)).toBe(false);
  });

  it("counts a schedule that fires several times a minute once per minute", () => {
    expect(IsCurrentResult("*/10 * * * * *", minutesAgo(1), NOW)).toBe(true);
    expect(IsCurrentResult("*/10 * * * * *", minutesAgo(2), NOW)).toBe(false);
  });

  it("does not vouch for a result without a readable schedule", () => {
    expect(IsCurrentResult(null, NOW, NOW)).toBe(false);
    expect(IsCurrentResult("", NOW, NOW)).toBe(false);
    expect(IsCurrentResult("not a schedule", NOW, NOW)).toBe(false);
  });
});
