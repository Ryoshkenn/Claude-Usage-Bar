import type { ChatUsage } from "./types";
import { countClaudeTokens } from "./claudeTokenizer";
import { applyConservativeTokenBias } from "./tokenBias";

const ROOT_MESSAGE_UUID = "00000000-0000-4000-8000-000000000000";
const BASE_CONVERSATION_OVERHEAD_TOKENS = 1_000;
const MESSAGE_OVERHEAD_TOKENS = 4;
const ENGLISH_CHARS_PER_TOKEN = 3.7;
const IMAGE_MAX_TOKENS = 1_700;
const IMAGE_PIXELS_PER_TOKEN = 700;
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
  sync_sources?: unknown;
}

interface MessageTokenInfo {
  uuid?: string;
  sender?: string;
  tokens: number;
  hasToolUse?: boolean;
}

interface CountedText {
  text: string;
}

export interface ConversationContextResult {
  chatUsage: ChatUsage;
  lengthIsEstimate: boolean;
  cachedPrefixTokens: number;
  cacheExpiresAt?: number;
  debugTexts: string[];
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const asString = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

const isUserSender = (sender: unknown): boolean => sender === "human" || sender === "user";

const estimateImageTokens = (file: Record<string, unknown>): number => {
  const preview = asRecord(file.preview_asset);
  const width = typeof preview?.image_width === "number" ? preview.image_width : 0;
  const height = typeof preview?.image_height === "number" ? preview.image_height : 0;

  return width > 0 && height > 0 ? Math.min(IMAGE_MAX_TOKENS, Math.ceil((width * height) / IMAGE_PIXELS_PER_TOKEN)) : 0;
};

const estimateDocumentTokens = (file: Record<string, unknown>): number => {
  const document = asRecord(file.document_asset);
  const pageCount = typeof document?.page_count === "number" ? document.page_count : 0;

  return pageCount > 0 ? pageCount * DOCUMENT_TOKENS_PER_PAGE : 0;
};

const estimateFileTokens = (file: unknown): number => {
  const data = asRecord(file);
  if (!data) {
    return 0;
  }

  if (data.file_kind === "image") {
    return estimateImageTokens(data);
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

const collectTextFromContent = (content: unknown): CountedText[] => {
  const data = asRecord(content);
  if (!data) {
    return [];
  }

  const pieces: CountedText[] = [];
  const text = asString(data.text);
  const thinking = asString(data.thinking);

  if (text) {
    pieces.push({ text });
  }

  // Extended thinking tokens are billed as input tokens on subsequent turns
  if (thinking) {
    pieces.push({ text: thinking });
  }

  if (data.input !== undefined) {
    pieces.push({ text: JSON.stringify(data.input) });
  }

  if (data.content !== undefined) {
    if (Array.isArray(data.content)) {
      // Tool result content is in the context window and costs real tokens
      data.content.forEach((nested) => {
        pieces.push(...collectTextFromContent(nested));
      });
    } else {
      pieces.push(...collectTextFromContent(data.content));
    }
  }

  return pieces;
};

const getMessageText = (message: ClaudeMessage): CountedText[] => {
  const pieces: CountedText[] = [];

  asArray(message.content).forEach((content) => {
    pieces.push(...collectTextFromContent(content));
  });

  asArray(message.attachments).forEach((attachment) => {
    const data = asRecord(attachment);
    const extracted = asString(data?.extracted_content);
    if (extracted) {
      pieces.push({ text: extracted });
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

const estimateMessageTokens = (message: ClaudeMessage, debugTexts: string[]): { tokens: number; lengthIsEstimate: boolean; hasToolUse: boolean } => {
  let tokens = MESSAGE_OVERHEAD_TOKENS + estimateToolResultOverhead(message);
  let lengthIsEstimate = false;
  const textPieces = getMessageText(message);

  textPieces.forEach(({ text }) => {
    tokens += countClaudeTokens(text);
    debugTexts.push(text);
  });

  asArray(message.files_v2).forEach((file) => {
    tokens += estimateFileTokens(file);
  });

  asArray(message.sync_sources).forEach((sync) => {
    tokens += estimateSyncTokens(sync);
    lengthIsEstimate = true;
  });

  const rawContent = asArray(message.content);
  const hasToolUse = rawContent.some((item) => asRecord(item)?.type === "tool_use");

  if (
    rawContent.some((item) => asRecord(item)?.type === "tool_result") ||
    rawContent.some((item) => asRecord(item)?.name === "web_search")
  ) {
    lengthIsEstimate = true;
  }

  return { tokens, lengthIsEstimate, hasToolUse };
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
  let currentContextTokens = BASE_CONVERSATION_OVERHEAD_TOKENS;
  let lengthIsEstimate = false;
  let cachedPrefixTokens = 0;
  const cache = getCacheBoundary(messages);
  let cacheIsActive = Boolean(cache.cacheEndId);
  const messageTokenInfos: MessageTokenInfo[] = [];

  messages.forEach((message) => {
    const result = estimateMessageTokens(message, debugTexts);
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
  } else if (projectUuid) {
    lengthIsEstimate = true;
  }

  const compoundedInputTokens = calculateCompoundedInputTokens(messageTokenInfos);
  const displayedUsageTokens = compoundedInputTokens || currentContextTokens;
  const biasedCurrentContextTokens = applyConservativeTokenBias(currentContextTokens);
  const biasedDisplayedUsageTokens = applyConservativeTokenBias(displayedUsageTokens);

  return {
    chatUsage: {
      estimatedTokens: biasedDisplayedUsageTokens,
      currentContextTokens: biasedCurrentContextTokens,
      compoundedInputTokens: Math.round(compoundedInputTokens),
      visibleMessageCount: messages.length,
      updatedAt: now,
    },
    lengthIsEstimate,
    cachedPrefixTokens,
    cacheExpiresAt: cache.cacheExpiresAt,
    debugTexts,
  };
};
