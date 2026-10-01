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
} as const;

export const MESSAGE_TYPES = {
  realUsage: "CLAUDE_USAGE_BAR_REAL_USAGE",
  fetchApiUsage: "CLAUDE_USAGE_BAR_FETCH_API_USAGE",
  fetchConversationContext: "CLAUDE_USAGE_BAR_FETCH_CONVERSATION_CONTEXT",
  openSettings: "CLAUDE_USAGE_BAR_OPEN_SETTINGS",
  syncResetBanner: "CLAUDE_USAGE_BAR_SYNC_RESET_BANNER",
  testResetBanner: "CLAUDE_USAGE_BAR_TEST_RESET_BANNER",
  requestAllSites: "CLAUDE_USAGE_BAR_REQUEST_ALL_SITES",
} as const;

export const CLAUDE_ORIGIN = "https://claude.ai";
