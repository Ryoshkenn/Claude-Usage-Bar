import { describe, expect, it, vi } from "vitest";
import {
  buildChatUsageFromConversationPayload,
  calculateCompoundedInputTokens,
} from "../shared/claudeConversationContext";
import { applyConservativeTokenBias } from "../shared/tokenBias";
import { countClaudeTokens } from "../shared/claudeTokenizer";

describe("buildChatUsageFromConversationPayload", () => {
  it("counts the active conversation branch from Claude JSON", () => {
    const helloTokens = countClaudeTokens("hello");
    const assistantTokens = countClaudeTokens("assistant answer");
    const followUpTokens = countClaudeTokens("follow up");
    const exactCurrentContextTokens =
      15_000 + (4 + helloTokens) + (4 + assistantTokens) + (4 + followUpTokens);
    const result = buildChatUsageFromConversationPayload(
      {
        current_leaf_message_uuid: "a2",
        settings: {},
        chat_messages: [
          {
            uuid: "fork",
            parent_message_uuid: "u1",
            sender: "assistant",
            created_at: "2026-05-03T10:02:00.000Z",
            content: [{ text: "unused branch" }],
          },
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
            content: [{ text: "assistant answer" }],
          },
          {
            uuid: "a2",
            parent_message_uuid: "a1",
            sender: "human",
            created_at: "2026-05-03T10:03:00.000Z",
            content: [{ text: "follow up" }],
          },
        ],
      },
      123,
    );

    expect(result.chatUsage.visibleMessageCount).toBe(3);
    expect(result.chatUsage.updatedAt).toBe(123);
    expect(result.debugTexts).toEqual(["hello", "assistant answer", "follow up"]);
    expect(result.chatUsage.currentContextTokens).toBe(applyConservativeTokenBias(exactCurrentContextTokens));
    expect(result.chatUsage.estimatedTokens).toBe(result.chatUsage.currentContextTokens);
    expect(result.chatUsage.compoundedInputTokens).toBeGreaterThan(0);
  });

  it("does not inflate tiny chats from enabled global settings alone", () => {
    const result = buildChatUsageFromConversationPayload({
      current_leaf_message_uuid: "a1",
      settings: {
        enabled_web_search: true,
        enabled_saffron: true,
        enabled_monkeys_in_a_barrel: true,
      },
      chat_messages: [
        {
          uuid: "u1",
          parent_message_uuid: "00000000-0000-4000-8000-000000000000",
          sender: "human",
          created_at: "2026-05-03T10:00:00.000Z",
          content: [{ text: "hi" }],
        },
        {
          uuid: "a1",
          parent_message_uuid: "u1",
          sender: "assistant",
          created_at: "2026-05-03T10:00:02.000Z",
          content: [{ text: "hi" }],
        },
      ],
    });

    expect(result.chatUsage.currentContextTokens).toBe(applyConservativeTokenBias(15_000 + (4 + countClaudeTokens("hi")) + (4 + countClaudeTokens("hi"))));
    expect(result.chatUsage.estimatedTokens).toBe(result.chatUsage.currentContextTokens);
    expect(result.chatUsage.compoundedInputTokens).toBeLessThanOrEqual(result.chatUsage.estimatedTokens);
  });

  it("counts attachments, files, sync sources, and tool inputs from concrete JSON evidence", () => {
    const result = buildChatUsageFromConversationPayload({
      current_leaf_message_uuid: "u1",
      settings: {
        enabled_web_search: true,
        enabled_saffron: true,
      },
      chat_messages: [
        {
          uuid: "u1",
          parent_message_uuid: "00000000-0000-4000-8000-000000000000",
          sender: "human",
          created_at: "2026-05-03T10:00:00.000Z",
          content: [{ text: "search this", input: { q: "claude" } }],
          attachments: [{ extracted_content: "attachment text" }],
          files_v2: [
            { file_kind: "image", preview_asset: { image_width: 700, image_height: 700 } },
            { file_kind: "document", document_asset: { page_count: 2 } },
          ],
          sync_sources: [{ status: { current_size_bytes: 370 } }],
        },
      ],
    });

    expect(result.lengthIsEstimate).toBe(true);
    expect(result.debugTexts).toEqual(["search this", "{\"q\":\"claude\"}", "attachment text"]);
    expect(result.chatUsage.currentContextTokens).toBeGreaterThan(20_000);
    expect(result.chatUsage.currentContextTokens).toBeLessThan(27_000);
    expect(result.chatUsage.estimatedTokens).toBe(result.chatUsage.currentContextTokens);
  });

  it("compounds input when user prompts add the chat back into context", () => {
    expect(
      calculateCompoundedInputTokens(
        [
          { sender: "human", tokens: 10 },
          { sender: "assistant", tokens: 20 },
          { sender: "human", tokens: 30 },
        ],
        0,
      ),
    ).toBe(10 + 60);
  });

  it("also compounds at assistant tool-call turns since each tool call triggers another full-context inference", () => {
    // H(10) → A_tool(20) → H_result(30) → A_final(40)
    // Compound at H(10): running = 10
    // Compound at A_tool(20) [hasToolUse]: running = 10 + 20 = 30
    // Compound at H_result(30): running = 30 + 30 = 60
    // A_final: no compound
    expect(
      calculateCompoundedInputTokens(
        [
          { sender: "human", tokens: 10 },
          { sender: "assistant", tokens: 20, hasToolUse: true },
          { sender: "human", tokens: 30 },
          { sender: "assistant", tokens: 40, hasToolUse: false },
        ],
        0,
      ),
    ).toBe(10 + 30 + 60);
  });

  it("reports prompt-cache prefix metadata without discounting context length", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-03T10:04:00.000Z"));

    const result = buildChatUsageFromConversationPayload({
      current_leaf_message_uuid: "a2",
      settings: {},
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
          content: [{ text: "first assistant" }],
        },
        {
          uuid: "u2",
          parent_message_uuid: "a1",
          sender: "human",
          created_at: "2026-05-03T10:02:00.000Z",
          content: [{ text: "next" }],
        },
        {
          uuid: "a2",
          parent_message_uuid: "u2",
          sender: "assistant",
          created_at: "2026-05-03T10:03:00.000Z",
          content: [{ text: "latest assistant" }],
        },
      ],
    });

    expect(result.cachedPrefixTokens).toBeGreaterThan(0);
    expect(result.cacheExpiresAt).toBe(new Date("2026-05-03T10:08:00.000Z").getTime());
    expect(result.chatUsage.estimatedTokens).toBe(result.chatUsage.currentContextTokens);
    vi.useRealTimers();
  });
});

