export const EXTENSION_NAME = "Claude Usage Bar";

export const STORAGE_KEYS = {
  settings: "settings",
  dailyUsage: "dailyUsage",
  chatUsage: "chatUsage",
  realUsageSnapshot: "realUsageSnapshot",
  organizationId: "organizationId",
} as const;

export const MESSAGE_TYPES = {
  realUsage: "CLAUDE_USAGE_BAR_REAL_USAGE",
  fetchApiUsage: "CLAUDE_USAGE_BAR_FETCH_API_USAGE",
} as const;

export const CLAUDE_ORIGIN = "https://claude.ai";
