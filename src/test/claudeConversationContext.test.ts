import { describe, expect, it, vi } from "vitest";
import {
  buildChatUsageFromConversationPayload,
  calculateCompoundedInputTokens,
} from "../shared/claudeConversationContext";

describe("buildChatUsageFromConversationPayload", () => {
  it("counts the active conversation branch from Claude JSON", () => {
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
    expect(result.chatUsage.currentContextTokens).toBeLessThan(result.chatUsage.estimatedTokens);
    expect(result.chatUsage.estimatedTokens).toBeGreaterThan(2_000);
    expect(result.chatUsage.estimatedTokens).toBeLessThan(2_200);
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

    expect(result.chatUsage.currentContextTokens).toBeLessThan(1_020);
    expect(result.chatUsage.estimatedTokens).toBeGreaterThanOrEqual(1_000);
    expect(result.chatUsage.estimatedTokens).toBeLessThan(1_020);
    expect(result.chatUsage.compoundedInputTokens).toBe(result.chatUsage.estimatedTokens);
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
    expect(result.chatUsage.currentContextTokens).toBeGreaterThan(6_000);
    expect(result.chatUsage.currentContextTokens).toBeLessThan(8_000);
    expect(result.chatUsage.estimatedTokens).toBe(result.chatUsage.compoundedInputTokens);
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
    expect(result.chatUsage.estimatedTokens).toBeGreaterThan(result.cachedPrefixTokens);
    vi.useRealTimers();
  });
});
