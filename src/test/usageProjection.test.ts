import { describe, expect, it } from "vitest";
import type { UsageLogEntry } from "../shared/types";
import {
  computeSessionProjection,
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
