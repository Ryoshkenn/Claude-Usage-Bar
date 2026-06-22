import { describe, expect, it } from "vitest";
import { sanitizeUsageMetadata } from "../content/usageProbeBridge";
import { readClaudeDomSnapshot, readSelectedModelLabel } from "../content/claudeDom";
import { extractOrganizationId, normalizeUsagePayload } from "../shared/claudeUsageApi";
import { applyConservativeTokenBias } from "../shared/tokenBias";
import {
  buildChatUsage,
  deriveDailyIncrement,
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
    expect(estimateTokensFromText("abcd")).toBe(1);
    expect(estimateTokensFromText("abcde")).toBe(2);
  });

  it("handles long text", () => {
    expect(estimateTokensFromText("a".repeat(401))).toBe(101);
  });

  it("uses the lightweight fallback heuristic for visible text", () => {
    expect(estimateTokensFromText("hello      world")).toBe(3);
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
    expect(estimateCumulativeContextTokens(["hello world", "hello world"])).toBe(9);
  });

  it("uses ordered user and assistant transcript parts", () => {
    const messageTexts = ["Hello how are you", "I'm doing well, thanks for asking!"];
    const exactTokens = estimateCumulativeContextTokens(messageTexts);
    const chatUsage = buildChatUsage(messageTexts, 123);

    expect(chatUsage.visibleMessageCount).toBe(2);
    expect(chatUsage.updatedAt).toBe(123);
    expect(chatUsage.estimatedTokens).toBe(applyConservativeTokenBias(exactTokens));
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
});
