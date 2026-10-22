export const EXTENSION_NAME = "Claude Usage Bar";

export const STORAGE_KEYS = {
  settings: "settings",
  dailyUsage: "dailyUsage",
  chatUsage: "chatUsage",
  realUsageSnapshot: "realUsageSnapshot",
  organizationId: "organizationId",
  usageHistory: "usageHistory",
  dailyMessageHistory: "dailyMessageHistory",
  weeklyUsageMetrics: "weeklyUsageMetrics",
  reviewBannerDismissedAt: "reviewBannerDismissedAt",
  installedAt: "installedAt",
  detectedTheme: "detectedTheme",
  prompts: "prompts",
  openSettingsOnLoad: "openSettingsOnLoad",
  // Reset timestamps the alarm has already fired for, so a rollover banners once
  // rather than on every wake-up until the next fetch moves the timestamp.
  announcedResets: "announcedResets",
  // chrome.storage.session, shared by every claude.ai tab: per-thread working /
  // done timestamps keyed by Claude's row key ("chat:<uuid>"). Ids and numbers
  // only — never titles — and gone when the browser closes.
  threadActivity: "threadActivity",
} as const;

export const MESSAGE_TYPES = {
  realUsage: "CLAUDE_USAGE_BAR_REAL_USAGE",
  fetchApiUsage: "CLAUDE_USAGE_BAR_FETCH_API_USAGE",
  fetchConversationContext: "CLAUDE_USAGE_BAR_FETCH_CONVERSATION_CONTEXT",
  openSettings: "CLAUDE_USAGE_BAR_OPEN_SETTINGS",
  syncResetBanner: "CLAUDE_USAGE_BAR_SYNC_RESET_BANNER",
  testResetBanner: "CLAUDE_USAGE_BAR_TEST_RESET_BANNER",
  requestAllSites: "CLAUDE_USAGE_BAR_REQUEST_ALL_SITES",
  // Page probe → content script: thread ids with created / updated times seen in
  // Claude's own API responses. Hardcoded again in public/pageProbe.js.
  threadTimes: "CLAUDE_USAGE_BAR_THREAD_TIMES",
  threadDone: "CLAUDE_USAGE_BAR_THREAD_DONE",
  openThread: "CLAUDE_USAGE_BAR_OPEN_THREAD",
} as const;

export const CLAUDE_ORIGIN = "https://claude.ai";
