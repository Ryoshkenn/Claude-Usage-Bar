import type { ChatUsage, DailyUsage } from "../shared/types";
import { countClaudeTokens } from "../shared/claudeTokenizer";
import { applyConservativeTokenBias } from "../shared/tokenBias";

export const estimateTokensFromText = (text: string): number => {
  return countClaudeTokens(text);
};

export const estimateCumulativeContextTokens = (messageTexts: string[]): number => {
  let runningContextTokens = 0;
  let cumulativeContextTokens = 0;

  messageTexts.forEach((messageText) => {
    runningContextTokens += estimateTokensFromText(messageText);
    cumulativeContextTokens += runningContextTokens;
  });

  return cumulativeContextTokens;
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

export const buildChatUsage = (messageTexts: string[], now = Date.now()): ChatUsage => ({
  estimatedTokens: applyConservativeTokenBias(estimateCumulativeContextTokens(messageTexts)),
  visibleMessageCount: messageTexts.length,
  updatedAt: now,
  source: "dom",
});
