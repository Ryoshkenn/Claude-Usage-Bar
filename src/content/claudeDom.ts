import type { ThinkingLevel, UsageMetadata } from "../shared/types";
import { normalizeThinkingLevel } from "../shared/modelUsage";

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

export interface DomAttachment {
  fileName?: string;
  // Lowercased kind: badge text ("pdf", "txt") or filename extension.
  kind?: string;
  // Parsed from thumbnails like "67 lines" (text/code files). PDFs and images
  // expose no size in the DOM.
  lineCount?: number;
  // Intrinsic pixel dimensions of attached images, read from the loaded
  // resource (naturalWidth/Height) — the rendered 120px tile size is useless,
  // but the underlying /preview resource is full-size (verified live).
  imageWidth?: number;
  imageHeight?: number;
}

export interface ClaudeDomSnapshot {
  modelLabel?: string;
  // From the effort menu (switch + radios): "off", a level, or undefined when the
  // menu is closed. The authority on whether thinking is enabled.
  thinkingLevel?: ThinkingLevel;
  // From the always-visible composer control (e.g. "Opus 4.8 Max"): the configured
  // level, shown even while thinking is off — so it's the timely source for the
  // *level*, but says nothing about on/off.
  composerThinkingLevel?: ThinkingLevel;
  visibleSentCount: number;
  visibleMessageCount: number;
  visibleText: string;
  visibleMessageTexts: string[];
  // Sent attachments (PDF/image thumbnails, file cards). Deliberately NOT part
  // of `metadata` — the page probe allowlists metadata keys, and filenames
  // would leak document titles through it.
  attachments: DomAttachment[];
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

const ATTACHMENT_SELECTOR = '[data-testid="file-thumbnail"]';

// Sent attachments, read from the file tiles/cards in the transcript. Two live
// variants (verified Sept 2026): image-preview tiles (PDFs/images — filename in
// the img alt, type badge, NO size) and file cards (txt/code — full filename in
// a title attr, a "67 lines" size signal, type badge). Only filename, kind, and
// line count are extracted — never file contents.
const readDomAttachments = (): DomAttachment[] =>
  [...document.querySelectorAll<HTMLElement>(ATTACHMENT_SELECTOR)]
    .filter((el) => !isExtensionElement(el) && !el.closest("form"))
    .map((thumb) => {
      const text = (thumb.textContent ?? "").replace(/\s+/g, " ").trim();
      const img = thumb.querySelector("img");
      const fileName =
        img?.getAttribute("alt")?.trim() ||
        thumb.querySelector(".sr-only")?.textContent?.trim() ||
        thumb.querySelector("[title]")?.getAttribute("title")?.trim() ||
        undefined;
      const badge = thumb
        .querySelector('[data-cds="Badge"]')
        ?.textContent?.replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      const ext = fileName?.match(/\.([a-z0-9]{1,5})$/)?.[1]?.toLowerCase();
      const lineMatch = text.match(/(\d+)\s+lines?\b/i);

      const attachment: DomAttachment = {};
      if (fileName) {
        attachment.fileName = fileName;
      }
      const kind = ext ?? badge;
      if (kind) {
        attachment.kind = kind;
      }
      if (lineMatch) {
        attachment.lineCount = Number(lineMatch[1]);
      }
      // Intrinsic (full-resource) dimensions only — the rendered tile is a
      // fixed 120px and says nothing about the real image.
      const naturalWidth = img?.naturalWidth ?? 0;
      const naturalHeight = img?.naturalHeight ?? 0;
      if (naturalWidth > 0 && naturalHeight > 0) {
        attachment.imageWidth = naturalWidth;
        attachment.imageHeight = naturalHeight;
      }
      return attachment;
    });

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
  "percentageUsed" | "weeklyAllModelsPercentageUsed"
> => {
  const fiveHourMatch = pageText.match(/5-hour limit[\s\S]{0,120}?(\d{1,3})%\s*used/i);
  const weeklyAllModelsMatch = pageText.match(/Weekly\s*·\s*all models[\s\S]{0,120}?(\d{1,3})%\s*used/i);

  return {
    percentageUsed: extractPercentNearLabel(/^5-hour limit$/i) ?? (fiveHourMatch ? Number(fiveHourMatch[1]) : undefined),
    weeklyAllModelsPercentageUsed:
      extractPercentNearLabel(/^Weekly\s*·\s*all models$/i) ??
      (weeklyAllModelsMatch ? Number(weeklyAllModelsMatch[1]) : undefined),
  };
};

const MODEL_LABEL_RE = /\b(?:Claude\s+)?(?:Opus|Sonnet|Haiku|Fable)\s+\d(?:\.\d)?\b/i;

const cleanModelLabel = (raw: string): string => raw.replace(/^Claude\s+/i, "").trim();

// True when the element lives inside an open model picker, which lists every
// model name and would otherwise poison "first match wins" detection.
const isInsideModelMenu = (element: Element): boolean =>
  Boolean(element.closest('[role="menu"], [role="listbox"], [data-testid*="menu" i]'));

// The active model is never returned by the usage API — it only exists in the
// page DOM. Read it from the model-switcher control specifically (textContent,
// not innerText, so it's deterministic), trying the most specific elements
// first: the model-tagged control, then a popup trigger button, then any button.
// Items inside an open model menu are excluded. Only if none match do we fall
// back to scanning the whole page, the old (unreliable) behavior.
// The model-switcher control candidates, most specific first: the model-tagged
// control, then a popup trigger button, then any button. Items inside an open
// model menu are excluded so its full model list can't poison detection.
const modelControlCandidates = (): HTMLElement[] => {
  const pick = (selector: string): HTMLElement[] =>
    [...document.querySelectorAll<HTMLElement>(selector)].filter(
      (el) => !isExtensionElement(el) && !isInsideModelMenu(el),
    );

  return [
    ...pick('[data-testid*="model" i]'),
    ...pick('button[aria-haspopup], [role="button"][aria-haspopup]'),
    ...pick('button, [role="button"]'),
  ];
};

// The whitespace-collapsed text of the first control that names a model, e.g.
// "Opus 5 Low" — model name plus effort suffix (absent on Haiku, which has no
// levels: "Haiku 4.5"). Checks textContent first, then the aria-label (format
// "Model: Opus 5 Low"), which carries the same info without badge noise.
const readModelControlText = (): string | undefined => {
  for (const el of modelControlCandidates()) {
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (MODEL_LABEL_RE.test(text)) {
      return text;
    }
    const labelled = (el.getAttribute("aria-label") ?? "").replace(/\s+/g, " ").trim();
    if (MODEL_LABEL_RE.test(labelled)) {
      return labelled;
    }
  }
  return undefined;
};

export const readSelectedModelLabel = (pageText: string): string | undefined => {
  const controlText = readModelControlText();
  const controlMatch = controlText?.match(MODEL_LABEL_RE);
  if (controlMatch) {
    return cleanModelLabel(controlMatch[0]);
  }

  const fallback = pageText.match(MODEL_LABEL_RE);
  return fallback ? cleanModelLabel(fallback[0]) : undefined;
};

// Claude's effort submenu radios. Current markup (verified live Sept 2026) is
// role="menu" > [role="menuitemradio"][data-effort-id][aria-checked] with ids
// low/medium/high/xhigh/max; "xhigh" is the "Extra" option. The older
// [data-testid="effort-option-*"] variant is kept as a fallback.
// ⚠️ If thinking detection breaks, re-check these against live claude.ai markup.
const EFFORT_OPTION_LEVEL: Record<string, Exclude<ThinkingLevel, "off">> = {
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "extra",
  max: "max",
};

// The active thinking level lives only in the page DOM (never the usage API), and
// only while the effort submenu is *open* (the radios unmount on close).
// Returns:
//   "off"        — the Thinking switch is toggled off (legacy markup only; the
//                  current effort submenu has no switch — a level is always set)
//   a level      — the checked effort radio
//   undefined    — menu closed / not readable; caller keeps the last known value
// so a closed menu never clobbers a previously-detected level.
export const readThinkingLevel = (): ThinkingLevel | undefined => {
  const toggle = document.querySelector<HTMLElement>('[role="switch"][aria-label="Thinking" i]');
  if (toggle?.getAttribute("aria-checked") === "false") {
    return "off";
  }

  const legacy = document.querySelector<HTMLElement>('[data-testid^="effort-option-"][aria-checked="true"]');
  const legacySuffix = legacy?.getAttribute("data-testid")?.replace("effort-option-", "");
  if (legacySuffix && EFFORT_OPTION_LEVEL[legacySuffix]) {
    return EFFORT_OPTION_LEVEL[legacySuffix];
  }

  const checked = document.querySelector<HTMLElement>('[data-effort-id][aria-checked="true"]');
  const effortId = checked?.getAttribute("data-effort-id") ?? "";
  return EFFORT_OPTION_LEVEL[effortId];
};

// The Thinking switch's bare on/off state, read in isolation from the effort
// level. Legacy markup only — the current effort submenu (Sept 2026) has no
// switch, so this returns undefined there and callers keep their last value.
// Returns:
//   true/false   — the switch is present and toggled on/off
//   undefined    — the switch isn't in the DOM (menu closed, or new markup);
//                  caller keeps last
// Toggling the switch can close the menu before the debounced refresh reads it,
// so callers capture this synchronously on mutation while the switch still exists.
export const readThinkingEnabled = (): boolean | undefined => {
  const toggle = document.querySelector<HTMLElement>('[role="switch"][aria-label="Thinking" i]');
  if (!toggle) {
    return undefined;
  }
  return toggle.getAttribute("aria-checked") !== "false";
};

// The composer model control trails the model name with the configured effort
// level, e.g. "Opus 5 Low". Unlike the effort submenu it's always in the DOM,
// so it gives the level even when the menu is closed. Haiku has no levels, so
// its control is a bare "Haiku 4.5" with no suffix — correctly yielding
// undefined. Returns the level, or undefined when no recognizable effort suffix
// trails the model name.
export const readComposerEffortLevel = (): ThinkingLevel | undefined => {
  const text = readModelControlText();
  const modelMatch = text?.match(MODEL_LABEL_RE);
  if (!text || !modelMatch) {
    return undefined;
  }
  const suffix = text.slice((modelMatch.index ?? 0) + modelMatch[0].length).trim();
  if (!suffix) {
    return undefined;
  }
  const level = normalizeThinkingLevel(suffix);
  return level === "off" ? undefined : level;
};

export interface ThinkingResolution {
  // Effective thinking level for cost math: "off" when the switch is known-off,
  // else the freshest known level. undefined means "no reading right now" — the
  // caller keeps its last stored value.
  level: ThinkingLevel | undefined;
  // Updated sticky on/off state. undefined while the switch has never been seen.
  enabled: boolean | undefined;
}

// Combine the two thinking signals into one effective level. The effort-menu
// switch is the only authority on enabled/disabled but is readable solely while
// the menu is open, so its last value is remembered across reads (`lastEnabled`).
// The composer supplies the level at all times. Until the switch has ever been
// seen we conservatively assume thinking is on (costlier — never over-promises).
export const resolveEffectiveThinkingLevel = (
  menuLevel: ThinkingLevel | undefined,
  composerLevel: ThinkingLevel | undefined,
  lastEnabled: boolean | undefined,
): ThinkingResolution => {
  const enabled = menuLevel === "off" ? false : menuLevel !== undefined ? true : lastEnabled;

  if (enabled === false) {
    return { level: "off", enabled };
  }

  const menuRadioLevel = menuLevel && menuLevel !== "off" ? menuLevel : undefined;
  return { level: menuRadioLevel ?? composerLevel, enabled };
};

export const readClaudeDomSnapshot = (): ClaudeDomSnapshot => {
  const pageText = readPageText();
  const conversation = readConversationText();
  const modelLabel = readSelectedModelLabel(pageText);
  const thinkingLevel = readThinkingLevel();
  const composerThinkingLevel = readComposerEffortLevel();
  const resetText = extractTextMatch(pageText, [/\bReset(?:s)?\s+(?:in|at)[^\n]{1,80}/i, /\b\d+d\s+\d+h\b/i]);
  const remainingText = extractTextMatch(pageText, [/\b\d+\s+(?:messages?|uses?)\s+(?:left|remaining)\b/i]);
  const limitText = extractTextMatch(pageText, [/\b(?:daily|weekly|session)\s+(?:limit|usage)[^\n]{1,80}/i]);
  const usageFraction = extractUsageFraction(pageText);
  const usagePageMetadata = extractUsagePageMetadata(pageText);
  const percentageUsed = usagePageMetadata.percentageUsed ?? extractPercentageUsed(pageText);

  return {
    modelLabel,
    thinkingLevel,
    composerThinkingLevel,
    visibleSentCount: conversation.sentCount,
    visibleMessageCount: conversation.messageCount,
    visibleText: conversation.text,
    visibleMessageTexts: conversation.messageTexts,
    attachments: readDomAttachments(),
    metadata: {
      modelLabel,
      thinkingLevel,
      resetText,
      remainingText,
      limitText,
      percentageUsed,
      ...usageFraction,
      ...usagePageMetadata,
    },
  };
};
