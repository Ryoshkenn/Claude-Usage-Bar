import { describe, expect, it } from "vitest";
import {
  appendUsageHistoryEntry,
  clearWeeklyUsageMetrics,
  containsUnsafeConversationFields,
  getStorage,
  getUsageHistory,
  resetUsage,
  saveRealUsageSnapshot,
  updateSettings,
  type StorageAdapter,
} from "../shared/storage";

const createAdapter = (initial: Record<string, unknown> = {}): StorageAdapter & { data: Record<string, unknown> } => {
  const adapter = {
    data: { ...initial },
    async get(keys?: string[] | string | Record<string, unknown> | null) {
      if (!keys) {
        return { ...this.data };
      }
      if (Array.isArray(keys)) {
        return Object.fromEntries(keys.map((key) => [key, this.data[key]]));
      }
      if (typeof keys === "string") {
        return { [keys]: this.data[keys] };
      }
      return Object.fromEntries(Object.keys(keys).map((key) => [key, this.data[key] ?? keys[key]]));
    },
    async set(items: Record<string, unknown>) {
      this.data = { ...this.data, ...items };
    },
    async remove(keys: string[] | string) {
      const list = Array.isArray(keys) ? keys : [keys];
      list.forEach((key) => {
        delete this.data[key];
      });
    },
  };
  return adapter;
};

describe("storage helpers", () => {
  it("reads defaults", async () => {
    const state = await getStorage(createAdapter());
    expect(state.settings).toEqual({
      showOverlay: true,
      mode: "compact",
      barMetric: "session",
      ringTarget: "context",
      showBar: true,
      showBarLabel: false,
      showWheel: true,
      showWheelLabel: false,
      showPace: true,
      showCacheTimer: true,
      paceSurplusFormat: "percent",
      weeklyMetricsEnabled: true,
      weeklyPaceMode: "smart",
      weeklyEstimateDisplay: "active_hours",
      weeklyManualWorkDays: [1, 2, 3, 4, 5],
      weeklyManualActiveHoursPerDay: 10,
      weeklyManualStartHour: 9,
      hasSeenTour: false,
      showClipboard: true,
    });
    expect(state.dailyUsage.messagesUsed).toBe(0);
    expect(state.chatUsage.estimatedTokens).toBe(0);
    expect(state.weeklyUsageMetrics.confidence).toBe("learning");
  });

  it("migrates the removed \"design\" metric to weekly", async () => {
    const adapter = createAdapter({ settings: { barMetric: "design", ringTarget: "design" } });
    const state = await getStorage(adapter);
    expect(state.settings.barMetric).toBe("weekly");
    expect(state.settings.ringTarget).toBe("weekly");
  });

  it("merges settings", async () => {
    const adapter = createAdapter({ settings: { showOverlay: false, mode: "compact" } });
    const settings = await updateSettings({ mode: "expanded" }, adapter);
    expect(settings).toEqual({
      showOverlay: false,
      mode: "expanded",
      barMetric: "session",
      ringTarget: "context",
      showBar: true,
      showBarLabel: false,
      showWheel: true,
      showWheelLabel: false,
      showPace: true,
      showCacheTimer: true,
      paceSurplusFormat: "percent",
      weeklyMetricsEnabled: true,
      weeklyPaceMode: "smart",
      weeklyEstimateDisplay: "active_hours",
      weeklyManualWorkDays: [1, 2, 3, 4, 5],
      weeklyManualActiveHoursPerDay: 10,
      weeklyManualStartHour: 9,
      hasSeenTour: false,
      showClipboard: true,
    });
    expect(adapter.data.settings).toEqual(settings);
  });

  it("resets usage without clearing settings", async () => {
    const adapter = createAdapter({
      settings: { showOverlay: false, mode: "expanded" },
      dailyUsage: { messagesUsed: 5 },
      realUsageSnapshot: { remainingText: "1 left" },
      usageHistory: [{ capturedAt: 1, weeklyUsedPercent: 50 }],
      weeklyUsageMetrics: {
        startedAt: 1,
        lastUpdatedAt: 1,
        sampleCount: 1,
        activeDayBuckets: { "1": 1 },
        activeHourBuckets: { "14": 1 },
        activeSlotBuckets: { "1:14": 1 },
        averageActiveHoursPerDay: 1,
        confidence: "learning",
      },
    });
    await resetUsage(adapter);
    expect(adapter.data.settings).toEqual({ showOverlay: false, mode: "expanded" });
    expect(adapter.data.realUsageSnapshot).toBeUndefined();
    expect(adapter.data.usageHistory).toBeUndefined();
    expect((adapter.data.dailyUsage as { messagesUsed: number }).messagesUsed).toBe(0);
    expect((adapter.data.weeklyUsageMetrics as { sampleCount: number }).sampleCount).toBe(0);
  });

  it("clears learned weekly patterns without clearing settings", async () => {
    const adapter = createAdapter({
      settings: { weeklyPaceMode: "smart" },
      usageHistory: [{ capturedAt: 1, weeklyUsedPercent: 50 }],
      weeklyUsageMetrics: {
        startedAt: 1,
        lastUpdatedAt: 1,
        sampleCount: 1,
        activeDayBuckets: { "1": 1 },
        activeHourBuckets: { "14": 1 },
        activeSlotBuckets: { "1:14": 1 },
        averageActiveHoursPerDay: 1,
        confidence: "ready",
      },
    });

    const metrics = await clearWeeklyUsageMetrics(adapter);

    expect(adapter.data.settings).toEqual({ weeklyPaceMode: "smart" });
    expect(adapter.data.usageHistory).toBeUndefined();
    expect(metrics.sampleCount).toBe(0);
    expect((adapter.data.weeklyUsageMetrics as { sampleCount: number }).sampleCount).toBe(0);
  });

  it("detects unsafe private fields", () => {
    expect(containsUnsafeConversationFields({ nested: { prompt: "hello" } })).toBe(true);
    expect(containsUnsafeConversationFields({ remainingText: "10 messages left" })).toBe(false);
  });

  it("appends history and caps at 100 entries", async () => {
    const adapter = createAdapter();
    for (let i = 0; i < 102; i++) {
      await appendUsageHistoryEntry({ capturedAt: i, sessionUsedPercent: i }, adapter);
    }
    const history = await getUsageHistory(adapter);
    expect(history).toHaveLength(100);
    expect(history[0].capturedAt).toBe(2);
    expect(history[99].capturedAt).toBe(101);
  });

  it("skips duplicate capturedAt entries", async () => {
    const adapter = createAdapter();
    await appendUsageHistoryEntry({ capturedAt: 1000, sessionUsedPercent: 10 }, adapter);
    await appendUsageHistoryEntry({ capturedAt: 1000, sessionUsedPercent: 10 }, adapter);
    const history = await getUsageHistory(adapter);
    expect(history).toHaveLength(1);
  });

  it("refuses unsafe real usage snapshots", async () => {
    const adapter = createAdapter();
    await expect(
      saveRealUsageSnapshot(
        {
          source: "real",
          capturedAt: Date.now(),
          remainingText: "10 left",
          prompt: "private",
        } as never,
        adapter,
      ),
    ).rejects.toThrow("unsafe");
  });
});
