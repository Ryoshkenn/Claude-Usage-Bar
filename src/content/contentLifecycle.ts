import type { ChatUsage, DailyUsage } from "../shared/types";

const EXTENSION_NODE_SELECTOR = [
  "#claude-usage-bar-root",
  "#claude-cache-timer-host",
  "#claude-user-message-rail",
  "#cub-settings-panel",
].join(",");

const elementForNode = (node: Node): Element | null => {
  if (node.nodeType === 1) {
    return node as Element;
  }

  return (node as ChildNode).parentElement ?? null;
};

export const isExtensionOwnedNode = (node: Node): boolean => {
  const element = elementForNode(node);
  return Boolean(element?.closest(EXTENSION_NODE_SELECTOR));
};

export const mutationsContainPageChanges = (records: MutationRecord[] | undefined): boolean => {
  if (!records || records.length === 0) {
    return true;
  }

  return records.some((record) => {
    if (isExtensionOwnedNode(record.target)) {
      return false;
    }

    if (record.type === "childList") {
      const changedNodes = [...record.addedNodes, ...record.removedNodes];
      if (changedNodes.length > 0 && changedNodes.every(isExtensionOwnedNode)) {
        return false;
      }
    }

    return true;
  });
};

export const hasMeaningfulDailyUsageChange = (previous: DailyUsage, next: DailyUsage): boolean =>
  previous.localDate !== next.localDate ||
  previous.messagesUsed !== next.messagesUsed ||
  previous.lastVisibleSentCount !== next.lastVisibleSentCount;

const CHAT_USAGE_KEYS: (keyof ChatUsage)[] = [
  "estimatedTokens",
  "visibleMessageCount",
  "source",
  "isRefreshingContext",
  "currentContextTokens",
  "compoundedInputTokens",
  "cachedPrefixTokens",
  "cacheExpiresAt",
  "lengthIsEstimate",
];

export const hasMeaningfulChatUsageChange = (previous: ChatUsage, next: ChatUsage): boolean =>
  CHAT_USAGE_KEYS.some((key) => previous[key] !== next[key]);
