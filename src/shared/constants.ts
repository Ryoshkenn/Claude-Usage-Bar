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
  // Claude's UI language tag (e.g. "en-US") as last seen on a claude.ai page, so
  // the popup, grant page and worker can follow the language they can't read.
  claudeLanguage: "claudeLanguage",
  prompts: "prompts",
  openSettingsOnLoad: "openSettingsOnLoad",
  // Reset timestamps the alarm has already fired for, so a rollover banners once
  // rather than on every wake-up until the next fetch moves the timestamp.
  announcedResets: "announcedResets",
  // chrome.storage.session, shared by every claude.ai tab: per-thread working /
  // done timestamps keyed by Claude's row key ("chat:<uuid>"). Ids and numbers
  // only — never titles — and gone when the browser closes.
  threadActivity: "threadActivity",
  // chrome.storage.local: where the thread view has put each thread — when the
  // view was turned on (everything counts as settled as of then), plus row key
  // → when it opened and row key → when it was settled by hand. Ids and times
  // only, and removed when the view is turned off.
  threadPlaces: "threadPlaces",
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
  // Content script → worker: the thread view's shared state, which only the
  // worker writes (see src/shared/threadStore.ts).
  threadActivityPatch: "CLAUDE_USAGE_BAR_THREAD_ACTIVITY_PATCH",
  threadPlacesPatch: "CLAUDE_USAGE_BAR_THREAD_PLACES_PATCH",
  threadPlacesForget: "CLAUDE_USAGE_BAR_THREAD_PLACES_FORGET",
} as const;

export const CLAUDE_ORIGIN = "https://claude.ai";
