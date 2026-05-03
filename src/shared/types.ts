export type OverlayMode = "compact" | "expanded";
export type UsageSource = "estimated" | "real";

export interface Settings {
  showOverlay: boolean;
  mode: OverlayMode;
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
  weeklyAllModelsPercentageUsed?: number;
  weeklyAllModelsResetText?: string;
  claudeDesignPercentageUsed?: number;
  claudeDesignResetText?: string;
  routinesText?: string;
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
  weeklyAllModelsPercentageUsed?: number;
  weeklyAllModelsResetText?: string;
  claudeDesignPercentageUsed?: number;
  claudeDesignResetText?: string;
  routinesText?: string;
}

export interface StorageShape {
  settings: Settings;
  dailyUsage: DailyUsage;
  chatUsage: ChatUsage;
  realUsageSnapshot?: RealUsageSnapshot;
}
