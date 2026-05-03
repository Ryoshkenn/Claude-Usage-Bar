import { describe, expect, it } from "vitest";
import { sanitizeUsageMetadata } from "../content/usageProbeBridge";
import { readClaudeDomSnapshot } from "../content/claudeDom";
import { extractOrganizationId, normalizeUsagePayload } from "../shared/claudeUsageApi";
import {
  buildChatUsage,
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

  it("normalizes whitespace before counting", () => {
    expect(estimateTokensFromText("hello      world")).toBe(3);
  });
});

describe("estimateCumulativeContextTokens", () => {
  it("adds each message to the running context before accumulating total usage", () => {
    expect(estimateCumulativeContextTokens(["a".repeat(1200), "b".repeat(2400)])).toBe(1200);
  });

  it("uses ordered user and assistant transcript parts", () => {
    const chatUsage = buildChatUsage(["abcd", "abcdefgh", "abcdefghijkl"], 123);

    expect(chatUsage.visibleMessageCount).toBe(3);
    expect(chatUsage.updatedAt).toBe(123);
    expect(chatUsage.estimatedTokens).toBe(10);
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
          weekly_claude_design: { utilization: 9, resets_at: "2026-05-04T00:00:00.000Z" },
          routines: { used: 0, limit: 5 },
        },
        new Date("2026-05-03T05:00:00.000Z").getTime(),
      ),
    ).toEqual({
      source: "real",
      capturedAt: new Date("2026-05-03T05:00:00.000Z").getTime(),
      percentageUsed: 4,
      resetText: "resets 3h",
      weeklyAllModelsPercentageUsed: 60,
      weeklyAllModelsResetText: "resets 19h",
      claudeDesignPercentageUsed: 9,
      claudeDesignResetText: "resets 19h",
      routinesText: "0 / 5",
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
