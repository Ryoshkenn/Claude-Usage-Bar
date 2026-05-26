import { describe, expect, it } from "vitest";
import {
  hasMeaningfulChatUsageChange,
  hasMeaningfulDailyUsageChange,
  mutationsContainPageChanges,
} from "../content/contentLifecycle";
import type { ChatUsage, DailyUsage } from "../shared/types";

const dailyUsage: DailyUsage = {
  localDate: "2026-05-25",
  messagesUsed: 2,
  lastVisibleSentCount: 2,
  updatedAt: 100,
};

const chatUsage: ChatUsage = {
  estimatedTokens: 1200,
  currentContextTokens: 800,
  visibleMessageCount: 3,
  updatedAt: 100,
  source: "dom",
  isRefreshingContext: false,
};

const mutationFor = (target: Node, addedNodes: Node[] = [], removedNodes: Node[] = []): MutationRecord =>
  ({
    type: "childList",
    target,
    addedNodes,
    removedNodes,
    attributeName: null,
    attributeNamespace: null,
    nextSibling: null,
    oldValue: null,
    previousSibling: null,
  }) as unknown as MutationRecord;

describe("content lifecycle helpers", () => {
  it("ignores mutations that only add or remove extension-owned nodes", () => {
    const composer = document.createElement("div");
    const host = document.createElement("div");
    host.id = "claude-usage-bar-root";

    expect(mutationsContainPageChanges([mutationFor(composer, [host])])).toBe(false);
    expect(mutationsContainPageChanges([mutationFor(composer, [], [host])])).toBe(false);
  });

  it("treats normal Claude DOM mutations as page changes", () => {
    const composer = document.createElement("div");
    const button = document.createElement("button");

    expect(mutationsContainPageChanges([mutationFor(composer, [button])])).toBe(true);
  });

  it("does not treat timestamp-only daily usage refreshes as meaningful", () => {
    expect(
      hasMeaningfulDailyUsageChange(dailyUsage, {
        ...dailyUsage,
        updatedAt: 200,
      }),
    ).toBe(false);
  });

  it("detects meaningful daily usage changes", () => {
    expect(
      hasMeaningfulDailyUsageChange(dailyUsage, {
        ...dailyUsage,
        messagesUsed: 3,
        updatedAt: 200,
      }),
    ).toBe(true);
  });

  it("does not treat timestamp-only chat usage refreshes as meaningful", () => {
    expect(
      hasMeaningfulChatUsageChange(chatUsage, {
        ...chatUsage,
        updatedAt: 200,
      }),
    ).toBe(false);
  });

  it("detects meaningful chat usage changes", () => {
    expect(
      hasMeaningfulChatUsageChange(chatUsage, {
        ...chatUsage,
        currentContextTokens: 900,
        updatedAt: 200,
      }),
    ).toBe(true);
  });
});
