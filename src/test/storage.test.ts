import { describe, expect, it } from "vitest";
import {
  containsUnsafeConversationFields,
  getStorage,
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
    expect(state.settings).toEqual({ showOverlay: true, mode: "compact" });
    expect(state.dailyUsage.messagesUsed).toBe(0);
    expect(state.chatUsage.estimatedTokens).toBe(0);
  });

  it("merges settings", async () => {
    const adapter = createAdapter({ settings: { showOverlay: false, mode: "compact" } });
    const settings = await updateSettings({ mode: "expanded" }, adapter);
    expect(settings).toEqual({ showOverlay: false, mode: "expanded" });
    expect(adapter.data.settings).toEqual(settings);
  });

  it("resets usage without clearing settings", async () => {
    const adapter = createAdapter({
      settings: { showOverlay: false, mode: "expanded" },
      dailyUsage: { messagesUsed: 5 },
      realUsageSnapshot: { remainingText: "1 left" },
    });
    await resetUsage(adapter);
    expect(adapter.data.settings).toEqual({ showOverlay: false, mode: "expanded" });
    expect(adapter.data.realUsageSnapshot).toBeUndefined();
    expect((adapter.data.dailyUsage as { messagesUsed: number }).messagesUsed).toBe(0);
  });

  it("detects unsafe private fields", () => {
    expect(containsUnsafeConversationFields({ nested: { prompt: "hello" } })).toBe(true);
    expect(containsUnsafeConversationFields({ remainingText: "10 messages left" })).toBe(false);
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
