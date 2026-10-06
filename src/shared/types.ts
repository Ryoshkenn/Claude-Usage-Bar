export type OverlayMode = "compact" | "expanded";
export type UsageSource = "estimated" | "real";
export type MetricTarget = "session" | "weekly" | "weekly_fable" | "context";
export type RingTarget = MetricTarget | "hidden";
// How the context window indicator renders: a filling ring or the percentage as text.
export type ContextDisplay = "ring" | "text";
export type PaceSurplusFormat = "percent" | "time" | "messages";
export type WeeklyPaceMode = "smart" | "manual";
// What the weekly row shows: usable active hours left, the day/time you'll run
// out, or the percentage you're on pace to reach by reset.
export type WeeklyEstimateDisplay = "active_hours" | "calendar_time" | "percent_at_reset";
export type WeeklyUsageConfidence = "learning" | "ready";
// Per-message thinking level selectable in claude.ai. Opus exposes all five;
// Sonnet stops at "high"; Haiku has no levels (handled as on/off in modelUsage).
export type ThinkingLevel = "off" | "low" | "medium" | "high" | "extra" | "max";

export interface PromptEntry {
  id: string;
  title: string;
  content: string;
  tags: string[];
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  showOverlay: boolean;
  mode: OverlayMode;
  barMetric: MetricTarget;
  ringTarget: RingTarget;
  showBar: boolean;
  showBarLabel: boolean;
  showWheel: boolean;
  showWheelLabel: boolean;
  contextDisplay: ContextDisplay;
  showPace: boolean;
  showCacheTimer: boolean;
  paceSurplusFormat: PaceSurplusFormat;
  weeklyMetricsEnabled: boolean;
  weeklyEstimateDisplay: WeeklyEstimateDisplay;
  // Fixed schedule the weekly estimate falls back to while learning (or with
  // learning off). No longer editable — the manual mode was removed — but a
  // schedule set in an older version keeps being honoured.
  weeklyManualWorkDays: number[];
  weeklyManualActiveHoursPerDay: number;
  weeklyManualStartHour: number;
  hasSeenTour: boolean;
  showClipboard: boolean;
  // Overlay/popup UI language. Default "en"; user-selectable in settings. See SUPPORTED_LANGUAGES.
  language: string;
  // Show a banner when a usage window rolls over. "off" disables it entirely,
  // "claude" only banners claude.ai tabs (no extra permission), "everywhere"
  // banners any normal site and requires the optional all-sites host permission.
  // Covers both the 5-hour and weekly windows.
  resetBannerScope: ResetBannerScope;
}

export type ResetBannerScope = "off" | "claude" | "everywhere";

// Which usage window rolled over.
export type ResetKind = "session" | "weekly";

export interface DailyUsage {
  localDate: string;
  messagesUsed: number;
  lastVisibleSentCount: number;
  updatedAt: number;
}

// One calendar day of messages sent, split by model family. Populated going
// forward only (no backfill) by appendDailyModelUsage; feeds the popup chart.
export interface DailyModelUsage {
  date: string; // en-CA local key, matches getLocalDateKey()
  opus: number;
  sonnet: number;
  haiku: number;
  // Messages we can't tie to a claude.ai model — e.g. Claude Code or cowork.
  unknown: number;
}

// What is occupying the context window, split by the kind of content that put
// it there. Numeric only — never any message text (see the privacy rule in
// CLAUDE.md); `count` is how many items of that kind contributed.
export type ContextCategory =
  | "userMessages"
  | "assistantMessages"
  | "thinking"
  | "toolCalls"
  | "toolResults"
  | "attachments"
  | "projectKnowledge"
  | "overhead";

export interface ContextBreakdownEntry {
  tokens: number;
  count: number;
}

export interface ContextBreakdown {
  entries: Record<ContextCategory, ContextBreakdownEntry>;
  // Sum of every entry's tokens. Equals ChatUsage.currentContextTokens so the
  // panel's rows add up to the headline number the ring shows.
  totalTokens: number;
}

export interface ChatUsage {
  estimatedTokens: number;
  visibleMessageCount: number;
  updatedAt: number;
  source?: "dom" | "conversation_api";
  isRefreshingContext?: boolean;
  currentContextTokens?: number;
  compoundedInputTokens?: number;
  cachedPrefixTokens?: number;
  cacheExpiresAt?: number;
  lengthIsEstimate?: boolean;
  contextBreakdown?: ContextBreakdown;
}

