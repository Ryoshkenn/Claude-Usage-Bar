import { describe, expect, it } from "vitest";
import { sanitizeUsageMetadata } from "../content/usageProbeBridge";
import { readClaudeDomSnapshot, readSelectedModelLabel } from "../content/claudeDom";
import { extractOrganizationId, normalizeUsagePayload } from "../shared/claudeUsageApi";
import { buildChatUsageFromConversationPayload } from "../shared/claudeConversationContext";
import { applyConservativeTokenBias } from "../shared/tokenBias";
import {
  buildChatUsage,
  deriveDailyIncrement,
  estimateAttachmentTokens,
  estimateCumulativeContextTokens,
  estimateTokensFromText,
  rollDailyUsageForward,
} from "../content/usageEstimator";
import type { DailyUsage } from "../shared/types";

describe("estimateTokensFromText", () => {
  it("handles empty and whitespace text", () => {
    expect(estimateTokensFromText("")).toBe(0);
    expect(estimateTokensFromText("   \n\t ")).toBe(0);
  });

  it("rounds short text up", () => {
    expect(estimateTokensFromText("abc")).toBe(1);
    expect(estimateTokensFromText("abcd")).toBe(2);
    expect(estimateTokensFromText("abcde")).toBe(2);
  });

  it("handles long text", () => {
    expect(estimateTokensFromText("a".repeat(401))).toBe(118);
  });

  it("counts raw length without collapsing whitespace", () => {
    // 16 raw chars (indentation/newlines are real tokens); the old version
    // collapsed the gap and returned 3.
    expect(estimateTokensFromText("hello      world")).toBe(5);
  });
});

describe("applyConservativeTokenBias", () => {
  it("biases positive token counts upward and leaves zero alone", () => {
    expect(applyConservativeTokenBias(0)).toBe(0);
    expect(applyConservativeTokenBias(5)).toBe(6);
    expect(applyConservativeTokenBias(50)).toBe(60);
  });
});

describe("estimateCumulativeContextTokens", () => {
  it("adds each message to the running context before accumulating total usage", () => {
    // Base 15000 + (4 + ceil(11 / 3.4)) per message: (15008) + (15016).
    expect(estimateCumulativeContextTokens(["hello world", "hello world"])).toBe(30024);
  });

  it("uses ordered user and assistant transcript parts", () => {
    const messageTexts = ["Hello how are you", "I'm doing well, thanks for asking!"];
    const chatUsage = buildChatUsage(messageTexts, 123);

    expect(chatUsage.visibleMessageCount).toBe(2);
    expect(chatUsage.updatedAt).toBe(123);
    // 15000 + (4 + 5) + (4 + 10) = 15023, biased to 18028 — and estimatedTokens
    // matches the current window, mirroring the conversation-API path.
    expect(chatUsage.currentContextTokens).toBe(18028);
    expect(chatUsage.estimatedTokens).toBe(chatUsage.currentContextTokens);
  });

  it("reports a true zero for an empty chat", () => {
    const chatUsage = buildChatUsage([], 123);

    expect(chatUsage.currentContextTokens).toBe(0);
    expect(chatUsage.estimatedTokens).toBe(0);
    expect(chatUsage.visibleMessageCount).toBe(0);
  });

  it("stays zero with no messages and no attachments", () => {
    expect(buildChatUsage([], 123, []).currentContextTokens).toBe(0);
  });

  it("stays close to the tokenizer-based API path on mixed content", () => {    const texts = [
      "Can you explain how memoization trades time for space complexity?",
      `function fib(n: number): number {\n  if (n <= 1) return n;\n  return fib(n - 1) + fib(n - 2);\n}`,
      "Each subproblem is solved once and cached: O(n) time, O(n) space.",
      `{"model":"sonnet","max_tokens":4096}`,
    ];
    const dom = buildChatUsage(texts, 1);
    const api = buildChatUsageFromConversationPayload({
      chat_messages: texts.map((text, i) => ({
        uuid: `m-${i}`,
        sender: i % 2 === 0 ? "human" : "assistant",
        parent_message_uuid: i === 0 ? "00000000-0000-4000-8000-000000000000" : `m-${i - 1}`,
        content: [{ type: "text", text }],
      })),
      current_leaf_message_uuid: `m-${texts.length - 1}`,
    }).chatUsage;
    const exact = api.currentContextTokens ?? 0;
    const error = Math.abs((dom.currentContextTokens ?? 0) - exact) / exact;
    expect(error).toBeLessThan(0.15);
  });
});

