import { STORAGE_KEYS } from "./constants";
import { buildWeeklyUsageMetrics } from "./usageProjection";
import type {
  ChatUsage,
  DailyModelUsage,
  DailyUsage,
  PromptEntry,
  RealUsageSnapshot,
  Settings,
  StorageShape,
  UsageLogEntry,
  WeeklyUsageMetrics,
} from "./types";

export interface StorageAdapter {
  get(keys?: string[] | string | Record<string, unknown> | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[] | string): Promise<void>;
}

export const isExtensionContextInvalidatedError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /extension context invalidated/i.test(message);
};

const safeStorageGet = async (
  adapter: StorageAdapter,
  keys?: string[] | string | Record<string, unknown> | null,
): Promise<Record<string, unknown>> => {
  try {
    return await adapter.get(keys);
  } catch (error) {
    if (isExtensionContextInvalidatedError(error)) {
      return {};
    }
    throw error;
  }
};

const safeStorageSet = async (
  adapter: StorageAdapter,
  items: Record<string, unknown>,
): Promise<void> => {
  try {
    await adapter.set(items);
  } catch (error) {
    if (!isExtensionContextInvalidatedError(error)) {
      throw error;
    }
  }
};

const safeStorageRemove = async (
  adapter: StorageAdapter,
  keys: string[] | string,
): Promise<void> => {
  try {
    await adapter.remove(keys);
  } catch (error) {
    if (!isExtensionContextInvalidatedError(error)) {
      throw error;
    }
  }
};

export const DEFAULT_SETTINGS: Settings = {
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
  weeklyMetricsEnabled: false,
  weeklyPaceMode: "manual",
  weeklyEstimateDisplay: "active_hours",
  weeklyManualWorkDays: [1, 2, 3, 4, 5],
  weeklyManualActiveHoursPerDay: 10,
  weeklyManualStartHour: 9,
  hasSeenTour: false,
  showClipboard: true,
};

