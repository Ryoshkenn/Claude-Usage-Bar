import { MESSAGE_TYPES } from "../shared/constants";
import { parseResetMetadata } from "../shared/claudeUsageApi";
import type { RealUsageSnapshot, UsageMetadata } from "../shared/types";

const allowedStringKeys = new Set([
  "modelLabel",
  "thinkingLevel",
  "resetText",
  "remainingText",
  "limitText",
  "weeklyAllModelsResetText",
  "routinesText",
]);
const allowedNumberKeys = new Set([
  "remainingMessages",
  "usedMessages",
  "totalMessages",
  "percentageUsed",
  "sessionResetsAt",
  "weeklyAllModelsPercentageUsed",
  "weeklyAllModelsResetsAt",
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

export const sanitizeUsageMetadata = (payload: unknown, now = Date.now()): UsageMetadata | null => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const input = payload as Record<string, unknown>;
  const output: UsageMetadata = {};

  for (const [key, value] of Object.entries(input)) {
    if (unsafeKeys.has(key.toLowerCase())) {
      return null;
    }

    if (
      (key === "resetText" || key === "weeklyAllModelsResetText") &&
      typeof value === "string" &&
      value.length <= 160
    ) {
      const reset = parseResetMetadata(value, now);
      if (reset.resetText && reset.resetAtMs) {
        if (key === "resetText") {
          output.resetText = reset.resetText;
          output.sessionResetsAt = reset.resetAtMs;
        } else {
          output.weeklyAllModelsResetText = reset.resetText;
          output.weeklyAllModelsResetsAt = reset.resetAtMs;
        }
        continue;
      }
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

  const metadata = sanitizeUsageMetadata(data.payload, now);
  if (!metadata) {
    return null;
  }

  return {
    source: "real",
    capturedAt: now,
    ...metadata,
  };
};