describe("estimateAttachmentTokens", () => {
  it("prices text files by line count", () => {
    expect(estimateAttachmentTokens({ kind: "txt", lineCount: 67 })).toBe(67 * 30);
  });

  it("prices unsized documents and images near the API path's rates", () => {
    expect(estimateAttachmentTokens({ kind: "pdf" })).toBe(4_600);
    expect(estimateAttachmentTokens({ kind: "png" })).toBe(1_500);
  });

  it("prices images by real pixel dims, per the documented patch formula", () => {
    // Live 952×1269 photo: 34×46 = 1564 patches, under both tier caps.
    expect(estimateAttachmentTokens({ kind: "jpeg", imageWidth: 952, imageHeight: 1269 })).toBe(1_564);
    // Small screenshot: ceil(800/28) × ceil(600/28) = 29×22 = 638.
    expect(estimateAttachmentTokens({ kind: "png", imageWidth: 800, imageHeight: 600 })).toBe(638);
  });

  it("downscales huge images to the model's tier on the DOM path too", () => {
    const standard = estimateAttachmentTokens(
      { kind: "png", imageWidth: 4032, imageHeight: 3024 },
      "standard",
    );
    const high = estimateAttachmentTokens({ kind: "png", imageWidth: 4032, imageHeight: 3024 }, "high");
    expect(standard).toBeLessThanOrEqual(1568);
    expect(high).toBeGreaterThan(standard);
  });

  it("falls back to a small flat allowance for unknown kinds", () => {
    expect(estimateAttachmentTokens({})).toBe(1_000);
    expect(estimateAttachmentTokens({ kind: "zip" })).toBe(1_000);
  });
});

describe("buildChatUsage with attachments", () => {
  it("adds attachment allowances inside the same conservative bias", () => {
    const chatUsage = buildChatUsage(["hi"], 123, [{ fileName: "r.pdf", kind: "pdf" }]);
    const expected = applyConservativeTokenBias(
      15_000 + 4 + estimateTokensFromText("hi") + 4_600,
    );
    expect(chatUsage.currentContextTokens).toBe(expected);
    expect(chatUsage.estimatedTokens).toBe(expected);
    expect(chatUsage.lengthIsEstimate).toBe(true);
  });

  it("counts a txt card by its lines", () => {
    const chatUsage = buildChatUsage(["see attached"], 1, [{ kind: "txt", lineCount: 67 }]);
    const expected = applyConservativeTokenBias(
      15_000 + 4 + estimateTokensFromText("see attached") + 67 * 30,
    );
    expect(chatUsage.currentContextTokens).toBe(expected);
  });

  it("leaves text-only chats unflagged", () => {
    expect(buildChatUsage(["hi"], 1).lengthIsEstimate).toBeUndefined();
  });
});

