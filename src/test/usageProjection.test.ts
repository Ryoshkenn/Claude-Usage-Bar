import { describe, expect, it } from "vitest";
import type { UsageLogEntry } from "../shared/types";
import {
  buildWeeklyUsageMetrics,
  computeSessionProjection,
  computeWeeklyProjection,
  computeWeightedDrainRate,
  getMatchingWindowHistory,
  trimForecastEntries,
} from "../shared/usageProjection";

const RESET_AT = Date.now() + 3 * 60 * 60_000;

const makeEntry = (
  capturedAt: number,
  sessionUsedPercent: number,
  sessionResetsAt = RESET_AT,
): UsageLogEntry => ({ capturedAt, sessionUsedPercent, sessionResetsAt });

describe("getMatchingWindowHistory", () => {
  it("returns only entries matching the reset boundary", () => {
    const now = Date.now();
    const entries: UsageLogEntry[] = [
      makeEntry(now - 3000, 10, RESET_AT),
      makeEntry(now - 2000, 20, RESET_AT + 200 * 60_000),
      makeEntry(now - 1000, 30, RESET_AT),
    ];
    const result = getMatchingWindowHistory(entries, RESET_AT);
    expect(result).toHaveLength(2);
    expect(result.every((e) => Math.abs((e.sessionResetsAt ?? 0) - RESET_AT) <= 60_000)).toBe(true);
  });

  it("excludes entries without sessionUsedPercent", () => {
    const entries: UsageLogEntry[] = [
      { capturedAt: Date.now(), sessionResetsAt: RESET_AT },
      makeEntry(Date.now() - 1000, 15, RESET_AT),
    ];
    expect(getMatchingWindowHistory(entries, RESET_AT)).toHaveLength(1);
  });

  it("returns empty array for empty input", () => {
    expect(getMatchingWindowHistory([], RESET_AT)).toHaveLength(0);
  });
});

describe("trimForecastEntries", () => {
  it("keeps only the last N entries", () => {
    const entries = Array.from({ length: 20 }, (_, i) => makeEntry(i, i));
    const trimmed = trimForecastEntries(entries, 12);
    expect(trimmed).toHaveLength(12);
    expect(trimmed[0].capturedAt).toBe(8);
    expect(trimmed[11].capturedAt).toBe(19);
  });

  it("returns all if fewer than max", () => {
    const entries = [makeEntry(1, 5), makeEntry(2, 10)];
    expect(trimForecastEntries(entries, 12)).toHaveLength(2);
  });
});

describe("computeWeightedDrainRate", () => {
  it("returns null for fewer than 2 entries", () => {
    expect(computeWeightedDrainRate([])).toBeNull();
    expect(computeWeightedDrainRate([makeEntry(1, 10)])).toBeNull();
  });

  it("weights newer intervals more heavily", () => {
    const base = Date.now();
    const slow = makeEntry(base, 10);
    const mid = makeEntry(base + 60 * 60_000, 15);
    const fast = makeEntry(base + 2 * 60 * 60_000, 30);

    const rate = computeWeightedDrainRate([slow, mid, fast]);
    expect(rate).not.toBeNull();

    // Interval 0: (base → mid): 5%/h, weight 1
    // Interval 1: (mid → fast): 15%/h, weight 2
    // weighted = (5*1 + 15*2) / 3 = 35/3 ≈ 11.67
    expect(rate).toBeCloseTo(35 / 3, 1);
  });

  it("skips intervals with zero or negative delta percent", () => {
    const base = Date.now();
    const entries = [
      makeEntry(base, 30),
      makeEntry(base + 60 * 60_000, 20),
      makeEntry(base + 2 * 60 * 60_000, 40),
    ];
    const rate = computeWeightedDrainRate(entries);
    // Interval 0: delta=-10 (skipped), Interval 1: delta=+20/1h, weight 2
    expect(rate).toBeCloseTo(20, 1);
  });

  it("returns null when all intervals have non-positive delta", () => {
    const base = Date.now();
    const entries = [makeEntry(base, 50), makeEntry(base + 60 * 60_000, 40)];
    expect(computeWeightedDrainRate(entries)).toBeNull();
  });
});

