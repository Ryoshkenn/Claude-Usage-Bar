import { MESSAGE_TYPES } from "../shared/constants";

type JsonObject = Record<string, unknown>;

const usageKeyPattern = /(usage|limit|remaining|reset|model|message|percent|quota)/i;
const unsafeKeyPattern = /(prompt|content|text|body|authorization|cookie|header|token|auth)/i;
const allowedOutputKeys = new Set([
  "modelLabel",
  "resetText",
  "remainingText",
  "remainingMessages",
  "usedMessages",
  "totalMessages",
  "limitText",
  "percentageUsed",
  "sessionResetsAt",
  "weeklyAllModelsPercentageUsed",
  "weeklyAllModelsResetText",
  "weeklyAllModelsResetsAt",
]);

const applyUsageText = (text: string, output: JsonObject) => {
  const percentMatch = text.match(/(\d{1,3})\s*%\s*(?:used|usage|of\s+(?:daily|weekly|session)\s+(?:limit|quota))?/i);
  const remainingPercentMatch = text.match(/(\d{1,3})\s*%\s*(?:remaining|left)/i);
  const remainingOfLimitMatch = text.match(
    /(\d{1,5})\s+(?:messages?|uses?)\s+(?:remaining|left)\D{0,24}(?:of|out of|\/)\D{0,8}(\d{1,5})/i,
  );
  const usedOfLimitMatch = text.match(
    /(\d{1,5})\D{0,8}(?:of|out of|\/)\D{0,8}(\d{1,5})\s+(?:messages?|uses?)?\s*(?:used|usage)?/i,
  );

  if (remainingPercentMatch) {
    output.percentageUsed = 100 - Number(remainingPercentMatch[1]);
  } else if (percentMatch) {
    output.percentageUsed = Number(percentMatch[1]);
  }

  if (remainingOfLimitMatch) {
    output.remainingMessages = Number(remainingOfLimitMatch[1]);
    output.totalMessages = Number(remainingOfLimitMatch[2]);
  } else if (usedOfLimitMatch) {
    output.usedMessages = Number(usedOfLimitMatch[1]);
    output.totalMessages = Number(usedOfLimitMatch[2]);
  }
};