describe("daily usage counter", () => {
  const previous: DailyUsage = {
    localDate: "2026-05-02",
    messagesUsed: 2,
    lastVisibleSentCount: 2,
    updatedAt: 1,
  };

  it("increments when visible sent count increases", () => {
    const next = rollDailyUsageForward(previous, 4, new Date("2026-05-02T12:00:00"));
    expect(next.messagesUsed).toBe(4);
    expect(next.lastVisibleSentCount).toBe(4);
  });

  it("does not decrement when visible count drops", () => {
    const next = rollDailyUsageForward(previous, 1, new Date("2026-05-02T12:00:00"));
    expect(next.messagesUsed).toBe(2);
    expect(next.lastVisibleSentCount).toBe(1);
  });

  it("resets on local-date change", () => {
    const next = rollDailyUsageForward(previous, 1, new Date("2026-05-03T12:00:00"));
    expect(next.localDate).toBe("2026-05-03");
    expect(next.messagesUsed).toBe(1);
  });

  it("derives the same-day increment from the message delta", () => {
    const next: DailyUsage = { ...previous, messagesUsed: 5, lastVisibleSentCount: 5 };
    expect(deriveDailyIncrement(previous, next)).toBe(3);
  });

  it("counts the full new-day count after a date rollover", () => {
    const next: DailyUsage = { localDate: "2026-05-03", messagesUsed: 2, lastVisibleSentCount: 2, updatedAt: 2 };
    expect(deriveDailyIncrement(previous, next)).toBe(2);
  });

  it("never returns a negative increment", () => {
    const next: DailyUsage = { ...previous, messagesUsed: 1 };
    expect(deriveDailyIncrement(previous, next)).toBe(0);
  });
});

describe("readSelectedModelLabel", () => {
  it("reads the switcher's model, ignoring an open menu that lists every model", () => {
    document.body.innerHTML = `
      <button data-testid="model-selector-dropdown" aria-haspopup="menu">Claude Opus 4.8</button>
      <div role="menu">
        <div role="menuitem">Haiku 4.5</div>
        <div role="menuitem">Sonnet 4.6</div>
        <div role="menuitem">Opus 4.8</div>
      </div>
    `;
    // pageText would surface "Haiku 4.5" first; the switcher must still win.
    expect(readSelectedModelLabel("Haiku 4.5 Sonnet 4.6 Opus 4.8")).toBe("Opus 4.8");
  });

  it("prefers the model-tagged control over an unrelated button", () => {
    document.body.innerHTML = `
      <button>New chat</button>
      <button data-testid="model-selector-dropdown">Sonnet 4.6</button>
    `;
    expect(readSelectedModelLabel("")).toBe("Sonnet 4.6");
  });

  it("falls back to page text only when no control matches", () => {
    document.body.innerHTML = `<button>New chat</button>`;
    expect(readSelectedModelLabel("Using Haiku 4.5 today")).toBe("Haiku 4.5");
    expect(readSelectedModelLabel("no model here")).toBeUndefined();
  });

  it("detects Fable labels in the switcher and page text", () => {
    document.body.innerHTML = `
      <button data-testid="model-selector-dropdown">Fable 5.1</button>
    `;
    expect(readSelectedModelLabel("")).toBe("Fable 5.1");
    document.body.innerHTML = `<button>New chat</button>`;
    expect(readSelectedModelLabel("Using Fable 5.1 today")).toBe("Fable 5.1");
  });
});

