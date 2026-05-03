# Conservative Token/Context Bias Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the token and context window statistics intentionally conservative by biasing estimated counts upward without touching Claude's real usage snapshot.

**Architecture:** Keep Claude conversation API reconstruction as the best available source of truth. Add a small bias layer only to locally estimated token totals, especially the DOM fallback path, so the ring reads a little fuller than the exact midpoint. Preserve the current UI contract by continuing to populate `estimatedTokens` and `currentContextTokens` from the shared usage builders.

**Tech Stack:** TypeScript, React, Vitest, Manifest V3 extension runtime, Claude tokenizer helper.

---

### Task 1: Add a conservative token bias helper

**Files:**
- Modify: `src/content/usageEstimator.ts`
- Modify: `src/shared/claudeConversationContext.ts`
- Test: `src/test/usageEstimator.test.ts`
- Test: `src/test/claudeConversationContext.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("biases the local DOM estimate upward without changing empty text", () => {
  expect(estimateConservativeTokens("hello world")).toBe(3);
  expect(estimateConservativeTokens("")).toBe(0);
});

it("biases the DOM chat usage estimate upward", () => {
  const chatUsage = buildChatUsage(["hello world", "second message"], 123);
  expect(chatUsage.estimatedTokens).toBeGreaterThan(estimateCumulativeContextTokens(["hello world", "second message"]));
});

it("biases the conversation-api context estimate upward", () => {
  const result = buildChatUsageFromConversationPayload({
    current_leaf_message_uuid: "a1",
    chat_messages: [
      {
        uuid: "u1",
        parent_message_uuid: "00000000-0000-4000-8000-000000000000",
        sender: "human",
        created_at: "2026-05-03T10:00:00.000Z",
        content: [{ text: "hello" }],
      },
      {
        uuid: "a1",
        parent_message_uuid: "u1",
        sender: "assistant",
        created_at: "2026-05-03T10:01:00.000Z",
        content: [{ text: "world" }],
      },
    ],
  });

  expect(result.chatUsage.currentContextTokens).toBeGreaterThan(estimateCumulativeContextTokens(["hello", "world"]));
});
```

- [ ] **Step 2: Run the targeted tests and confirm they fail**

Run: `npm test -- src/test/usageEstimator.test.ts src/test/claudeConversationContext.test.ts`

Expected: failures showing the new conservative helper and biased totals are not implemented yet.

- [ ] **Step 3: Implement the minimal bias layer**

```ts
const CONSERVATIVE_TOKEN_BIAS = 1.15;

export const estimateConservativeTokens = (text: string): number => {
  const estimated = estimateTokensFromText(text);
  return estimated === 0 ? 0 : Math.max(1, Math.ceil(estimated * CONSERVATIVE_TOKEN_BIAS));
};
```

Apply the helper to the DOM path in `buildChatUsage`, and to the conversation payload path when populating `estimatedTokens` and `currentContextTokens`, while leaving `compoundedInputTokens` unchanged.

- [ ] **Step 4: Run the targeted tests and confirm they pass**

Run: `npm test -- src/test/usageEstimator.test.ts src/test/claudeConversationContext.test.ts`

Expected: both suites pass and the biased counts remain stable on empty input.

- [ ] **Step 5: Commit**

```bash
git add src/content/usageEstimator.ts src/shared/claudeConversationContext.ts src/test/usageEstimator.test.ts src/test/claudeConversationContext.test.ts docs/superpowers/plans/2026-05-03-conservative-token-context-bias.md
git commit -m "feat: bias token estimates conservatively"
```

