import { describe, expect, it } from "vitest";
import {
  activeDayStreak,
  allTimeTotal,
  buildDailySeries,
  buildMonthlySeries,
  modelSplit,
  splitPercent,
  summarizeSeries,
} from "../shared/usageChart";
import type { DailyModelUsage } from "../shared/types";

const day = (date: string, opus = 0, sonnet = 0, haiku = 0, unknown = 0): DailyModelUsage => ({
  date,
  opus,
  sonnet,
  haiku,
  unknown,
});

const now = new Date("2026-06-18T12:00:00");

describe("buildDailySeries", () => {
  const history = [day("2026-06-18", 4, 2, 0), day("2026-06-16", 1, 0, 1)];

  it("returns one bar per day, oldest first, ending today", () => {
    const bars = buildDailySeries(history, 14, now);
    expect(bars).toHaveLength(14);
    expect(bars[0].key).toBe("2026-06-05");
    expect(bars[13].key).toBe("2026-06-18");
    expect(bars[13].label).toBe("6/18");
  });

  it("fills missing days with zero bars and totals present days", () => {
    const bars = buildDailySeries(history, 14, now);
    const today = bars[13];
    const gap = bars[12]; // 2026-06-17 — no entry
    const earlier = bars[11]; // 2026-06-16
    expect(today.total).toBe(6);
    expect(gap.total).toBe(0);
    expect(earlier).toMatchObject({ opus: 1, haiku: 1, total: 2 });
  });
});

describe("buildMonthlySeries", () => {
  const history = [
    day("2026-05-02", 10, 0, 0),
    day("2026-05-20", 5, 5, 0),
    day("2026-06-01", 3, 0, 0),
  ];

  it("aggregates per calendar month, oldest first, ending this month", () => {
    const bars = buildMonthlySeries(history, 6, now);
    expect(bars).toHaveLength(6);
    expect(bars[5].label).toBe("Jun");
    expect(bars[5].total).toBe(3);
    expect(bars[4].label).toBe("May");
    expect(bars[4]).toMatchObject({ opus: 15, sonnet: 5, total: 20 });
  });
});

describe("summarizeSeries", () => {
  it("computes total, per-bar average, and the busiest bar", () => {
    const bars = buildDailySeries([day("2026-06-18", 4, 2, 0), day("2026-06-17", 1, 0, 0)], 14, now);
    const summary = summarizeSeries(bars);
    expect(summary.total).toBe(7);
    expect(summary.perDayAverage).toBe(1); // 7 / 14 = 0.5, rounds to 1
    expect(summary.busiest?.key).toBe("2026-06-18");
    expect(summary.busiest?.total).toBe(6);
  });

  it("returns no busiest bar when there is no usage", () => {
    const summary = summarizeSeries(buildDailySeries([], 14, now));
    expect(summary.total).toBe(0);
    expect(summary.busiest).toBeNull();
  });
});

describe("modelSplit + splitPercent", () => {
  it("sums per model and computes rounded percentages", () => {
    const bars = buildDailySeries([day("2026-06-18", 6, 3, 1)], 14, now);
    const split = modelSplit(bars);
    expect(split).toMatchObject({ opus: 6, sonnet: 3, haiku: 1, total: 10 });
    expect(splitPercent(split, "opus")).toBe(60);
    expect(splitPercent(split, "sonnet")).toBe(30);
    expect(splitPercent(split, "haiku")).toBe(10);
  });

  it("returns zero percent without usage", () => {
    expect(splitPercent({ opus: 0, sonnet: 0, haiku: 0, unknown: 0, total: 0 }, "opus")).toBe(0);
  });
});

describe("allTimeTotal", () => {
  it("sums every recorded message across all days", () => {
    expect(allTimeTotal([day("2026-06-18", 4, 2, 0, 1), day("2026-01-02", 3)])).toBe(10);
  });
});

describe("activeDayStreak", () => {
  it("counts consecutive active days ending today", () => {
    const history = [day("2026-06-16", 1), day("2026-06-17", 2), day("2026-06-18", 3)];
    expect(activeDayStreak(history, now)).toBe(3);
  });

  it("breaks the streak on an inactive gap", () => {
    const history = [day("2026-06-15", 1), day("2026-06-18", 3)];
    expect(activeDayStreak(history, now)).toBe(1);
  });

  it("is zero when today has no messages yet", () => {
    expect(activeDayStreak([day("2026-06-17", 5)], now)).toBe(0);
  });
});