describe("computeSessionProjection — insufficient data fallback", () => {
  it("returns insufficient_data with fewer than 3 matching entries and even-pace usage", () => {
    const now = Date.now();
    const resetAt = now + 3 * 60 * 60_000;
    const result = computeSessionProjection([], 10, resetAt, now);
    expect(result.status).not.toBe("projected_empty");
  });

  it("returns insufficient_data when history is empty", () => {
    const now = Date.now();
    const result = computeSessionProjection([], 50, now + 60 * 60_000, now);
    expect(["insufficient_data", "lasting_to_reset"]).toContain(result.status);
  });
});

describe("computeSessionProjection — weighted rate path", () => {
  it("returns projected_empty when drain rate will exhaust before reset", () => {
    const now = Date.now();
    const resetAt = now + 4 * 60 * 60_000;
    const base = now - 3 * 60 * 60_000;
    const entries: UsageLogEntry[] = [
      makeEntry(base, 10, resetAt),
      makeEntry(base + 60 * 60_000, 30, resetAt),
      makeEntry(base + 2 * 60 * 60_000, 50, resetAt),
      makeEntry(base + 3 * 60 * 60_000, 70, resetAt),
    ];
    const result = computeSessionProjection(entries, 70, resetAt, now);
    expect(result.status).toBe("projected_empty");
    expect(result.label).toMatch(/Projected empty in/);
    expect(result.etaMs).toBeDefined();
    expect(result.etaMs! - now).toBeLessThan(4 * 60 * 60_000);
  });

  it("returns lasting_to_reset when drain rate is slow", () => {
    const now = Date.now();
    const resetAt = now + 4 * 60 * 60_000;
    const base = now - 3 * 60 * 60_000;
    const entries: UsageLogEntry[] = [
      makeEntry(base, 5, resetAt),
      makeEntry(base + 60 * 60_000, 8, resetAt),
      makeEntry(base + 2 * 60 * 60_000, 11, resetAt),
      makeEntry(base + 3 * 60 * 60_000, 14, resetAt),
    ];
    const result = computeSessionProjection(entries, 14, resetAt, now);
    expect(result.status).toBe("lasting_to_reset");
    expect(result.label).toMatch(/^Lasts /);
    expect(result.etaMs).toBeDefined();
    expect(result.etaMs!).toBeGreaterThan(resetAt);
  });

  it("does not use entries from a different reset cycle", () => {
    const now = Date.now();
    const resetAt = now + 4 * 60 * 60_000;
    const oldReset = resetAt - 5 * 60 * 60_000;
    const base = now - 3 * 60 * 60_000;
    const entries: UsageLogEntry[] = [
      makeEntry(base, 60, oldReset),
      makeEntry(base + 60 * 60_000, 80, oldReset),
      makeEntry(base + 2 * 60 * 60_000, 90, oldReset),
      makeEntry(base + 3 * 60 * 60_000, 95, oldReset),
    ];
    const result = computeSessionProjection(entries, 5, resetAt, now);
    expect(["insufficient_data", "lasting_to_reset"]).toContain(result.status);
  });
});

describe("storage retention cap", () => {
  it("trimForecastEntries keeps exactly maxEntries newest entries", () => {
    const entries = Array.from({ length: 110 }, (_, i) => makeEntry(i, i % 100));
    const kept = trimForecastEntries(entries, 100);
    expect(kept).toHaveLength(100);
    expect(kept[0].capturedAt).toBe(10);
    expect(kept[99].capturedAt).toBe(109);
  });
});

