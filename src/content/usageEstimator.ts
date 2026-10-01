import type { ChatUsage, DailyUsage } from "../shared/types";
import { estimateImageTokensByDims, type ImageTier } from "../shared/imageTokens";
import type { DomAttachment } from "./claudeDom";
import { applyConservativeTokenBias } from "../shared/tokenBias";

// DOM fallback for before the conversation API returns. Mirrors the API path's
// construction (claudeConversationContext.ts) — same base + per-message
// overhead, then the same conservative bias — so the number doesn't jump when
// exact data arrives. Calibrated against the real tokenizer on prose / code /
// mixed conversations: raw length / 3.4 lands within ~+10% on the conservative
// side. (The 1.7MB tokenizer bundle stays in the background worker; the content
// script keeps this lightweight heuristic instead.)
const DOM_CHARS_PER_TOKEN = 3.4;
// Must match BASE_CONVERSATION_OVERHEAD_TOKENS in claudeConversationContext
// so the fallback doesn't jump when exact API data lands.
const DOM_BASE_OVERHEAD_TOKENS = 15_000;
const DOM_MESSAGE_OVERHEAD_TOKENS = 4;

// DOM fallback per-file allowances (raw tokens, pre-bias). The transcript DOM
// exposes no byte/page counts for most files, so these mirror the API path's
// rates instead — the exact count arrives via the conversation API moments
// later, this just keeps the pre-API number in the right ballpark:
// - line count known (txt/code cards show "67 lines"): wrapped prose runs
//   ~120 chars/line ≈ 30 tokens/line at 3.4 chars/token.
// - documents without sizes (PDF tiles): ~2 pages × the API's 2300/page.
// - images without dimensions: just under the API's 1700 max.
// - anything else: a small flat allowance.
const DOM_TOKENS_PER_LINE = 30;
const DOM_DOCUMENT_TOKENS = 4_600;
const DOM_IMAGE_TOKENS = 1_500;
const DOM_ATTACHMENT_DEFAULT_TOKENS = 1_000;

const DOM_DOCUMENT_KINDS = new Set([
  "pdf",
  "doc",
  "docx",
  "txt",
  "md",
  "markdown",
  "csv",
  "tsv",
  "rtf",
  "ppt",
  "pptx",
  "xls",
  "xlsx",
  "tex",
  "epub",
]);
const DOM_IMAGE_KINDS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "heic", "avif"]);

export const estimateAttachmentTokens = (
  attachment: DomAttachment,
  imageTier: ImageTier = "high",
): number => {
  if (typeof attachment.lineCount === "number" && attachment.lineCount > 0) {
    return attachment.lineCount * DOM_TOKENS_PER_LINE;
  }
  const kind = attachment.kind?.toLowerCase();
  if (kind && DOM_IMAGE_KINDS.has(kind)) {
    // Real pixel dimensions when the image resource has loaded (verified live:
    // naturalWidth/Height report the full-size resource, not the 120px tile).
    const byDims = estimateImageTokensByDims(attachment.imageWidth ?? 0, attachment.imageHeight ?? 0, imageTier);
    return byDims > 0 ? byDims : DOM_IMAGE_TOKENS;
  }
  if (kind && DOM_DOCUMENT_KINDS.has(kind)) {
    return DOM_DOCUMENT_TOKENS;
  }
  return DOM_ATTACHMENT_DEFAULT_TOKENS;
};

export const estimateTokensFromText = (text: string): number => {
  // Blank messages carry no tokens, but otherwise count raw length: indentation
  // and line breaks in code are real tokens, so whitespace is deliberately NOT
  // collapsed here.
  if (!text.trim()) {
    return 0;
  }

  return Math.ceil(text.length / DOM_CHARS_PER_TOKEN);
};

export const estimateCumulativeContextTokens = (messageTexts: string[]): number => {
  let runningContextTokens = DOM_BASE_OVERHEAD_TOKENS;
  let cumulativeContextTokens = 0;

  messageTexts.forEach((messageText) => {
    runningContextTokens += DOM_MESSAGE_OVERHEAD_TOKENS + estimateTokensFromText(messageText);
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

// Messages added between two consecutive daily counters. When the day rolled
// over, `next` already reset to 0, so its full count is the increment.
export const deriveDailyIncrement = (previous: DailyUsage, next: DailyUsage): number =>
  previous.localDate === next.localDate
    ? Math.max(0, next.messagesUsed - previous.messagesUsed)
    : Math.max(0, next.messagesUsed);

export const buildChatUsage = (
  messageTexts: string[],
  now = Date.now(),
  attachments: DomAttachment[] = [],
  imageTier: ImageTier = "high",
): ChatUsage => {
  const attachmentTokens = attachments.reduce(
    (total, attachment) => total + estimateAttachmentTokens(attachment, imageTier),
    0,
  );

  // No messages yet (fresh chat): report a true zero instead of the base
  // overhead, so a new chat reads 0% rather than rounding up to 1%.
  if (messageTexts.length === 0 && attachmentTokens === 0) {
    return {
      estimatedTokens: 0,
      currentContextTokens: 0,
      visibleMessageCount: 0,
      updatedAt: now,
      source: "dom",
      isRefreshingContext: false,
    };
  }

  // Same shape as the API path (estimatedTokens === current window) so the
  // tooltip's "current context" line doesn't inflate before API data lands.
  // Attachments ride along inside the same bias so the whole fallback stays
  // conservative by the same factor.
  const currentContextTokens = applyConservativeTokenBias(
    DOM_BASE_OVERHEAD_TOKENS +
      messageTexts.reduce(
        (total, messageText) => total + DOM_MESSAGE_OVERHEAD_TOKENS + estimateTokensFromText(messageText),
        0,
      ) +
      attachmentTokens,
  );

  return {
    estimatedTokens: currentContextTokens,
    currentContextTokens,
    visibleMessageCount: messageTexts.length,
    updatedAt: now,
    source: "dom",
    isRefreshingContext: false,
    ...(attachments.length > 0 ? { lengthIsEstimate: true as const } : {}),
  };
};