describe("Claude transcript reader", () => {
  it("counts tokens from conversation message text without action chrome", () => {
    document.body.innerHTML = `
      <div class="flex-1 flex flex-col px-4 max-w-3xl mx-auto w-full pt-1">
        <div data-test-render-count="2">
          <h2 class="sr-only">You said: Hello how are you</h2>
          <div data-testid="user-message" class="font-large !font-user-message">
            <p class="whitespace-pre-wrap break-words">Hello how are you</p>
          </div>
          <div role="group" aria-label="Message actions">
            <button aria-label="Copy">Copy</button>
            <button aria-label="Edit">Edit</button>
          </div>
        </div>
        <div data-test-render-count="2">
          <h2 class="sr-only">Claude responded: Hidden duplicate</h2>
          <div class="font-claude-response">
            <div class="standard-markdown">
              <p class="font-claude-response-body">I'm doing well, thanks for asking!</p>
            </div>
          </div>
          <div role="group" aria-label="Message actions">
            <button aria-label="Copy">Copy</button>
          </div>
        </div>
      </div>
    `;

    const snapshot = readClaudeDomSnapshot();

    expect(snapshot.visibleSentCount).toBe(1);
    expect(snapshot.visibleMessageCount).toBe(2);
    expect(snapshot.visibleMessageTexts).toEqual(["Hello how are you", "I'm doing well, thanks for asking!"]);
    expect(snapshot.visibleText).toBe("Hello how are you\n\nI'm doing well, thanks for asking!");
    expect(snapshot.visibleText).not.toContain("Copy");
    expect(snapshot.visibleText).not.toContain("Hidden duplicate");
  });

  it("keeps arbitrary assistant text such as code, tables, lists, and diagram labels", () => {
    document.body.innerHTML = `
      <div class="flex-1 flex flex-col px-4 max-w-3xl mx-auto w-full pt-1">
        <div data-testid="user-message">
          <p>Make a diagram and table</p>
        </div>
        <div class="font-claude-response">
          <div class="standard-markdown">
            <h3>Plan</h3>
            <ul><li>Collect text</li><li>Ignore controls</li></ul>
            <pre><code>const answer = 42;</code></pre>
            <table><tbody><tr><td>Name</td><td>Value</td></tr></tbody></table>
            <svg><text>Diagram node A</text><text>Diagram node B</text></svg>
          </div>
          <div role="group" aria-label="Message actions"><button>Copy</button></div>
        </div>
      </div>
    `;

    const snapshot = readClaudeDomSnapshot();

    expect(snapshot.visibleText).toContain("Make a diagram and table");
    expect(snapshot.visibleText).toContain("Plan");
    expect(snapshot.visibleText).toContain("Collect text");
    expect(snapshot.visibleText).toContain("const answer = 42;");
    expect(snapshot.visibleText).toContain("Name");
    expect(snapshot.visibleText).toContain("Value");
    expect(snapshot.visibleText).toContain("Diagram node A");
    expect(snapshot.visibleText).toContain("Diagram node B");
    expect(snapshot.visibleText).not.toContain("Copy");
  });
});

describe("real usage sanitizer", () => {
  it("accepts allowlisted usage metadata", () => {
    expect(
      sanitizeUsageMetadata({
        remainingText: "10 messages left",
        resetText: "Reset in 2h",
        remainingMessages: 10,
        percentageUsed: 60,
      }),
    ).toEqual({
      remainingText: "10 messages left",
      resetText: "Reset in 2h",
      remainingMessages: 10,
      percentageUsed: 60,
    });
  });

  it("rejects unsafe private fields", () => {
    expect(sanitizeUsageMetadata({ remainingText: "10 left", content: "private response" })).toBeNull();
    expect(sanitizeUsageMetadata({ headers: { authorization: "secret" } })).toBeNull();
  });
});

