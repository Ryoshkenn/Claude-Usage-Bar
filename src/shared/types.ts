export type OverlayMode = "compact" | "expanded";
export type UsageSource = "estimated" | "real";
export type MetricTarget = "session" | "weekly" | "context" | "design";
export type RingTarget = MetricTarget | "hidden";
export type PaceSurplusFormat = "percent" | "time";

export interface Settings {
  showOverlay: boolean;
  mode: OverlayMode;
  barMetric: MetricTarget;
  ringTarget: RingTarget;
  showBar: boolean;
  showBarLabel: boolean;
  showWheel: boolean;
  showWheelLabel: boolean;
  showPace: boolean;
  paceSurplusFormat: PaceSurplusFormat;
}

export interface DailyUsage {
  localDate: string;
  messagesUsed: number;
  lastVisibleSentCount: number;
  updatedAt: number;
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
}

export interface RealUsageSnapshot {
  source: "real";
  capturedAt: number;
  modelLabel?: string;
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
  claudeDesignPercentageUsed?: number;
  claudeDesignResetText?: string;
  claudeDesignResetsAt?: number;
  routinesText?: string;
}

export interface UsageLogEntry {
  capturedAt: number;
  sessionUsedPercent?: number;
  sessionResetsAt?: number;
  weeklyUsedPercent?: number;
  weeklyResetsAt?: number;
}

export type ProjectionStatus = "insufficient_data" | "lasting_to_reset" | "projected_empty";

export interface UsageProjection {
  status: ProjectionStatus;
  etaMs?: number;
  drainRatePerHour?: number;
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
  claudeDesignPercentageUsed?: number;
  claudeDesignResetText?: string;
  claudeDesignResetsAt?: number;
  routinesText?: string;
}

export interface StorageShape {
  settings: Settings;
  dailyUsage: DailyUsage;
  chatUsage: ChatUsage;
  realUsageSnapshot?: RealUsageSnapshot;
  usageHistory?: UsageLogEntry[];
}
