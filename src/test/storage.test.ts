import { describe, expect, it } from "vitest";
import {
  appendDailyModelUsage,
  appendUsageHistoryEntry,
  clearWeeklyUsageMetrics,
  containsUnsafeConversationFields,
  getDailyModelHistory,
  getStorage,
  getUsageHistory,
  isExtensionContextInvalidatedError,
  resetUsage,
  saveChatUsage,
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
  it("detects Chrome extension context invalidation errors", () => {
    expect(isExtensionContextInvalidatedError(new Error("Extension context invalidated."))).toBe(true);
    expect(isExtensionContextInvalidatedError(new Error("other storage failure"))).toBe(false);
  });

  it("falls back to defaults when Chrome storage is unavailable after extension reload", async () => {
    const adapter: StorageAdapter = {
      async get() {
        throw new Error("Extension context invalidated.");
      },
      async set() {
        throw new Error("Extension context invalidated.");
      },
      async remove() {
        throw new Error("Extension context invalidated.");
      },
    };

    const state = await getStorage(adapter);

    expect(state.settings.showOverlay).toBe(true);
    expect(state.dailyUsage.messagesUsed).toBe(0);
    await expect(saveChatUsage({ estimatedTokens: 1, visibleMessageCount: 1, updatedAt: 1 }, adapter)).resolves.toBeUndefined();
    await expect(resetUsage(adapter)).resolves.toBeUndefined();
  });

  it("reads defaults", async () => {
    const state = await getStorage(createAdapter());
    expect(state.settings).toEqual({
      showOverlay: true,
      mode: "compact",
      barMetric: "session",
      ringTarget: "context",
      showBar: false,
      showBarLabel: false,
      showWheel: true,
      showWheelLabel: false,
      contextDisplay: "ring",
      showPace: true,
      showCacheTimer: false,
      paceSurplusFormat: "percent",
      weeklyMetricsEnabled: true,
      weeklyPaceMode: "smart",
      weeklyEstimateDisplay: "active_hours",
      weeklyManualWorkDays: [1, 2, 3, 4, 5],
      weeklyManualActiveHoursPerDay: 5,
      weeklyManualStartHour: 9,
      hasSeenTour: false,
      showClipboard: true,
      language: "en",
      resetBannerScope: "claude",
      resetBannerSession: true,
      resetBannerWeekly: true,
    });
    expect(state.dailyUsage.messagesUsed).toBe(0);
    expect(state.chatUsage.estimatedTokens).toBe(0);
    expect(state.weeklyUsageMetrics.confidence).toBe("learning");
  });

  it("migrates the removed \"design\" metric to weekly", async () => {
    const adapter = createAdapter({ settings: { barMetric: "design", ringTarget: "design" } });
    const state = await getStorage(adapter);
    expect(state.settings.barMetric).toBe("weekly");
    // The ring is now context-only, so any stored ring metric normalizes to context.
    expect(state.settings.ringTarget).toBe("context");
  });

  it("normalizes the ring to the context window indicator", async () => {
    const adapter = createAdapter({ settings: { ringTarget: "session", showWheelLabel: true } });
    const state = await getStorage(adapter);
    expect(state.settings.ringTarget).toBe("context");
    expect(state.settings.showWheelLabel).toBe(false);
  });

  it("honors stored bar and cache-timer toggles instead of forcing them off", async () => {
    const adapter = createAdapter({ settings: { showBar: true, showCacheTimer: true } });
    const state = await getStorage(adapter);
    expect(state.settings.showBar).toBe(true);
    expect(state.settings.showCacheTimer).toBe(true);

    const updated = await updateSettings({ showBar: true }, createAdapter());
    expect(updated.showBar).toBe(true);
    const reread = await getStorage(createAdapter({ settings: updated }));
    expect(reread.settings.showBar).toBe(true);
  });

  it("defaults weekly learning on with smart pacing", async () => {
    const state = await getStorage(createAdapter());

    expect(state.settings.weeklyMetricsEnabled).toBe(true);
    expect(state.settings.weeklyPaceMode).toBe("smart");
  });

  it("merges settings", async () => {
    const adapter = createAdapter({ settings: { showOverlay: false, mode: "compact" } });
    const settings = await updateSettings({ mode: "expanded" }, adapter);
    expect(settings).toEqual({
      showOverlay: false,
      mode: "expanded",
      barMetric: "session",
      ringTarget: "context",
      showBar: false,
      showBarLabel: false,
      showWheel: true,
      showWheelLabel: false,
      contextDisplay: "ring",
      showPace: true,
      showCacheTimer: false,
      paceSurplusFormat: "percent",
      weeklyMetricsEnabled: true,
      weeklyPaceMode: "smart",
      weeklyEstimateDisplay: "active_hours",
      weeklyManualWorkDays: [1, 2, 3, 4, 5],
      weeklyManualActiveHoursPerDay: 5,
      weeklyManualStartHour: 9,
      hasSeenTour: false,
      showClipboard: true,
      language: "en",
      resetBannerScope: "claude",
      resetBannerSession: true,
      resetBannerWeekly: true,
    });
    expect(adapter.data.settings).toEqual(settings);
  });

  it("resets usage without clearing settings", async () => {
    const adapter = createAdapter({
      settings: { showOverlay: false, mode: "expanded" },
      dailyUsage: { messagesUsed: 5 },
      realUsageSnapshot: { remainingText: "1 left" },
      usageHistory: [{ capturedAt: 1, weeklyUsedPercent: 50 }],
      dailyMessageHistory: [{ date: "2026-06-18", opus: 2, sonnet: 0, haiku: 0, unknown: 0 }],
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
    expect(adapter.data.dailyMessageHistory).toBeUndefined();
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

  it("accumulates daily per-model usage into one entry per day", async () => {
    const adapter = createAdapter();
    const t = new Date("2026-06-18T10:00:00").getTime();
    await appendDailyModelUsage("opus", 2, adapter, t);
    await appendDailyModelUsage("sonnet", 1, adapter, t + 1000);
    await appendDailyModelUsage("opus", 3, adapter, t + 2000);
    const history = await getDailyModelHistory(adapter);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ date: "2026-06-18", opus: 5, sonnet: 1, haiku: 0, unknown: 0 });
  });

  it("ignores non-positive daily increments", async () => {
    const adapter = createAdapter();
    await appendDailyModelUsage("opus", 0, adapter, Date.now());
    await appendDailyModelUsage("haiku", -3, adapter, Date.now());
    expect(await getDailyModelHistory(adapter)).toHaveLength(0);
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
