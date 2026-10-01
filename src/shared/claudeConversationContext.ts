import type { ChatUsage, ContextBreakdown, ContextBreakdownEntry, ContextCategory } from "./types";
import { countClaudeTokens } from "./claudeTokenizer";
import { estimateImageTokensByDims, type ImageTier } from "./imageTokens";
import { getImageTierForModel } from "./modelUsage";
import { applyConservativeTokenBias } from "./tokenBias";

const ROOT_MESSAGE_UUID = "00000000-0000-4000-8000-000000000000";
// System prompt + conversation scaffolding present in every inference.
// Mirrors DOM_BASE_OVERHEAD_TOKENS in usageEstimator so the pre-API fallback
// and the exact count agree.
const BASE_CONVERSATION_OVERHEAD_TOKENS = 15_000;
const MESSAGE_OVERHEAD_TOKENS = 4;
const ENGLISH_CHARS_PER_TOKEN = 3.7;
const DOCUMENT_TOKENS_PER_PAGE = 2_300;
const TOKEN_CACHE_DURATION_MS = 5 * 60 * 1000;
const TOOL_RESULT_OVERHEAD_TOKENS = 16;
const CONNECTOR_METADATA_OVERHEAD_TOKENS = 24;

interface ClaudeMessage {
  uuid?: unknown;
  sender?: unknown;
  parent_message_uuid?: unknown;
  created_at?: unknown;
  content?: unknown;
  attachments?: unknown;
  files_v2?: unknown;
  // v1 file list — same shape family as files_v2 (image dims under
  // preview_asset, page counts under document_asset). Verified live: attached
  // images arrive here, and files_v2-only parsing missed them entirely.
  files?: unknown;
  sync_sources?: unknown;
  // Compressed thinking summaries ([{summary: string}]) shown as
  // "Thought for Ns" in the UI. Real payload text — count it as thinking.
  summaries?: unknown;
}

interface MessageTokenInfo {
  uuid?: string;
  sender?: string;
  tokens: number;
  hasToolUse?: boolean;
}

interface CountedText {
  text: string;
  category: ContextCategory;
}

export interface ConversationContextResult {
  chatUsage: ChatUsage;
  lengthIsEstimate: boolean;
  cachedPrefixTokens: number;
  cacheExpiresAt?: number;
  debugTexts: string[];
}

export const CONTEXT_CATEGORIES: ContextCategory[] = [
  "userMessages",
  "assistantMessages",
  "thinking",
  "toolCalls",
  "toolResults",
  "attachments",
  "projectKnowledge",
  "overhead",
];

const createBreakdownEntries = (): Record<ContextCategory, ContextBreakdownEntry> =>
  CONTEXT_CATEGORIES.reduce(
    (acc, category) => {
      acc[category] = { tokens: 0, count: 0 };
      return acc;
    },
    {} as Record<ContextCategory, ContextBreakdownEntry>,
  );

interface BreakdownAccumulator {
  entries: Record<ContextCategory, ContextBreakdownEntry>;
  addTokens: (category: ContextCategory, tokens: number) => void;
  addCount: (category: ContextCategory, count?: number) => void;
}

