import type { UsageMetadata } from "../shared/types";

const USER_MESSAGE_SELECTORS = [
  '[data-testid="user-message"]',
  '[data-message-author-role="user"]',
  ".font-user-message",
];

const TRANSCRIPT_MESSAGE_SELECTORS = [
  '[data-testid="user-message"]',
  '[data-message-author-role="user"]',
  ".font-user-message",
  ".font-claude-response",
  '[data-message-author-role="assistant"]',
];

export interface ClaudeDomSnapshot {
  modelLabel?: string;
  visibleSentCount: number;
  visibleMessageCount: number;
  visibleText: string;
  visibleMessageTexts: string[];
  metadata: UsageMetadata;
}

const uniqueElements = (selectors: string[]): Element[] => {
  const found = new Set<Element>();
  selectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((element) => found.add(element));
  });
  return [...found];
};

const visibleTextOf = (element: Element): string => {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return "";
  }
  return element.textContent?.trim() ?? "";
};

const isExtensionElement = (element: Element): boolean => Boolean(element.closest("#claude-usage-bar-root"));

const visibleElements = (): HTMLElement[] =>
  [...document.querySelectorAll<HTMLElement>("body *")].filter((element) => {
    if (isExtensionElement(element)) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });

const normalizedTextOf = (element: Element): string => visibleTextOf(element).replace(/\s+/g, " ");

const uniqueOuterElements = (elements: Element[]): Element[] =>
  elements.filter((element, _index, list) => !list.some((candidate) => candidate !== element && candidate.contains(element)));

const transcriptTextOf = (element: Element): string => {
  const clone = element.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll(
      [
        '[role="group"][aria-label="Message actions"]',
        "button",
        "script",
        "style",
        ".sr-only",
        "#claude-usage-bar-root",
        '[aria-hidden="true"]:not(svg text):not(svg tspan)',
      ].join(","),
    )
    .forEach((node) => node.remove());

  return (clone.innerText ?? clone.textContent ?? "").replace(/\s+/g, " ").trim();
};

const readConversationText = (): { text: string; messageTexts: string[]; messageCount: number; sentCount: number } => {
  const messageElements = uniqueOuterElements(
    uniqueElements(TRANSCRIPT_MESSAGE_SELECTORS).filter((element) => !isExtensionElement(element)),
  );
  const userElements = uniqueOuterElements(
    uniqueElements(USER_MESSAGE_SELECTORS).filter((element) => !isExtensionElement(element)),
  );
  const messageTexts = messageElements.map(transcriptTextOf).filter(Boolean);

  return {
    text: messageTexts.join("\n\n"),
    messageTexts,
    messageCount: messageTexts.length,
    sentCount: userElements.map(transcriptTextOf).filter(Boolean).length,
  };
};

const readPageText = (): string => {
  const pageText = document.body.innerText ?? "";
  const extensionText = document.getElementById("claude-usage-bar-root")?.innerText;
  return extensionText ? pageText.replace(extensionText, "") : pageText;
};

const extractTextMatch = (pageText: string, patterns: RegExp[]): string | undefined => {
  for (const pattern of patterns) {
    const match = pageText.match(pattern);
    if (match?.[0]) {
      return match[0].trim();
    }
  }
  return undefined;
};

const extractPercentageUsed = (pageText: string): number | undefined => {
  const usageElement = visibleElements()
    .filter((element) => element.tagName.toLowerCase() === "span")
    .map((element) => normalizedTextOf(element))
    .find((text) => /^\d{1,3}%\s+used$/i.test(text));
  const labeledUsageMatch = pageText.match(/5-hour limit[\s\S]{0,120}?(\d{1,3})%\s*used/i);
  const text = labeledUsageMatch?.[0] ?? usageElement ?? pageText;
  const remainingMatch = text.match(/\b(\d{1,3})\s*%\s*(?:remaining|left)\b/i);
  if (remainingMatch) {
    return 100 - Number(remainingMatch[1]);
  }

  const usedMatch = text.match(/\b(\d{1,3})\s*%\s*(?:used|usage|of\s+(?:daily|weekly|session)\s+(?:limit|quota))\b/i);
  return usedMatch ? Number(usedMatch[1]) : undefined;
};

const findSmallestElementWithText = (pattern: RegExp): HTMLElement | undefined =>
  visibleElements()
    .map((element) => ({ element, text: normalizedTextOf(element) }))
    .filter(({ text }) => pattern.test(text))
    .sort((a, b) => a.text.length - b.text.length)[0]?.element;

const ancestorsOf = (element: HTMLElement, maxDepth = 6): HTMLElement[] => {
  const ancestors: HTMLElement[] = [];
  let current: HTMLElement | null = element;

  while (current && ancestors.length < maxDepth) {
    ancestors.push(current);
    current = current.parentElement;
  }

  return ancestors;
};

