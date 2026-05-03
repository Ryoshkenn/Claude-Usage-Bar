import { MESSAGE_TYPES } from "../shared/constants";
import type { RealUsageSnapshot, UsageMetadata } from "../shared/types";

const allowedStringKeys = new Set([
  "modelLabel",
  "resetText",
  "remainingText",
  "limitText",
  "weeklyAllModelsResetText",
  "claudeDesignResetText",
  "routinesText",
]);
const allowedNumberKeys = new Set([
  "remainingMessages",
  "usedMessages",
  "totalMessages",
  "percentageUsed",
  "weeklyAllModelsPercentageUsed",
  "claudeDesignPercentageUsed",
]);
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

export const sanitizeUsageMetadata = (payload: unknown): UsageMetadata | null => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const input = payload as Record<string, unknown>;
  const output: UsageMetadata = {};

  for (const [key, value] of Object.entries(input)) {
    if (unsafeKeys.has(key.toLowerCase())) {
      return null;
    }

    if (allowedStringKeys.has(key) && typeof value === "string" && value.length <= 160) {
      output[key as keyof UsageMetadata] = value as never;
    }

    if (allowedNumberKeys.has(key) && typeof value === "number" && Number.isFinite(value)) {
      output[key as keyof UsageMetadata] = value as never;
    }
  }

  return Object.keys(output).length > 0 ? output : null;
};

export const messageToSnapshot = (event: MessageEvent, now = Date.now()): RealUsageSnapshot | null => {
  if (event.source !== window) {
    return null;
  }

  const data = event.data as { type?: unknown; payload?: unknown } | undefined;
  if (!data || data.type !== MESSAGE_TYPES.realUsage) {
    return null;
  }

  const metadata = sanitizeUsageMetadata(data.payload);
  if (!metadata) {
    return null;
  }

  return {
    source: "real",
    capturedAt: now,
    ...metadata,
  };
};
