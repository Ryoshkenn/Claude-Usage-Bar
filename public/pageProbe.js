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

  const coerceMetadata = (input) => {
    const output = {};

    const visit = (value, depth) => {
      if (!value || typeof value !== "object" || depth > 4) {
        return;
      }

      if (Array.isArray(value)) {
        value.slice(0, 10).forEach((item) => visit(item, depth + 1));
        return;
      }

      Object.entries(value).forEach(([key, nested]) => {
        if (unsafeKeyPattern.test(key)) {
          return;
        }

        const normalized = key.toLowerCase();
        if (usageKeyPattern.test(key)) {
          if (typeof nested === "number" && Number.isFinite(nested)) {
            if (/remaining/.test(normalized) && /message/.test(normalized)) {
              output.remainingMessages = nested;
            } else if (/(used|usage|consumed|count)/.test(normalized) && /(message|use)/.test(normalized)) {
              output.usedMessages = nested;
            } else if (/(limit|quota|max|total)/.test(normalized) && /(message|use|usage)/.test(normalized)) {
              output.totalMessages = nested;
            } else if (/percent|percentage/.test(normalized)) {
              output.percentageUsed = nested;
            }
          }

          if (typeof nested === "string" && nested.length <= 160) {
            applyUsageText(nested, output);
            if (/model/.test(normalized)) {
              output.modelLabel = nested;
            } else if (/reset/.test(normalized)) {
              output.resetText = nested;
            } else if (/remaining/.test(normalized)) {
              output.remainingText = nested;
            } else if (/limit|usage|quota/.test(normalized)) {
              output.limitText = nested;
            }
          }
        }

        visit(nested, depth + 1);
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
    open(method, url, async, username, password) {
      this.requestUrl = String(url);
      return super.open(method, url, async ?? true, username ?? null, password ?? null);
    }

    send(body) {
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
})();
