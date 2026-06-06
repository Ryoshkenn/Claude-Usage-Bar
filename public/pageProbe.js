(() => {
  const messageType = "CLAUDE_USAGE_BAR_REAL_USAGE";
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
    "routinesText",
  ]);

  const applyUsageText = (text, output) => {
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

  const normalizePercentage = (value) => {
    if (!Number.isFinite(value) || value < 0) return undefined;
    const pct = value <= 1 ? value * 100 : value;
    return Math.min(100, Math.max(0, Math.round(pct)));
  };

  const formatTimeUntil = (timestamp, now) => {
    const diff = Math.max(0, timestamp - now);
    const minutes = Math.ceil(diff / 60000);
    if (minutes < 60) return `resets ${minutes}m`;
    const hours = Math.ceil(minutes / 60);
    if (hours < 24) return `resets ${hours}h`;
    return `resets ${Math.ceil(hours / 24)}d`;
  };

  const parseResetMetadata = (value, now) => {
    if (typeof value !== "string" && typeof value !== "number") return undefined;
    const ts = typeof value === "number" ? value : new Date(value).getTime();
    return Number.isFinite(ts) ? { resetText: formatTimeUntil(ts, now), resetAtMs: ts } : undefined;
  };

  const applyKnownClaudeSchema = (input, output) => {
    if (!input || typeof input !== "object" || Array.isArray(input)) return;
    const now = Date.now();

    const applyLimit = (obj, pctKey, resetKey, resetAtKey) => {
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return;
      const utilization = obj.utilization ?? obj.percent_used ?? obj.percentage_used ?? obj.percentageUsed ?? obj.used_ratio ?? obj.usage;
      const reset = obj.resets_at ?? obj.resetsAt ?? obj.reset_at ?? obj.resetAt;
      if (typeof utilization === "number") {
        const pct = normalizePercentage(utilization);
        if (pct !== undefined) output[pctKey] = pct;
      }
      if (resetKey) {
        const parsedReset = parseResetMetadata(reset, now);
        if (parsedReset) {
          output[resetKey] = parsedReset.resetText;
          if (resetAtKey) output[resetAtKey] = parsedReset.resetAtMs;
        }
      }
    };

    applyLimit(input.five_hour, "percentageUsed", "resetText", "sessionResetsAt");
    applyLimit(input.seven_day, "weeklyAllModelsPercentageUsed", "weeklyAllModelsResetText", "weeklyAllModelsResetsAt");

    const routines = input.routines ?? input.routine_usage ?? input.routineUsage;
    if (routines && typeof routines === "object" && !Array.isArray(routines)) {
      const used = routines.used ?? routines.current ?? routines.count;
      const limit = routines.limit ?? routines.max ?? routines.total ?? routines.allowed;
      if (typeof used === "number" && typeof limit === "number") {
        output.routinesText = `${used} / ${limit}`;
      }
    }
  };

  const coerceMetadata = (input) => {
    const output = {};

    // Apply known Claude usage API schema first (handles structured /usage responses).
    applyKnownClaudeSchema(input, output);

    const isSessionScope = (text) => /(5|five).*hour|hour.*limit|five hour|5 hour|five_hour|5_hour/.test(text);
    const isWeeklyScope = (text) => /seven day|seven_day|7 day|7_day|weekly/.test(text);

    const visit = (value, depth, path = []) => {
      if (!value || typeof value !== "object" || depth > 4) {
        return;
      }

      if (Array.isArray(value)) {
        value.slice(0, 10).forEach((item, index) => visit(item, depth + 1, [...path, String(index)]));
        return;
      }

      Object.entries(value).forEach(([key, nested]) => {
        if (unsafeKeyPattern.test(key)) {
          return;
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
              } else {
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
              } else {
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
      });
    };

    visit(input, 0);
    return Object.fromEntries(Object.entries(output).filter(([key]) => allowedOutputKeys.has(key)));
  };

  const postUsage = (payload) => {
    if (Object.keys(payload).length > 0) {
      window.postMessage({ type: messageType, payload }, window.location.origin);
    }
  };

  const inspectJson = (value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      postUsage(coerceMetadata(value));
    }
  };

  const sameOrigin = (input) => {
    try {
      const url = typeof input === "string" || input instanceof URL ? new URL(input, location.href) : new URL(input.url);
      return url.origin === location.origin;
    } catch {
      return false;
    }
  };

  // Only inspect responses from the usage endpoint to avoid false positives from chat API calls.
  const isUsageEndpoint = (input) => {
    try {
      const url = typeof input === "string" || input instanceof URL ? new URL(input, location.href) : new URL(input.url);
      return /\/api\/organizations\/[^/]+\/usage(\?|$)/.test(url.pathname + url.search);
    } catch {
      return false;
    }
  };

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    if (sameOrigin(args[0]) && isUsageEndpoint(args[0])) {
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
    open(method, url, async, username, password) {
      this.requestUrl = String(url);
      return super.open(method, url, async ?? true, username ?? null, password ?? null);
    }

    send(body) {
      this.addEventListener("load", () => {
        if (!sameOrigin(this.requestUrl) || !isUsageEndpoint(this.requestUrl)) {
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
})();