const extractPercentNearLabel = (labelPattern: RegExp): number | undefined => {
  const label = findSmallestElementWithText(labelPattern);
  if (!label) {
    return undefined;
  }

  for (const ancestor of ancestorsOf(label)) {
    const matches = [...ancestor.querySelectorAll<HTMLElement>("span")]
      .filter((element) => !isExtensionElement(element))
      .map((element) => normalizedTextOf(element).match(/^(\d{1,3})%\s+used$/i)?.[1])
      .filter((value): value is string => Boolean(value));

    if (matches.length === 1) {
      return Number(matches[0]);
    }
  }

  return undefined;
};

const extractTextNearLabel = (labelPattern: RegExp, valueSelector: string, valuePattern: RegExp): string | undefined => {
  const label = findSmallestElementWithText(labelPattern);
  if (!label) {
    return undefined;
  }

  for (const ancestor of ancestorsOf(label)) {
    const matches = [...ancestor.querySelectorAll<HTMLElement>(valueSelector)]
      .filter((element) => !isExtensionElement(element))
      .map((element) => normalizedTextOf(element))
      .filter((text) => valuePattern.test(text));

    if (matches.length === 1) {
      return matches[0];
    }
  }

  return undefined;
};

const extractUsageFraction = (pageText: string): Pick<UsageMetadata, "remainingMessages" | "usedMessages" | "totalMessages"> => {
  const remainingMatch = pageText.match(
    /\b(\d{1,5})\s+(?:messages?|uses?)\s+(?:remaining|left)\D{0,24}(?:of|out of|\/)\D{0,8}(\d{1,5})\b/i,
  );
  if (remainingMatch) {
    return {
      remainingMessages: Number(remainingMatch[1]),
      totalMessages: Number(remainingMatch[2]),
    };
  }

  const usedMatch = pageText.match(/\b(\d{1,5})\D{0,8}(?:of|out of|\/)\D{0,8}(\d{1,5})\s+(?:messages?|uses?)?\s*(?:used|usage)\b/i);
  if (usedMatch) {
    return {
      usedMessages: Number(usedMatch[1]),
      totalMessages: Number(usedMatch[2]),
    };
  }

  return {};
};

const extractUsagePageMetadata = (pageText: string): Pick<
  UsageMetadata,
  "percentageUsed" | "weeklyAllModelsPercentageUsed" | "routinesText"
> => {
  const fiveHourMatch = pageText.match(/5-hour limit[\s\S]{0,120}?(\d{1,3})%\s*used/i);
  const weeklyAllModelsMatch = pageText.match(/Weekly\s*·\s*all models[\s\S]{0,120}?(\d{1,3})%\s*used/i);
  const routinesMatch = pageText.match(/Routines[^\n\r]*[\n\r\s]+(\d+\s*\/\s*\d+)/i);

  return {
    percentageUsed: extractPercentNearLabel(/^5-hour limit$/i) ?? (fiveHourMatch ? Number(fiveHourMatch[1]) : undefined),
    weeklyAllModelsPercentageUsed:
      extractPercentNearLabel(/^Weekly\s*·\s*all models$/i) ??
      (weeklyAllModelsMatch ? Number(weeklyAllModelsMatch[1]) : undefined),
    routinesText:
      extractTextNearLabel(/^Routines$/i, ".tabular-nums, span", /^\d+\s*\/\s*\d+$/)?.replace(/\s+/g, " ") ??
      routinesMatch?.[1]?.replace(/\s+/g, " "),
  };
};

export const readClaudeDomSnapshot = (): ClaudeDomSnapshot => {
  const pageText = readPageText();
  const conversation = readConversationText();
  const modelLabel = extractTextMatch(pageText, [/\b(?:Haiku|Sonnet|Opus)\s+\d(?:\.\d)?\b/i]);
  const resetText = extractTextMatch(pageText, [/\bReset(?:s)?\s+(?:in|at)[^\n]{1,80}/i, /\b\d+d\s+\d+h\b/i]);
  const remainingText = extractTextMatch(pageText, [/\b\d+\s+(?:messages?|uses?)\s+(?:left|remaining)\b/i]);
  const limitText = extractTextMatch(pageText, [/\b(?:daily|weekly|session)\s+(?:limit|usage)[^\n]{1,80}/i]);
  const usageFraction = extractUsageFraction(pageText);
  const usagePageMetadata = extractUsagePageMetadata(pageText);
  const percentageUsed = usagePageMetadata.percentageUsed ?? extractPercentageUsed(pageText);

  return {
    modelLabel,
    visibleSentCount: conversation.sentCount,
    visibleMessageCount: conversation.messageCount,
    visibleText: conversation.text,
    visibleMessageTexts: conversation.messageTexts,
    metadata: {
      modelLabel,
      resetText,
      remainingText,
      limitText,
      percentageUsed,
      ...usageFraction,
      ...usagePageMetadata,
    },
  };
};