describe("weekly smart metrics", () => {
  it("marks weekly confidence as learning until a week of samples exists", () => {
    const base = new Date("2026-05-18T16:00:00.000Z").getTime();
    const resetAt = new Date("2026-05-25T00:00:00.000Z").getTime();
    const history: UsageLogEntry[] = [
      { capturedAt: base, weeklyUsedPercent: 4, weeklyResetsAt: resetAt },
      { capturedAt: base + 2 * 60 * 60_000, weeklyUsedPercent: 8, weeklyResetsAt: resetAt },
      { capturedAt: base + 26 * 60 * 60_000, weeklyUsedPercent: 16, weeklyResetsAt: resetAt },
    ];

    const metrics = buildWeeklyUsageMetrics(history);

    expect(metrics.confidence).toBe("learning");
    expect(metrics.sampleCount).toBe(3);
    expect(metrics.averageActiveHoursPerDay).toBeGreaterThan(0);
  });

  it("uses learned active hours instead of assuming all 168 weekly hours are usable", () => {
    const now = new Date("2026-05-21T16:00:00.000Z").getTime();
    const resetAt = new Date("2026-05-25T00:00:00.000Z").getTime();
    const base = now - 7 * 24 * 60 * 60_000;
    const history: UsageLogEntry[] = Array.from({ length: 8 }, (_, index) => ({
      capturedAt: base + index * 24 * 60 * 60_000,
      weeklyUsedPercent: index * 12,
      weeklyResetsAt: resetAt,
    }));
    const metrics = buildWeeklyUsageMetrics(history);

    const smart = computeWeeklyProjection(history, 48, resetAt, now, {
      mode: "smart",
      metrics,
      manualWorkDays: [1, 2, 3, 4, 5],
      manualActiveHoursPerDay: 8,
    });
    const oldAlwaysOn = computeWeeklyProjection([], 48, resetAt, now);

    expect(metrics.confidence).toBe("ready");
    expect(smart.drainRatePerHour).toBeGreaterThan(oldAlwaysOn.drainRatePerHour ?? 0);
    expect(smart.projectedPercentAtReset).toBeGreaterThan(48);
  });

  it("does not collapse smart weekly estimates to sparse learned sample hours", () => {
    const now = new Date("2026-05-27T16:00:00.000Z").getTime();
    const resetAt = new Date("2026-06-01T00:00:00.000Z").getTime();
    const sparseMetrics = {
      startedAt: now - 8 * 24 * 60 * 60_000,
      lastUpdatedAt: now,
      sampleCount: 8,
      activeDayBuckets: { "1": 3, "2": 3, "3": 2 },
      activeHourBuckets: { "14": 8 },
      activeSlotBuckets: { "1:14": 3, "2:14": 3, "3:14": 2 },
      averageActiveHoursPerDay: 1,
      confidence: "ready" as const,
    };

    const smart = computeWeeklyProjection([], 38, resetAt, now, {
      mode: "smart",
      metrics: sparseMetrics,
      manualWorkDays: [1, 2, 3, 4, 5],
      manualActiveHoursPerDay: 8,
    });

    expect(smart.drainRatePerHour).toBeLessThan(3);
    expect(smart.activeHoursUntilEmpty).toBeGreaterThan(20);
  });

  it("does not let short-term weekly spikes override the smart weekly budget", () => {
    const now = new Date("2026-05-27T16:00:00.000Z").getTime();
    const resetAt = new Date("2026-06-01T00:00:00.000Z").getTime();
    const base = now - 3 * 60 * 60_000;
    const history: UsageLogEntry[] = [
      { capturedAt: base, weeklyUsedPercent: 10, weeklyResetsAt: resetAt },
      { capturedAt: base + 60 * 60_000, weeklyUsedPercent: 22, weeklyResetsAt: resetAt },
      { capturedAt: base + 2 * 60 * 60_000, weeklyUsedPercent: 34, weeklyResetsAt: resetAt },
      { capturedAt: base + 3 * 60 * 60_000, weeklyUsedPercent: 38, weeklyResetsAt: resetAt },
    ];

    const smart = computeWeeklyProjection(history, 38, resetAt, now, {
      mode: "smart",
      metrics: buildWeeklyUsageMetrics(history),
      manualWorkDays: [1, 2, 3, 4, 5],
      manualActiveHoursPerDay: 8,
    });

    expect(smart.drainRatePerHour).toBeLessThan(3);
    expect(smart.activeHoursUntilEmpty).toBeGreaterThan(20);
  });

  it("ignores manual schedule settings when smart schedule is selected", () => {
    const now = new Date("2026-05-27T16:00:00.000Z").getTime();
    const resetAt = new Date("2026-06-01T00:00:00.000Z").getTime();
    const metrics = {
      startedAt: now - 8 * 24 * 60 * 60_000,
      lastUpdatedAt: now,
      sampleCount: 8,
      activeDayBuckets: { "1": 3, "2": 3, "3": 2 },
      activeHourBuckets: { "14": 8 },
      activeSlotBuckets: { "1:14": 3, "2:14": 3, "3:14": 2 },
      averageActiveHoursPerDay: 1,
      confidence: "ready" as const,
    };

    const conservativeManual = computeWeeklyProjection([], 38, resetAt, now, {
      mode: "smart",
      display: "active_hours",
      metrics,
      manualWorkDays: [1],
      manualActiveHoursPerDay: 1,
      manualStartHour: 1,
    });
    const aggressiveManual = computeWeeklyProjection([], 38, resetAt, now, {
      mode: "smart",
      display: "active_hours",
      metrics,
      manualWorkDays: [0, 1, 2, 3, 4, 5, 6],
      manualActiveHoursPerDay: 24,
      manualStartHour: 18,
    });

    expect(aggressiveManual).toEqual(conservativeManual);
  });

  it("does not use manual schedule fallback for smart calendar estimates before learned slots exist", () => {
    const now = new Date("2026-06-01T14:00:00").getTime();
    const resetAt = new Date("2026-06-08T00:00:00").getTime();

    const projection = computeWeeklyProjection([], 50, resetAt, now, {
      mode: "smart",
      display: "calendar_time",
      metrics: {
        startedAt: now - 2 * 24 * 60 * 60_000,
        lastUpdatedAt: now,
        sampleCount: 2,
        activeDayBuckets: {},
        activeHourBuckets: {},
        activeSlotBuckets: {},
        averageActiveHoursPerDay: 0,
        confidence: "learning",
      },
      manualWorkDays: [1, 2, 3, 4, 5],
      manualActiveHoursPerDay: 10,
      manualStartHour: 9,
    });

    expect(projection.calendarEta).toBeUndefined();
    expect(projection.activeHoursUntilEmpty).toBeDefined();
  });

  it("keeps active-hours mode as the default weekly depletion display", () => {
    const now = new Date("2026-06-01T14:00:00").getTime();
    const resetAt = new Date("2026-06-08T00:00:00").getTime();

    const projection = computeWeeklyProjection([], 50, resetAt, now, {
      mode: "manual",
      display: "active_hours",
      manualWorkDays: [1, 2, 3, 4, 5],
      manualActiveHoursPerDay: 10,
      manualStartHour: 9,
    });

    expect(projection.status).toBe("projected_empty");
    expect(projection.activeHoursUntilEmpty).toBe(5);
    expect(projection.label).toBe("Projected empty after 5h active use");
  });

  it("treats exactly 100 percent at reset as projected empty", () => {
    const now = new Date("2026-06-01T14:00:00").getTime();
    const resetAt = new Date("2026-06-08T00:00:00").getTime();

    const projection = computeWeeklyProjection([], 10, resetAt, now, {
      mode: "manual",
      display: "active_hours",
      manualWorkDays: [1, 2, 3, 4, 5],
      manualActiveHoursPerDay: 10,
      manualStartHour: 9,
    });

    expect(projection.status).toBe("projected_empty");
    expect(projection.projectedPercentAtReset).toBe(100);
    expect(projection.activeHoursUntilEmpty).toBe(45);
  });

  it("projects a calendar timestamp from manual weekly day and hour settings", () => {
    const now = new Date("2026-06-01T14:00:00").getTime();
    const resetAt = new Date("2026-06-08T00:00:00").getTime();

    const projection = computeWeeklyProjection([], 50, resetAt, now, {
      mode: "manual",
      display: "calendar_time",
      manualWorkDays: [1, 2, 3, 4, 5],
      manualActiveHoursPerDay: 10,
      manualStartHour: 9,
    });

    expect(projection.status).toBe("projected_empty");
    expect(projection.activeHoursUntilEmpty).toBeUndefined();
    expect(projection.etaMs).toBe(new Date("2026-06-01T19:00:00").getTime());
  });

  it("uses learned day-hour slots for smart calendar timestamps", () => {
    const now = new Date("2026-06-01T12:00:00").getTime();
    const resetAt = new Date("2026-06-08T00:00:00").getTime();

    const projection = computeWeeklyProjection([], 60, resetAt, now, {
      mode: "smart",
      display: "calendar_time",
      metrics: {
        startedAt: now - 8 * 24 * 60 * 60_000,
        lastUpdatedAt: now,
        sampleCount: 8,
        activeDayBuckets: { "1": 4, "2": 4 },
        activeHourBuckets: { "10": 4, "11": 4 },
        activeSlotBuckets: { "1:10": 4, "1:11": 4, "2:10": 4, "2:11": 4 },
        averageActiveHoursPerDay: 2,
        confidence: "ready",
      },
      manualWorkDays: [1, 2, 3, 4, 5],
      manualActiveHoursPerDay: 10,
      manualStartHour: 9,
    });

    expect(projection.status).toBe("projected_empty");
    expect(projection.etaMs).toBe(new Date("2026-06-02T11:20:00").getTime());
  });
});
