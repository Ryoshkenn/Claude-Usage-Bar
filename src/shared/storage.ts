import { STORAGE_KEYS } from "./constants";
import type { ChatUsage, DailyUsage, RealUsageSnapshot, Settings, StorageShape, UsageLogEntry } from "./types";

export interface StorageAdapter {
  get(keys?: string[] | string | Record<string, unknown> | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[] | string): Promise<void>;
}

export const DEFAULT_SETTINGS: Settings = {
  showOverlay: true,
  mode: "compact",
  barMetric: "session",
  ringTarget: "context",
  showBar: true,
  showBarLabel: false,
  showWheel: true,
  showWheelLabel: false,
};

const today = () => new Date().toLocaleDateString("en-CA");

export const defaultDailyUsage = (): DailyUsage => ({
  localDate: today(),
  messagesUsed: 0,
  lastVisibleSentCount: 0,
  updatedAt: Date.now(),
});

export const defaultChatUsage = (): ChatUsage => ({
  estimatedTokens: 0,
  visibleMessageCount: 0,
  updatedAt: Date.now(),
  isRefreshingContext: false,
});

export const chromeStorageAdapter: StorageAdapter = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (items) => chrome.storage.local.set(items),
  remove: (keys) => chrome.storage.local.remove(keys),
};

const unsafeKeys = new Set([
  "prompt",
  "prompts",
  "message",
  "messages",
  "content",
  "text",
  "response",
  "body",
  "authorization",
  "cookie",
  "cookies",
  "headers",
  "token",
  "auth",
]);

export const containsUnsafeConversationFields = (value: unknown): boolean => {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some(containsUnsafeConversationFields);
  }

  return Object.entries(value as Record<string, unknown>).some(([key, nested]) => {
    if (unsafeKeys.has(key.toLowerCase())) {
      return true;
    }
    return containsUnsafeConversationFields(nested);
  });
};

export const getStorage = async (adapter: StorageAdapter = chromeStorageAdapter): Promise<StorageShape> => {
  const data = await adapter.get([
    STORAGE_KEYS.settings,
    STORAGE_KEYS.dailyUsage,
    STORAGE_KEYS.chatUsage,
    STORAGE_KEYS.realUsageSnapshot,
    STORAGE_KEYS.usageHistory,
  ]);

  return {
    settings: { ...DEFAULT_SETTINGS, ...(data.settings as Partial<Settings> | undefined) },
    dailyUsage: (data.dailyUsage as DailyUsage | undefined) ?? defaultDailyUsage(),
    chatUsage: (data.chatUsage as ChatUsage | undefined) ?? defaultChatUsage(),
    realUsageSnapshot: data.realUsageSnapshot as RealUsageSnapshot | undefined,
    usageHistory: Array.isArray(data.usageHistory) ? (data.usageHistory as UsageLogEntry[]) : undefined,
  };
};

export const updateSettings = async (
  partial: Partial<Settings>,
  adapter: StorageAdapter = chromeStorageAdapter,
): Promise<Settings> => {
  const current = await getStorage(adapter);
  const settings: Settings = { ...current.settings, ...partial };
  await adapter.set({ [STORAGE_KEYS.settings]: settings });
  return settings;
};

export const saveDailyUsage = async (
  dailyUsage: DailyUsage,
  adapter: StorageAdapter = chromeStorageAdapter,
): Promise<void> => {
  await adapter.set({ [STORAGE_KEYS.dailyUsage]: dailyUsage });
};

export const saveChatUsage = async (
  chatUsage: ChatUsage,
  adapter: StorageAdapter = chromeStorageAdapter,
): Promise<void> => {
  await adapter.set({ [STORAGE_KEYS.chatUsage]: chatUsage });
};

export const saveRealUsageSnapshot = async (
  snapshot: RealUsageSnapshot,
  adapter: StorageAdapter = chromeStorageAdapter,
): Promise<void> => {
  if (containsUnsafeConversationFields(snapshot)) {
    throw new Error("Refusing to store unsafe usage snapshot");
  }
  await adapter.set({ [STORAGE_KEYS.realUsageSnapshot]: snapshot });
};

export const resetUsage = async (adapter: StorageAdapter = chromeStorageAdapter): Promise<void> => {
  await adapter.set({
    [STORAGE_KEYS.dailyUsage]: defaultDailyUsage(),
    [STORAGE_KEYS.chatUsage]: defaultChatUsage(),
  });
  await adapter.remove(STORAGE_KEYS.realUsageSnapshot);
};

const HISTORY_CAP = 100;

export const getUsageHistory = async (adapter: StorageAdapter = chromeStorageAdapter): Promise<UsageLogEntry[]> => {
  const data = await adapter.get(STORAGE_KEYS.usageHistory);
  const raw = data[STORAGE_KEYS.usageHistory];
  return Array.isArray(raw) ? (raw as UsageLogEntry[]) : [];
};

export const saveUsageHistory = async (
  history: UsageLogEntry[],
  adapter: StorageAdapter = chromeStorageAdapter,
): Promise<void> => {
  await adapter.set({ [STORAGE_KEYS.usageHistory]: history });
};

export const appendUsageHistoryEntry = async (
  entry: UsageLogEntry,
  adapter: StorageAdapter = chromeStorageAdapter,
): Promise<void> => {
  const history = await getUsageHistory(adapter);
  const last = history[history.length - 1];
  if (last && last.capturedAt === entry.capturedAt) {
    return;
  }
  history.push(entry);
  const trimmed = history.length > HISTORY_CAP ? history.slice(history.length - HISTORY_CAP) : history;
  await saveUsageHistory(trimmed, adapter);
};