const createBreakdownAccumulator = (): BreakdownAccumulator => {
  const entries = createBreakdownEntries();

  return {
    entries,
    addTokens: (category, tokens) => {
      entries[category].tokens += tokens;
    },
    addCount: (category, count = 1) => {
      entries[category].count += count;
    },
  };
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const asString = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

const isUserSender = (sender: unknown): boolean => sender === "human" || sender === "user";

const estimateImageTokens = (file: Record<string, unknown>, imageTier: ImageTier): number => {
  const preview = asRecord(file.preview_asset);
  const width = typeof preview?.image_width === "number" ? preview.image_width : 0;
  const height = typeof preview?.image_height === "number" ? preview.image_height : 0;

  return estimateImageTokensByDims(width, height, imageTier);
};

const estimateDocumentTokens = (file: Record<string, unknown>): number => {
  const document = asRecord(file.document_asset);
  const pageCount = typeof document?.page_count === "number" ? document.page_count : 0;

  return pageCount > 0 ? pageCount * DOCUMENT_TOKENS_PER_PAGE : 0;
};

const estimateFileTokens = (file: unknown, imageTier: ImageTier): number => {
  const data = asRecord(file);
  if (!data) {
    return 0;
  }

  if (data.file_kind === "image") {
    return estimateImageTokens(data, imageTier);
  }

  if (data.file_kind === "document") {
    return estimateDocumentTokens(data);
  }

  return 0;
};

const estimateSyncTokens = (sync: unknown): number => {
  const data = asRecord(sync);
  const status = asRecord(data?.status);
  const sizeBytes = typeof status?.current_size_bytes === "number" ? status.current_size_bytes : 0;

  return sizeBytes > 0 ? Math.ceil(sizeBytes / ENGLISH_CHARS_PER_TOKEN) + CONNECTOR_METADATA_OVERHEAD_TOKENS : 0;
};

// Tool blocks arrive under several type names depending on whether the tool is
// built in, server-side, or an MCP connector. `local_resource` is a file
// reference returned inside tool_result content (verified live Sept 2026).
const TOOL_USE_TYPES = new Set(["tool_use", "server_tool_use", "mcp_tool_use"]);
const TOOL_RESULT_TYPES = new Set([
  "tool_result",
  "server_tool_result",
  "mcp_tool_result",
  "web_search_tool_result",
  "local_resource",
]);

const categorizeBlock = (type: string | undefined, sender: unknown): ContextCategory => {
  if (type === "thinking" || type === "redacted_thinking") {
    return "thinking";
  }
  if (type && TOOL_USE_TYPES.has(type)) {
    return "toolCalls";
  }
  if (type && TOOL_RESULT_TYPES.has(type)) {
    return "toolResults";
  }

  return isUserSender(sender) ? "userMessages" : "assistantMessages";
};

// `inherited` keeps nested blocks (e.g. the text inside a tool_result) attributed
// to the tool that produced them rather than to the message's sender.
const collectTextFromContent = (
  content: unknown,
  sender: unknown,
  inherited?: ContextCategory,
): CountedText[] => {
  const data = asRecord(content);
  if (!data) {
    return [];
  }

  const pieces: CountedText[] = [];
  const category = inherited ?? categorizeBlock(asString(data.type), sender);
  const text = asString(data.text);
  const thinking = asString(data.thinking);

  if (text) {
    pieces.push({ text, category });
  }

  // Extended thinking tokens are billed as input tokens on subsequent turns
  if (thinking) {
    pieces.push({ text: thinking, category: "thinking" });
  }

  if (data.input !== undefined) {
    pieces.push({ text: JSON.stringify(data.input), category });
  }

  if (data.content !== undefined) {
    if (Array.isArray(data.content)) {
      // Tool result content is in the context window and costs real tokens
      data.content.forEach((nested) => {
        pieces.push(...collectTextFromContent(nested, sender, category));
      });
    } else {
      pieces.push(...collectTextFromContent(data.content, sender, category));
    }
  }

  return pieces;
};

const getMessageText = (message: ClaudeMessage): CountedText[] => {
  const pieces: CountedText[] = [];
  const sender = message.sender;

  asArray(message.content).forEach((content) => {
    pieces.push(...collectTextFromContent(content, sender));
  });

  asArray(message.attachments).forEach((attachment) => {
    const data = asRecord(attachment);
    const extracted = asString(data?.extracted_content);
    if (extracted) {
      pieces.push({ text: extracted, category: "attachments" });
    }
  });

  // Compressed thinking summaries ("Thought for Ns" disclosure). The full
  // thinking text is often empty while summaries carry the substance.
  asArray(message.summaries).forEach((summary) => {
    if (typeof summary === "string" && summary) {
      pieces.push({ text: summary, category: "thinking" });
      return;
    }
    const data = asRecord(summary);
    const text = asString(data?.summary) ?? asString(data?.text) ?? asString(data?.thinking);
    if (text) {
      pieces.push({ text, category: "thinking" });
    }
  });

  return pieces;
};

const getMessageCreatedAt = (message: ClaudeMessage): number => {
  const createdAt = asString(message.created_at);
  const timestamp = createdAt ? Date.parse(createdAt) : NaN;
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const reconstructCurrentTrunk = (payload: unknown): ClaudeMessage[] => {
  const data = asRecord(payload);
  const messages = asArray(data?.chat_messages).map((message) => asRecord(message)).filter(Boolean) as ClaudeMessage[];
  const messageById = new Map<string, ClaudeMessage>();

  messages.forEach((message) => {
    const uuid = asString(message.uuid);
    if (uuid) {
      messageById.set(uuid, message);
    }
  });

  let currentId = asString(data?.current_leaf_message_uuid);
  const trunk: ClaudeMessage[] = [];

  while (currentId && currentId !== ROOT_MESSAGE_UUID) {
    const message = messageById.get(currentId);
    if (!message) {
      break;
    }

    trunk.push(message);
    currentId = asString(message.parent_message_uuid);
  }

  return trunk.reverse();
};

const getCacheBoundary = (messages: ClaudeMessage[]): { cacheEndId?: string; cacheExpiresAt?: number } => {
  const assistants = messages
    .filter((message) => message.sender === "assistant" && asString(message.uuid))
    .sort((a, b) => getMessageCreatedAt(b) - getMessageCreatedAt(a));
  const latest = assistants[0];
  const secondLatest = assistants[1];
  const latestCreatedAt = latest ? getMessageCreatedAt(latest) : 0;
  const secondLatestCreatedAt = secondLatest ? getMessageCreatedAt(secondLatest) : 0;
  const cacheAgeReference = latestCreatedAt || secondLatestCreatedAt;

  if (!secondLatest || !cacheAgeReference || Date.now() - cacheAgeReference >= TOKEN_CACHE_DURATION_MS) {
    return {};
  }

  return {
    cacheEndId: asString(secondLatest.uuid),
    cacheExpiresAt: latestCreatedAt ? latestCreatedAt + TOKEN_CACHE_DURATION_MS : undefined,
  };
};

const estimateToolResultOverhead = (message: ClaudeMessage): number =>
  asArray(message.content).some((item) => asRecord(item)?.type === "tool_result") ? TOOL_RESULT_OVERHEAD_TOKENS : 0;

const estimateMessageTokens = (
  message: ClaudeMessage,
  debugTexts: string[],
  breakdown: BreakdownAccumulator,
  imageTier: ImageTier,
): { tokens: number; lengthIsEstimate: boolean; hasToolUse: boolean } => {
  const toolResultOverhead = estimateToolResultOverhead(message);
  let tokens = MESSAGE_OVERHEAD_TOKENS + toolResultOverhead;
  let lengthIsEstimate = false;
  const textPieces = getMessageText(message);

  breakdown.addTokens("overhead", MESSAGE_OVERHEAD_TOKENS);
  breakdown.addTokens("toolResults", toolResultOverhead);

  textPieces.forEach(({ text, category }) => {
    const textTokens = countClaudeTokens(text);
    tokens += textTokens;
    breakdown.addTokens(category, textTokens);
    debugTexts.push(text);
  });

  asArray(message.attachments).forEach((attachment) => {
    if (asString(asRecord(attachment)?.extracted_content)) {
      breakdown.addCount("attachments");
    }
  });

  // Both file list generations: files_v2 (current) and files (v1, same shape
  // family — attached images live here).
  [...asArray(message.files_v2), ...asArray(message.files)].forEach((file) => {
    const fileTokens = estimateFileTokens(file, imageTier);
    tokens += fileTokens;
    breakdown.addTokens("attachments", fileTokens);
    breakdown.addCount("attachments");
  });

  asArray(message.sync_sources).forEach((sync) => {
    const syncTokens = estimateSyncTokens(sync);
    tokens += syncTokens;
    breakdown.addTokens("attachments", syncTokens);
    breakdown.addCount("attachments");
    lengthIsEstimate = true;
  });

  const rawContent = asArray(message.content);
  const hasToolUse = rawContent.some((item) => {
    const type = asString(asRecord(item)?.type);
    return Boolean(type && TOOL_USE_TYPES.has(type));
  });

  breakdown.addCount(isUserSender(message.sender) ? "userMessages" : "assistantMessages");
  breakdown.addCount("overhead");
  rawContent.forEach((item) => {
    const type = asString(asRecord(item)?.type);
    if (!type) {
      return;
    }
    if (type === "thinking" || type === "redacted_thinking") {
      breakdown.addCount("thinking");
    } else if (TOOL_USE_TYPES.has(type)) {
      breakdown.addCount("toolCalls");
    } else if (TOOL_RESULT_TYPES.has(type)) {
      breakdown.addCount("toolResults");
    }
  });
  if (asArray(message.summaries).length > 0) {
    breakdown.addCount("thinking");
  }

  if (
    rawContent.some((item) => asRecord(item)?.type === "tool_result") ||
    rawContent.some((item) => asRecord(item)?.name === "web_search")
  ) {
    lengthIsEstimate = true;
  }

  return { tokens, lengthIsEstimate, hasToolUse };
};

// The headline context number carries a conservative bias, so scale each row by
// the same factor and hand the rounding remainder to the largest row. Without
// this the panel's rows would visibly fail to add up to the number on the ring.
const scaleBreakdownToTotal = (
  entries: Record<ContextCategory, ContextBreakdownEntry>,
  rawTotal: number,
  scaledTotal: number,
): ContextBreakdown => {
  const scaled = createBreakdownEntries();

  if (rawTotal <= 0 || scaledTotal <= 0) {
    return { entries: scaled, totalTokens: 0 };
  }

  let allocated = 0;
  let largest: ContextCategory = CONTEXT_CATEGORIES[0];

  CONTEXT_CATEGORIES.forEach((category) => {
    const tokens = Math.floor((entries[category].tokens / rawTotal) * scaledTotal);
    scaled[category] = { tokens, count: entries[category].count };
    allocated += tokens;
    if (entries[category].tokens > entries[largest].tokens) {
      largest = category;
    }
  });

  scaled[largest].tokens += scaledTotal - allocated;

  return { entries: scaled, totalTokens: scaledTotal };
};

// Each model inference consumes the entire context up to that point.
// Inference happens on every human message AND every time the model emits a tool call
// (the tool result will trigger another full-context inference next turn).
export const calculateCompoundedInputTokens = (
  messageTokenInfos: Pick<MessageTokenInfo, "sender" | "tokens" | "hasToolUse">[],
  baseTokens = BASE_CONVERSATION_OVERHEAD_TOKENS,
): number => {
  let runningContextTokens = baseTokens;
  let totalTokensConsumed = 0;

  messageTokenInfos.forEach((message) => {
    runningContextTokens += message.tokens;
    if (isUserSender(message.sender) || message.hasToolUse) {
      totalTokensConsumed += runningContextTokens;
    }
  });

  return totalTokensConsumed;
};

export const buildChatUsageFromConversationPayload = (payload: unknown, now = Date.now()): ConversationContextResult => {
  const data = asRecord(payload);
  const messages = reconstructCurrentTrunk(payload);
  const debugTexts: string[] = [];

  // No messages yet (fresh/empty chat): report a true zero instead of the base
  // overhead, mirroring the DOM fallback (usageEstimator.buildChatUsage) so a
  // new chat reads 0% on both paths rather than rounding up to 1%.
  if (messages.length === 0) {
    return {
      chatUsage: {
        estimatedTokens: 0,
        currentContextTokens: 0,
        compoundedInputTokens: 0,
        visibleMessageCount: 0,
        updatedAt: now,
        isRefreshingContext: false,
        contextBreakdown: { entries: createBreakdownEntries(), totalTokens: 0 },
      },
      lengthIsEstimate: false,
      cachedPrefixTokens: 0,
      debugTexts,
    };
  }

  let currentContextTokens = BASE_CONVERSATION_OVERHEAD_TOKENS;
  let lengthIsEstimate = false;
  let cachedPrefixTokens = 0;
  const cache = getCacheBoundary(messages);
  let cacheIsActive = Boolean(cache.cacheEndId);
  const messageTokenInfos: MessageTokenInfo[] = [];
  const breakdown = createBreakdownAccumulator();
  // Vision tier for attached images, from the payload's model id
  // (e.g. "claude-opus-5"). Unknown ids resolve high — the safe direction.
  const imageTier = getImageTierForModel(asString(data?.model));

  breakdown.addTokens("overhead", BASE_CONVERSATION_OVERHEAD_TOKENS);

  messages.forEach((message) => {
    const result = estimateMessageTokens(message, debugTexts, breakdown, imageTier);
    const messageTokens = result.tokens;
    const uuid = asString(message.uuid);
    const sender = asString(message.sender);
    currentContextTokens += messageTokens;
    lengthIsEstimate ||= result.lengthIsEstimate;
    messageTokenInfos.push({ uuid, sender, tokens: messageTokens, hasToolUse: result.hasToolUse });

    if (cacheIsActive) {
      cachedPrefixTokens += messageTokens;
    }

    if (asString(message.uuid) === cache.cacheEndId) {
      cacheIsActive = false;
    }
  });

  const projectUuid = asString(data?.project_uuid);
  const projectKnowledgeSize = asRecord(data?.project)?.knowledge_size;
  if (projectUuid && typeof projectKnowledgeSize === "number") {
    currentContextTokens += projectKnowledgeSize;
    breakdown.addTokens("projectKnowledge", projectKnowledgeSize);
    breakdown.addCount("projectKnowledge");
  } else if (projectUuid) {
    lengthIsEstimate = true;
  }

  const compoundedInputTokens = calculateCompoundedInputTokens(messageTokenInfos);
  const biasedCurrentContextTokens = applyConservativeTokenBias(currentContextTokens);

  return {
    chatUsage: {
      estimatedTokens: biasedCurrentContextTokens,
      currentContextTokens: biasedCurrentContextTokens,
      compoundedInputTokens: Math.round(compoundedInputTokens),
      visibleMessageCount: messages.length,
      updatedAt: now,
      isRefreshingContext: false,
      contextBreakdown: scaleBreakdownToTotal(
        breakdown.entries,
        currentContextTokens,
        biasedCurrentContextTokens,
      ),
    },
    lengthIsEstimate,
    cachedPrefixTokens,
    cacheExpiresAt: cache.cacheExpiresAt,
    debugTexts,
  };
};