describe("Claude usage API helpers", () => {
  it("extracts an organization uuid from nested API payloads", () => {
    expect(
      extractOrganizationId({
        organizations: [
          {
            name: "Personal",
            uuid: "123e4567-e89b-12d3-a456-426614174000",
          },
        ],
      }),
    ).toBe("123e4567-e89b-12d3-a456-426614174000");
  });

  it("normalizes usage API metadata without storing raw payloads", () => {
    expect(
      normalizeUsagePayload(
        {
          five_hour: { utilization: 4, resets_at: "2026-05-03T08:00:00.000Z" },
          seven_day: { utilization: 60, resets_at: "2026-05-04T00:00:00.000Z" },
        },
        new Date("2026-05-03T05:00:00.000Z").getTime(),
      ),
    ).toEqual({
      source: "real",
      capturedAt: new Date("2026-05-03T05:00:00.000Z").getTime(),
      percentageUsed: 4,
      resetText: "resets in 3h",
      sessionResetsAt: new Date("2026-05-03T08:00:00.000Z").getTime(),
      weeklyAllModelsPercentageUsed: 60,
      weeklyAllModelsResetText: "resets in 19h",
      weeklyAllModelsResetsAt: new Date("2026-05-04T00:00:00.000Z").getTime(),
    });
  });

  it("formats API reset timestamps with hours and minutes", () => {
    expect(
      normalizeUsagePayload(
        {
          five_hour: { utilization: 4, resets_at: "2026-05-03T07:45:00.000Z" },
        },
        new Date("2026-05-03T05:00:00.000Z").getTime(),
      )?.resetText,
    ).toBe("resets in 2h 45m");
  });

  it("normalizes raw ISO reset strings from page-probe metadata", () => {
    expect(
      sanitizeUsageMetadata(
        {
          resetText: "2026-06-09T05:00:00.332761+00:00",
        },
        new Date("2026-06-09T02:15:00.332Z").getTime(),
      ),
    ).toEqual({
      resetText: "resets in 2h 45m",
      sessionResetsAt: new Date("2026-06-09T05:00:00.332761+00:00").getTime(),
    });
  });

  it("handles ratio percentages from API payloads", () => {
    expect(
      normalizeUsagePayload(
        {
          usage: {
            weekly: {
              all_models: { used_ratio: 0.6 },
            },
          },
        },
        123,
      )?.weeklyAllModelsPercentageUsed,
    ).toBe(60);
  });

  it("treats utilization as a percent so a real 1% is not shown as 100%", () => {
    expect(
      normalizeUsagePayload(
        { five_hour: { utilization: 1, resets_at: "2026-05-03T08:00:00.000Z" } },
        new Date("2026-05-03T05:00:00.000Z").getTime(),
      )?.percentageUsed,
    ).toBe(1);
  });

  it("parses the modern limits array, preferring it over legacy keys", () => {
    const now = new Date("2026-06-21T12:00:00.000Z").getTime();
    const snapshot = normalizeUsagePayload(
      {
        // Stale legacy key must be ignored when the canonical limits array exists.
        five_hour: { utilization: 99, resets_at: "2026-06-21T13:00:00.000Z" },
        limits: [
          { kind: "session", group: "session", percent: 2, resets_at: "2026-06-21T13:00:00.000Z", scope: null },
          { kind: "weekly_all", group: "weekly", percent: 30, resets_at: "2026-06-23T05:00:00.000Z", scope: null },
          {
            kind: "weekly_scoped",
            group: "weekly",
            percent: 3,
            resets_at: "2026-06-23T05:00:00.000Z",
            scope: { model: { id: null, display_name: "Sonnet" } },
          },
        ],
      },
      now,
    );
    expect(snapshot?.percentageUsed).toBe(2);
    expect(snapshot?.sessionResetsAt).toBe(new Date("2026-06-21T13:00:00.000Z").getTime());
    expect(snapshot?.weeklyAllModelsPercentageUsed).toBe(30);
    expect(snapshot?.weeklyScopedLimits).toEqual([
      {
        modelLabel: "Sonnet",
        percentageUsed: 3,
        resetsAt: new Date("2026-06-23T05:00:00.000Z").getTime(),
        resetText: expect.any(String),
      },
    ]);
  });

  it("reads legacy per-model weekly keys when no limits array is present", () => {
    const snapshot = normalizeUsagePayload(
      {
        five_hour: { utilization: 5, resets_at: "2026-06-21T13:00:00.000Z" },
        seven_day: { utilization: 30, resets_at: "2026-06-23T05:00:00.000Z" },
        seven_day_sonnet: { utilization: 3, resets_at: "2026-06-23T05:00:00.000Z" },
        seven_day_opus: null,
      },
      new Date("2026-06-21T12:00:00.000Z").getTime(),
    );
    expect(snapshot?.weeklyScopedLimits).toEqual([
      {
        modelLabel: "Sonnet",
        percentageUsed: 3,
        resetsAt: new Date("2026-06-23T05:00:00.000Z").getTime(),
        resetText: expect.any(String),
      },
    ]);
  });
});
