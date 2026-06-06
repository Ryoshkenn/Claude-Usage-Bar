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
} as const;

export const MESSAGE_TYPES = {
  realUsage: "CLAUDE_USAGE_BAR_REAL_USAGE",
  fetchApiUsage: "CLAUDE_USAGE_BAR_FETCH_API_USAGE",
  fetchConversationContext: "CLAUDE_USAGE_BAR_FETCH_CONVERSATION_CONTEXT",
  openSettings: "CLAUDE_USAGE_BAR_OPEN_SETTINGS",
} as const;

export const CLAUDE_ORIGIN = "https://claude.ai";