describe("context breakdown", () => {
  const buildMixedConversation = () =>
    buildChatUsageFromConversationPayload({
      current_leaf_message_uuid: "a1",
      project_uuid: "p1",
      project: { knowledge_size: 2_500 },
      chat_messages: [
        {
          uuid: "u1",
          parent_message_uuid: "00000000-0000-4000-8000-000000000000",
          sender: "human",
          created_at: "2026-05-03T10:00:00.000Z",
          content: [{ type: "text", text: "please search the docs for me" }],
          attachments: [{ extracted_content: "attached notes" }],
        },
        {
          uuid: "a1",
          parent_message_uuid: "u1",
          sender: "assistant",
          created_at: "2026-05-03T10:00:02.000Z",
          content: [
            { type: "thinking", thinking: "I should search for this first" },
            { type: "text", text: "Here is what I found." },
            { type: "tool_use", name: "web_search", input: { query: "claude docs" } },
            { type: "tool_result", content: [{ type: "text", text: "a long search result body" }] },
          ],
        },
      ],
    });

  it("attributes tokens to the content type that put them in the window", () => {
    const { entries } = buildMixedConversation().chatUsage.contextBreakdown!;

    expect(entries.userMessages.tokens).toBeGreaterThan(0);
    expect(entries.assistantMessages.tokens).toBeGreaterThan(0);
    expect(entries.thinking.tokens).toBeGreaterThan(0);
    expect(entries.toolCalls.tokens).toBeGreaterThan(0);
    expect(entries.toolResults.tokens).toBeGreaterThan(0);
    expect(entries.attachments.tokens).toBeGreaterThan(0);
    expect(entries.projectKnowledge.tokens).toBeGreaterThan(0);
    expect(entries.overhead.tokens).toBeGreaterThan(0);
  });

  it("keeps tool_result text out of the assistant's own reply total", () => {
    const withResult = buildMixedConversation().chatUsage.contextBreakdown!;
    const withoutResult = buildChatUsageFromConversationPayload({
      current_leaf_message_uuid: "a1",
      chat_messages: [
        {
          uuid: "a1",
          parent_message_uuid: "00000000-0000-4000-8000-000000000000",
          sender: "assistant",
          created_at: "2026-05-03T10:00:02.000Z",
          content: [{ type: "text", text: "Here is what I found." }],
        },
      ],
    }).chatUsage.contextBreakdown!;

    // The nested search-result text must land in toolResults, so the assistant's
    // reply costs the same whether or not a tool_result rides along with it.
    expect(withResult.entries.assistantMessages.tokens).toBe(
      withoutResult.entries.assistantMessages.tokens,
    );
  });

  it("counts items per category", () => {
    const { entries } = buildMixedConversation().chatUsage.contextBreakdown!;

    expect(entries.userMessages.count).toBe(1);
    expect(entries.assistantMessages.count).toBe(1);
    expect(entries.thinking.count).toBe(1);
    expect(entries.toolCalls.count).toBe(1);
    expect(entries.toolResults.count).toBe(1);
    expect(entries.attachments.count).toBe(1);
    expect(entries.projectKnowledge.count).toBe(1);
  });

  it("sums to the headline context number so the panel reconciles with the ring", () => {
    const { chatUsage } = buildMixedConversation();
    const breakdown = chatUsage.contextBreakdown!;
    const summed = Object.values(breakdown.entries).reduce((acc, entry) => acc + entry.tokens, 0);

    expect(summed).toBe(breakdown.totalTokens);
    expect(breakdown.totalTokens).toBe(chatUsage.currentContextTokens);
  });

  it("reports a true zero for an empty conversation", () => {
    const result = buildChatUsageFromConversationPayload({ chat_messages: [] });

    expect(result.chatUsage.currentContextTokens).toBe(0);
    expect(result.chatUsage.estimatedTokens).toBe(0);
    expect(result.chatUsage.visibleMessageCount).toBe(0);
    expect(result.chatUsage.contextBreakdown?.totalTokens).toBe(0);
  });

  it("counts v1 files[] images by their preview dims (live shape)", () => {
    // The attached photo arrives under `files`, not `files_v2` — parsing only
    // files_v2 priced this chat's image at zero.
    const build = (extra: object) =>
      buildChatUsageFromConversationPayload({
        model: "claude-opus-5",
        current_leaf_message_uuid: "u1",
        chat_messages: [
          {
            uuid: "u1",
            parent_message_uuid: "00000000-0000-4000-8000-000000000000",
            sender: "human",
            created_at: "2026-05-03T10:00:00.000Z",
            content: [{ text: "hi" }],
            ...extra,
          },
        ],
      });
    const without = build({}).chatUsage;
    const withImage = build({
      files: [
        {
          file_kind: "image",
          file_name: "IMG_2198.jpeg",
          preview_asset: { image_width: 952, image_height: 1269 },
        },
      ],
    }).chatUsage;

    expect(withImage.contextBreakdown?.entries.attachments.count).toBe(1);
    expect(withImage.contextBreakdown?.entries.attachments.tokens).toBeGreaterThan(
      without.contextBreakdown?.entries.attachments.tokens ?? 0,
    );
    // 952×1269 → 34×46 = 1564 patches; the headline number must grow by the
    // biased image cost.
    const expected = applyConservativeTokenBias(
      15_000 + 4 + countClaudeTokens("hi") + 1564,
    );
    expect(withImage.currentContextTokens).toBe(expected);
  });

  it("counts thinking summaries as thinking tokens", () => {
    const { entries } = buildChatUsageFromConversationPayload({
      current_leaf_message_uuid: "a1",
      chat_messages: [
        {
          uuid: "a1",
          parent_message_uuid: "00000000-0000-4000-8000-000000000000",
          sender: "assistant",
          created_at: "2026-05-03T10:00:02.000Z",
          content: [{ type: "thinking", thinking: "" }],
          summaries: [{ summary: "Weighing stylistic options." }],
        },
      ],
    }).chatUsage.contextBreakdown!;

    expect(entries.thinking.tokens).toBeGreaterThan(0);
  });

  it("attributes local_resource file references to tool results", () => {
    // Live shape (Sept 2026): file contents arrive as tool_result content with
    // a local_resource block rather than plain text.
    const { entries } = buildChatUsageFromConversationPayload({
      current_leaf_message_uuid: "a1",
      chat_messages: [
        {
          uuid: "a1",
          parent_message_uuid: "00000000-0000-4000-8000-000000000000",
          sender: "assistant",
          created_at: "2026-05-03T10:00:02.000Z",
          content: [{ type: "local_resource", text: "file bytes here" }],
        },
      ],
    }).chatUsage.contextBreakdown!;

    expect(entries.toolResults.tokens).toBeGreaterThan(0);
    expect(entries.assistantMessages.tokens).toBe(0);
  });
});
