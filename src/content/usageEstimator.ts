import type { ChatUsage, DailyUsage } from "../shared/types";

export const estimateTokensFromText = (text: string): number => {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return 0;
  }
  return Math.ceil(normalized.length / 4);
};

export const getLocalDateKey = (date = new Date()): string => date.toLocaleDateString("en-CA");

export const rollDailyUsageForward = (
  previous: DailyUsage,
  visibleSentCount: number,
  now = new Date(),
): DailyUsage => {
  const localDate = getLocalDateKey(now);
  const base =
    previous.localDate === localDate
      ? previous
      : {
          localDate,
          messagesUsed: 0,
          lastVisibleSentCount: 0,
          updatedAt: now.getTime(),
        };

  const increment = Math.max(0, visibleSentCount - base.lastVisibleSentCount);

  return {
    localDate,
    messagesUsed: base.messagesUsed + increment,
    lastVisibleSentCount: visibleSentCount,
    updatedAt: now.getTime(),
  };
};

export const buildChatUsage = (visibleText: string, visibleMessageCount: number, now = Date.now()): ChatUsage => ({
  estimatedTokens: estimateTokensFromText(visibleText),
  visibleMessageCount,
  updatedAt: now,
});