// A per-model weekly limit (Max plans expose these alongside the all-models
// weekly limit, e.g. a separate Sonnet or Opus weekly cap). Sourced from the
// `limits` array (kind: "weekly_scoped") or the legacy `seven_day_<model>` keys.
export interface WeeklyScopedLimit {
  modelLabel: string;
  percentageUsed: number;
  resetsAt?: number;
  resetText?: string;
}

export interface RealUsageSnapshot {
  source: "real";
  capturedAt: number;
  modelLabel?: string;
  thinkingLevel?: ThinkingLevel;
  resetText?: string;
  remainingText?: string;
  remainingMessages?: number;
  usedMessages?: number;
  totalMessages?: number;
  limitText?: string;
  percentageUsed?: number;
  sessionResetsAt?: number;
  weeklyAllModelsPercentageUsed?: number;
  weeklyAllModelsResetText?: string;
  weeklyAllModelsResetsAt?: number;
  weeklyScopedLimits?: WeeklyScopedLimit[];
}

export interface UsageLogEntry {
  capturedAt: number;
  sessionUsedPercent?: number;
  sessionResetsAt?: number;
  weeklyUsedPercent?: number;
  weeklyResetsAt?: number;
  // Optional, additive fields for model-aware projection. Older entries (and
  // refreshes without DOM context) omit them; learners skip such intervals.
  cumulativeMessageCount?: number; // monotonic message counter at capture (dailyUsage.messagesUsed)
  modelWeight?: number; // EFFECTIVE usage weight at capture: base weight (Opus 1, Sonnet 2.5, Haiku 10) ÷ thinking multiplier
  // The model + thinking level active when this interval's messages were sent.
  // Let the learner bucket observed cost per (model, thinking) segment and correct
  // the hardcoded multipliers from real data. Older entries omit them.
  modelLabel?: string;
  thinkingLevel?: ThinkingLevel;
}

export interface WeeklyUsageMetrics {
  startedAt: number;
  lastUpdatedAt: number;
  sampleCount: number;
  activeDayBuckets: Record<string, number>;
  activeHourBuckets: Record<string, number>;
  activeSlotBuckets: Record<string, number>;
  averageActiveHoursPerDay: number;
  confidence: WeeklyUsageConfidence;
}

export interface WeeklyProjectionOptions {
  mode: WeeklyPaceMode;
  display?: WeeklyEstimateDisplay;
  metrics?: WeeklyUsageMetrics;
  manualWorkDays: number[];
  manualActiveHoursPerDay: number;
  manualStartHour?: number;
}

export type ProjectionStatus = "insufficient_data" | "lasting_to_reset" | "projected_empty";

export interface UsageProjection {
  status: ProjectionStatus;
  etaMs?: number;
  drainRatePerHour?: number;
  activeHoursUntilEmpty?: number;
  projectedPercentAtReset?: number;
  calendarEta?: boolean;
  label: string;
}

export interface ApiUsageResponse {
  ok: boolean;
  snapshot?: RealUsageSnapshot;
  error?: string;
  status?: number;
}

export interface ConversationContextResponse {
  ok: boolean;
  chatUsage?: ChatUsage;
  error?: string;
}

export interface UsageMetadata {
  modelLabel?: string;
  thinkingLevel?: ThinkingLevel;
  resetText?: string;
  remainingText?: string;
  remainingMessages?: number;
  usedMessages?: number;
  totalMessages?: number;
  limitText?: string;
  percentageUsed?: number;
  sessionResetsAt?: number;
  weeklyAllModelsPercentageUsed?: number;
  weeklyAllModelsResetText?: string;
  weeklyAllModelsResetsAt?: number;
  weeklyScopedLimits?: WeeklyScopedLimit[];
}

export interface StorageShape {
  settings: Settings;
  dailyUsage: DailyUsage;
  chatUsage: ChatUsage;
  realUsageSnapshot?: RealUsageSnapshot;
  usageHistory?: UsageLogEntry[];
  dailyMessageHistory?: DailyModelUsage[];
  weeklyUsageMetrics: WeeklyUsageMetrics;
}