const coerceMetadata = (input: JsonObject): JsonObject => {
  const output: JsonObject = {};
  const now = Date.now();

  const normalizePercentage = (value: number): number | undefined => {
    if (!Number.isFinite(value) || value < 0) {
      return undefined;
    }
    const percentage = value <= 1 ? value * 100 : value;
    return Math.min(100, Math.max(0, Math.round(percentage)));
  };

  const formatTimeUntil = (timestamp: number): string => {
    const diff = Math.max(0, timestamp - now);
    const minutes = Math.ceil(diff / 60_000);
    if (minutes < 60) {
      return `resets ${minutes}m`;
    }
    const hours = Math.ceil(minutes / 60);
    if (hours < 24) {
      return `resets ${hours}h`;
    }
    return `resets ${Math.ceil(hours / 24)}d`;
  };

  const parseResetMetadata = (value: unknown): { resetText: string; resetAtMs: number } | undefined => {
    if (typeof value !== "string" && typeof value !== "number") {
      return undefined;
    }
    const timestamp = typeof value === "number" ? value : new Date(value).getTime();
    return Number.isFinite(timestamp)
      ? { resetText: formatTimeUntil(timestamp), resetAtMs: timestamp }
      : undefined;
  };

  const applyLimit = (value: unknown, pctKey: string, resetKey: string, resetAtKey: string) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return;
    }
    const object = value as JsonObject;
    const utilization =
      object.utilization ??
      object.percent_used ??
      object.percentage_used ??
      object.percentageUsed ??
      object.used_ratio ??
      object.usage;
    const reset = object.resets_at ?? object.resetsAt ?? object.reset_at ?? object.resetAt;
    if (typeof utilization === "number") {
      const percentage = normalizePercentage(utilization);
      if (percentage !== undefined) {
        output[pctKey] = percentage;
      }
    }
    const parsedReset = parseResetMetadata(reset);
    if (parsedReset) {
      output[resetKey] = parsedReset.resetText;
      output[resetAtKey] = parsedReset.resetAtMs;
    }
  };

  applyLimit(input.five_hour, "percentageUsed", "resetText", "sessionResetsAt");
  applyLimit(input.seven_day, "weeklyAllModelsPercentageUsed", "weeklyAllModelsResetText", "weeklyAllModelsResetsAt");

  // The current endpoint also exposes a canonical limits array. Its entries
  // are sibling-scoped by `kind`/`group`, so do not let the generic scanner
  // mistake the weekly entry's reset timestamp for the session reset.
  if (Array.isArray(input.limits)) {
    for (const value of input.limits) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        continue;
      }
      const limit = value as JsonObject;
      const kind = typeof limit.kind === "string" ? limit.kind : "";
      const group = typeof limit.group === "string" ? limit.group : "";
      const percentage = limit.percent ?? limit.utilization;
      const reset = limit.resets_at ?? limit.resetsAt ?? limit.reset_at ?? limit.resetAt;
      const parsedReset = parseResetMetadata(reset);

      if (kind === "session" || group === "session") {
        if (typeof percentage === "number" && Number.isFinite(percentage)) {
          output.percentageUsed = Math.min(100, Math.max(0, Math.round(percentage)));
        }
        if (parsedReset) {
          output.resetText = parsedReset.resetText;
          output.sessionResetsAt = parsedReset.resetAtMs;
        }
      } else if (kind === "weekly_all") {
        if (typeof percentage === "number" && Number.isFinite(percentage)) {
          output.weeklyAllModelsPercentageUsed = Math.min(100, Math.max(0, Math.round(percentage)));
        }
        if (parsedReset) {
          output.weeklyAllModelsResetText = parsedReset.resetText;
          output.weeklyAllModelsResetsAt = parsedReset.resetAtMs;
        }
      }
    }
  }

  const hasStructuredClaudeUsage =
    Array.isArray(input.limits) || input.five_hour !== undefined || input.seven_day !== undefined;

  const isSessionScope = (text: string): boolean =>
    /(5|five).*hour|hour.*limit|five hour|5 hour|five_hour|5_hour/.test(text);
  const isWeeklyScope = (text: string): boolean => /seven day|seven_day|7 day|7_day|weekly/.test(text);

  const visit = (value: unknown, depth: number, path: string[] = []) => {
    if (!value || typeof value !== "object" || depth > 4) {
      return;
    }

    if (Array.isArray(value)) {
      value.slice(0, 10).forEach((item, index) => visit(item, depth + 1, [...path, String(index)]));
      return;
    }

    for (const [key, nested] of Object.entries(value as JsonObject)) {
      if (unsafeKeyPattern.test(key)) {
        continue;
      }

      const normalized = key.toLowerCase();
      const scopedText = [...path, key].join(" ").replace(/[_-]+/g, " ").toLowerCase();
      if (usageKeyPattern.test(key)) {
        if (typeof nested === "number" && Number.isFinite(nested)) {
          if (/remaining/.test(normalized) && /message/.test(normalized)) {
            output.remainingMessages = nested;
          } else if (/(used|usage|consumed|count)/.test(normalized) && /(message|use)/.test(normalized)) {
            output.usedMessages = nested;
          } else if (/(limit|quota|max|total)/.test(normalized) && /(message|use|usage)/.test(normalized)) {
            output.totalMessages = nested;
          } else if (/percent|percentage/.test(normalized)) {
            if (isWeeklyScope(scopedText)) {
              output.weeklyAllModelsPercentageUsed ??= nested;
            } else if (isSessionScope(scopedText)) {
              output.percentageUsed ??= nested;
            } else if (!hasStructuredClaudeUsage) {
              output.percentageUsed = nested;
            }
          } else if (/reset/.test(normalized)) {
            if (isWeeklyScope(scopedText)) {
              output.weeklyAllModelsResetsAt ??= nested;
            } else if (isSessionScope(scopedText)) {
              output.sessionResetsAt ??= nested;
            }
          }
        }

        if (typeof nested === "string" && nested.length <= 160) {
          applyUsageText(nested, output);
          if (/model/.test(normalized)) {
            output.modelLabel = nested;
          } else if (/reset/.test(normalized)) {
            if (isWeeklyScope(scopedText)) {
              output.weeklyAllModelsResetText ??= nested;
            } else if (isSessionScope(scopedText)) {
              output.resetText ??= nested;
            } else if (!hasStructuredClaudeUsage) {
              output.resetText = nested;
            }
          } else if (/remaining/.test(normalized)) {
            output.remainingText = nested;
          } else if (/limit|usage|quota/.test(normalized)) {
            output.limitText = nested;
          }
        }
      }

      visit(nested, depth + 1, [...path, key]);
    }
  };

  visit(input, 0);

  return Object.fromEntries(Object.entries(output).filter(([key]) => allowedOutputKeys.has(key)));
};

const postUsage = (payload: JsonObject) => {
  if (Object.keys(payload).length === 0) {
    return;
  }
  window.postMessage({ type: MESSAGE_TYPES.realUsage, payload }, window.location.origin);
};

const inspectJson = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return;
  }
  postUsage(coerceMetadata(value as JsonObject));
};

const sameOrigin = (input: RequestInfo | URL): boolean => {
  try {
    const url = typeof input === "string" || input instanceof URL ? new URL(input, location.href) : new URL(input.url);
    return url.origin === location.origin;
  } catch {
    return false;
  }
};

const originalFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const response = await originalFetch(...args);
  if (sameOrigin(args[0])) {
    response
      .clone()
      .json()
      .then(inspectJson)
      .catch(() => undefined);
  }
  return response;
};

const OriginalXMLHttpRequest = window.XMLHttpRequest;
window.XMLHttpRequest = class ClaudeUsageXMLHttpRequest extends OriginalXMLHttpRequest {
  private requestUrl = "";

  open(method: string, url: string | URL, async?: boolean, username?: string | null, password?: string | null) {
    this.requestUrl = String(url);
    return super.open(method, url, async ?? true, username ?? null, password ?? null);
  }

  send(body?: Document | XMLHttpRequestBodyInit | null) {
    this.addEventListener("load", () => {
      if (!sameOrigin(this.requestUrl)) {
        return;
      }
      const contentType = this.getResponseHeader("content-type") ?? "";
      if (!contentType.includes("json") || typeof this.responseText !== "string") {
        return;
      }
      try {
        inspectJson(JSON.parse(this.responseText));
      } catch {
        // Ignore non-JSON responses.
      }
    });
    return super.send(body);
  }
};