// Rewrite settings persisted by older versions onto the current schema. The
// "design" (Claude Design) metric was removed in 1.0.1 — Claude folded that
// usage into normal weekly usage — so any bar/wheel still set to it falls back
// to "weekly" instead of showing a dead, blank metric.
const migrateSettings = (settings: Settings): Settings => {
  const remapDesign = <T,>(value: T): T | "weekly" =>
    (value as unknown) === "design" ? "weekly" : value;
  // "context" is wheel-only now; an older bar set to it falls back to session.
  const bar = remapDesign(settings.barMetric);
  return {
    ...settings,
    barMetric: bar === "context" ? "session" : bar,
    ringTarget: remapDesign(settings.ringTarget),
  };
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

export const defaultWeeklyUsageMetrics = (): WeeklyUsageMetrics => ({
  startedAt: Date.now(),
  lastUpdatedAt: Date.now(),
  sampleCount: 0,
  activeDayBuckets: {},
  activeHourBuckets: {},
  activeSlotBuckets: {},
  averageActiveHoursPerDay: 0,
  confidence: "learning",
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
  const data = await safeStorageGet(adapter, [
    STORAGE_KEYS.settings,
    STORAGE_KEYS.dailyUsage,
    STORAGE_KEYS.chatUsage,
    STORAGE_KEYS.realUsageSnapshot,
    STORAGE_KEYS.usageHistory,
    STORAGE_KEYS.dailyMessageHistory,
    STORAGE_KEYS.weeklyUsageMetrics,
  ]);

  const usageHistory = Array.isArray(data.usageHistory) ? (data.usageHistory as UsageLogEntry[]) : undefined;

  return {
    settings: migrateSettings({ ...DEFAULT_SETTINGS, ...(data.settings as Partial<Settings> | undefined) }),
    dailyUsage: (data.dailyUsage as DailyUsage | undefined) ?? defaultDailyUsage(),
    chatUsage: (data.chatUsage as ChatUsage | undefined) ?? defaultChatUsage(),
    realUsageSnapshot: data.realUsageSnapshot as RealUsageSnapshot | undefined,
    usageHistory,
    dailyMessageHistory: Array.isArray(data.dailyMessageHistory)
      ? (data.dailyMessageHistory as DailyModelUsage[])
      : undefined,
    weeklyUsageMetrics:
      (data.weeklyUsageMetrics as WeeklyUsageMetrics | undefined) ??
      (usageHistory ? buildWeeklyUsageMetrics(usageHistory) : defaultWeeklyUsageMetrics()),
  };
};

export const updateSettings = async (
  partial: Partial<Settings>,
  adapter: StorageAdapter = chromeStorageAdapter,
): Promise<Settings> => {
  const current = await getStorage(adapter);
  const settings: Settings = { ...current.settings, ...partial };
  await safeStorageSet(adapter, { [STORAGE_KEYS.settings]: settings });
  return settings;
};

export const saveDailyUsage = async (
  dailyUsage: DailyUsage,
  adapter: StorageAdapter = chromeStorageAdapter,
): Promise<void> => {
  await safeStorageSet(adapter, { [STORAGE_KEYS.dailyUsage]: dailyUsage });
};

export const saveChatUsage = async (
  chatUsage: ChatUsage,
  adapter: StorageAdapter = chromeStorageAdapter,
): Promise<void> => {
  await safeStorageSet(adapter, { [STORAGE_KEYS.chatUsage]: chatUsage });
};

export const saveRealUsageSnapshot = async (
  snapshot: RealUsageSnapshot,
  adapter: StorageAdapter = chromeStorageAdapter,
): Promise<void> => {
  if (containsUnsafeConversationFields(snapshot)) {
    throw new Error("Refusing to store unsafe usage snapshot");
  }
  await safeStorageSet(adapter, { [STORAGE_KEYS.realUsageSnapshot]: snapshot });
};

export const resetUsage = async (adapter: StorageAdapter = chromeStorageAdapter): Promise<void> => {
  await safeStorageSet(adapter, {
    [STORAGE_KEYS.dailyUsage]: defaultDailyUsage(),
    [STORAGE_KEYS.chatUsage]: defaultChatUsage(),
    [STORAGE_KEYS.weeklyUsageMetrics]: defaultWeeklyUsageMetrics(),
  });
  await safeStorageRemove(adapter, [
    STORAGE_KEYS.realUsageSnapshot,
    STORAGE_KEYS.usageHistory,
    STORAGE_KEYS.dailyMessageHistory,
  ]);
};

const HISTORY_CAP = 100;

export const getUsageHistory = async (adapter: StorageAdapter = chromeStorageAdapter): Promise<UsageLogEntry[]> => {
  const data = await safeStorageGet(adapter, STORAGE_KEYS.usageHistory);
  const raw = data[STORAGE_KEYS.usageHistory];
  return Array.isArray(raw) ? (raw as UsageLogEntry[]) : [];
};

export const saveUsageHistory = async (
  history: UsageLogEntry[],
  adapter: StorageAdapter = chromeStorageAdapter,
): Promise<void> => {
  await safeStorageSet(adapter, { [STORAGE_KEYS.usageHistory]: history });
};

export const saveWeeklyUsageMetrics = async (
  weeklyUsageMetrics: WeeklyUsageMetrics,
  adapter: StorageAdapter = chromeStorageAdapter,
): Promise<void> => {
  await safeStorageSet(adapter, { [STORAGE_KEYS.weeklyUsageMetrics]: weeklyUsageMetrics });
};

export const clearWeeklyUsageMetrics = async (
  adapter: StorageAdapter = chromeStorageAdapter,
): Promise<WeeklyUsageMetrics> => {
  const weeklyUsageMetrics = defaultWeeklyUsageMetrics();
  await safeStorageSet(adapter, { [STORAGE_KEYS.weeklyUsageMetrics]: weeklyUsageMetrics });
  await safeStorageRemove(adapter, STORAGE_KEYS.usageHistory);
  return weeklyUsageMetrics;
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
  await saveWeeklyUsageMetrics(buildWeeklyUsageMetrics(trimmed), adapter);
};

// Keep roughly six months of daily history — enough for the popup's 14-day and
// last-6-months views without growing chrome.storage.local unbounded.
const DAILY_HISTORY_CAP = 200;

export type ModelBucket = "opus" | "sonnet" | "haiku" | "unknown";

export const getDailyModelHistory = async (
  adapter: StorageAdapter = chromeStorageAdapter,
): Promise<DailyModelUsage[]> => {
  const data = await safeStorageGet(adapter, STORAGE_KEYS.dailyMessageHistory);
  const raw = data[STORAGE_KEYS.dailyMessageHistory];
  return Array.isArray(raw) ? (raw as DailyModelUsage[]) : [];
};

export const saveDailyModelHistory = async (
  history: DailyModelUsage[],
  adapter: StorageAdapter = chromeStorageAdapter,
): Promise<void> => {
  await safeStorageSet(adapter, { [STORAGE_KEYS.dailyMessageHistory]: history });
};

// Add `increment` messages to today's per-model bucket, creating the day entry
// when needed. Days only advance, so a fresh day is appended at the tail.
export const appendDailyModelUsage = async (
  bucket: ModelBucket,
  increment: number,
  adapter: StorageAdapter = chromeStorageAdapter,
  now: number = Date.now(),
): Promise<void> => {
  if (increment <= 0) {
    return;
  }
  const date = new Date(now).toLocaleDateString("en-CA");
  const history = await getDailyModelHistory(adapter);
  let entry = history.find((e) => e.date === date);
  if (!entry) {
    entry = { date, opus: 0, sonnet: 0, haiku: 0, unknown: 0 };
    history.push(entry);
  }
  // `?? 0` tolerates entries persisted before a bucket existed.
  entry[bucket] = (entry[bucket] ?? 0) + increment;
  const trimmed =
    history.length > DAILY_HISTORY_CAP ? history.slice(history.length - DAILY_HISTORY_CAP) : history;
  await saveDailyModelHistory(trimmed, adapter);
};

export const getPrompts = async (adapter: StorageAdapter = chromeStorageAdapter): Promise<PromptEntry[]> => {
  const data = await safeStorageGet(adapter, STORAGE_KEYS.prompts);
  const raw = data[STORAGE_KEYS.prompts];
  return Array.isArray(raw) ? (raw as PromptEntry[]) : [];
};

export const savePrompts = async (
  prompts: PromptEntry[],
  adapter: StorageAdapter = chromeStorageAdapter,
): Promise<void> => {
  await safeStorageSet(adapter, { [STORAGE_KEYS.prompts]: prompts });
};
