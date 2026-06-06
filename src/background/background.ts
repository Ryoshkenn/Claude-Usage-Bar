import { MESSAGE_TYPES, STORAGE_KEYS } from "../shared/constants";
import { buildChatUsageFromConversationPayload } from "../shared/claudeConversationContext";
import { extractOrganizationId, normalizeUsagePayload, parseRunBudgetText } from "../shared/claudeUsageApi";
import { getEffectiveModelWeight } from "../shared/modelUsage";
import { appendUsageHistoryEntry, getStorage, saveChatUsage, saveRealUsageSnapshot } from "../shared/storage";
import type { ApiUsageResponse, ConversationContextResponse, RealUsageSnapshot, ThinkingLevel } from "../shared/types";

// Per-message context the content script attaches to a usage refresh, since the
// background worker has no DOM access to the active model, thinking level, or
// message count.
interface UsageRefreshSample {
  modelLabel?: string;
  thinkingLevel?: ThinkingLevel;
  messageCount?: number;
}

const CLAUDE_API_ORIGIN = "https://claude.ai";
// Routine (automation) usage lives on its own endpoint, not under /usage, and is
// not keyed by organization. Claude's own UI only requests it from the Usage
// settings tab, so we fetch it ourselves alongside the usage snapshot.
const ROUTINES_RUN_BUDGET_URL = `${CLAUDE_API_ORIGIN}/v1/code/routines/run-budget`;
// The /v1 gateway (unlike the /api web routes) requires these headers to route
// and to scope the lookup to the org — without x-organization-uuid it 404s with
// an empty resource_id. The session cookie still rides along via credentials.
const ROUTINES_HEADERS: Record<string, string> = {
  "anthropic-client-platform": "web_claude_ai",
  "anthropic-version": "2023-06-01",
  "anthropic-beta": "ccr-triggers-2026-01-30",
};
const FETCH_COOLDOWN_MS = 60_000;

let inFlightUsageRequest: Promise<ApiUsageResponse> | null = null;
const inFlightConversationRequests = new Map<string, Promise<ConversationContextResponse>>();

const jsonHeaders = {
  Accept: "application/json",
};

const isFresh = (snapshot?: RealUsageSnapshot): boolean =>
  Boolean(snapshot && Date.now() - snapshot.capturedAt < FETCH_COOLDOWN_MS);

const getJson = async (url: string, extraHeaders?: Record<string, string>): Promise<unknown> => {
  const response = await fetch(url, {
    method: "GET",
    credentials: "include",
    headers: { ...jsonHeaders, ...extraHeaders },
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error(`Please log in to Claude.ai (${response.status})`);
  }

  if (!response.ok) {
    throw new Error(`Claude usage request failed (${response.status})`);
  }

  return response.json();
};

const getCachedOrganizationId = async (): Promise<string | null> => {
  const data = await chrome.storage.local.get(STORAGE_KEYS.organizationId);
  return typeof data[STORAGE_KEYS.organizationId] === "string" ? data[STORAGE_KEYS.organizationId] : null;
};

const getOrganizationId = async (): Promise<string> => {
  const cached = await getCachedOrganizationId();
  if (cached) {
    return cached;
  }

  const payload = await getJson(`${CLAUDE_API_ORIGIN}/api/organizations`);
  const organizationId = extractOrganizationId(payload);

  if (!organizationId) {
    throw new Error("Could not find Claude organization id");
  }

  await chrome.storage.local.set({ [STORAGE_KEYS.organizationId]: organizationId });
  return organizationId;
};

// Routine usage is best-effort: a failure here must not sink the whole usage
// snapshot, so swallow errors and just report no routines count.
const getRoutinesText = async (organizationId: string): Promise<string | undefined> => {
  try {
    const payload = await getJson(ROUTINES_RUN_BUDGET_URL, {
      ...ROUTINES_HEADERS,
      "x-organization-uuid": organizationId,
    });
    return parseRunBudgetText(payload);
  } catch {
    return undefined;
  }
};

const getUsageMetrics = async (organizationId: string): Promise<RealUsageSnapshot> => {
  const [payload, routinesText] = await Promise.all([
    getJson(`${CLAUDE_API_ORIGIN}/api/organizations/${organizationId}/usage`),
    getRoutinesText(organizationId),
  ]);
  const snapshot = normalizeUsagePayload(payload);

  if (!snapshot) {
    throw new Error("Claude usage response did not include supported metrics");
  }

  if (routinesText) {
    snapshot.routinesText = routinesText;
  }

  return snapshot;
};

const fetchApiUsage = async (force = false, sample?: UsageRefreshSample): Promise<ApiUsageResponse> => {
  const current = await getStorage();
  if (!force && isFresh(current.realUsageSnapshot)) {
    return { ok: true, snapshot: current.realUsageSnapshot };
  }

  try {
    const organizationId = await getOrganizationId();
    const snapshot = await getUsageMetrics(organizationId);
    // The /usage payload has no model, so carry the model forward (from this
    // refresh's sample, else the last known snapshot) instead of wiping it.
    const modelLabel = sample?.modelLabel ?? current.realUsageSnapshot?.modelLabel;
    if (modelLabel) {
      snapshot.modelLabel = modelLabel;
    }
    const thinkingLevel = sample?.thinkingLevel ?? current.realUsageSnapshot?.thinkingLevel;
    if (thinkingLevel) {
      snapshot.thinkingLevel = thinkingLevel;
    }
    await saveRealUsageSnapshot(snapshot);
    await appendUsageHistoryEntry({
      capturedAt: snapshot.capturedAt,
      sessionUsedPercent: snapshot.percentageUsed,
      sessionResetsAt: snapshot.sessionResetsAt,
      ...(typeof sample?.messageCount === "number"
        ? { cumulativeMessageCount: sample.messageCount }
        : {}),
      ...(modelLabel
        ? { modelWeight: getEffectiveModelWeight(modelLabel, thinkingLevel), modelLabel }
        : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
      ...(current.settings.weeklyMetricsEnabled !== false
        ? {
            weeklyUsedPercent: snapshot.weeklyAllModelsPercentageUsed,
            weeklyResetsAt: snapshot.weeklyAllModelsResetsAt,
          }
        : {}),
    });
    return { ok: true, snapshot };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Claude usage error";

    if (/401|403|organization id/i.test(message)) {
      await chrome.storage.local.remove(STORAGE_KEYS.organizationId);
    }

    return { ok: false, error: message };
  }
};

const fetchConversationContext = async (conversationId: string): Promise<ConversationContextResponse> => {
  try {
    const organizationId = await getOrganizationId();
    const payload = await getJson(
      `${CLAUDE_API_ORIGIN}/api/organizations/${organizationId}/chat_conversations/${conversationId}?tree=true&rendering_mode=messages&render_all_tools=true`,
    );
    const result = buildChatUsageFromConversationPayload(payload);
    const chatUsage = {
      ...result.chatUsage,
      source: "conversation_api" as const,
      cachedPrefixTokens: result.cachedPrefixTokens,
      cacheExpiresAt: result.cacheExpiresAt,
      lengthIsEstimate: result.lengthIsEstimate,
      isRefreshingContext: false,
    };

    await saveChatUsage(chatUsage);
    return { ok: true, chatUsage };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Claude conversation error";

    if (/401|403|organization id/i.test(message)) {
      await chrome.storage.local.remove(STORAGE_KEYS.organizationId);
    }

    return { ok: false, error: message };
  }
};

chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.get(STORAGE_KEYS.installedAt).then((data) => {
    if (!data[STORAGE_KEYS.installedAt]) {
      void chrome.storage.local.set({ [STORAGE_KEYS.installedAt]: Date.now() });
    }
  });
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const data = message as
    | {
        type?: unknown;
        force?: unknown;
        conversationId?: unknown;
        modelLabel?: unknown;
        thinkingLevel?: unknown;
        messageCount?: unknown;
      }
    | undefined;

  if (!data) {
    return false;
  }

  if (data.type === MESSAGE_TYPES.fetchApiUsage) {
    const sample: UsageRefreshSample = {
      modelLabel: typeof data.modelLabel === "string" ? data.modelLabel : undefined,
      thinkingLevel: typeof data.thinkingLevel === "string" ? (data.thinkingLevel as ThinkingLevel) : undefined,
      messageCount: typeof data.messageCount === "number" ? data.messageCount : undefined,
    };
    inFlightUsageRequest ??= fetchApiUsage(Boolean(data.force), sample).finally(() => {
      inFlightUsageRequest = null;
    });

    void inFlightUsageRequest.then(sendResponse);
    return true;
  }

  if (data.type === MESSAGE_TYPES.fetchConversationContext && typeof data.conversationId === "string") {
    const key = data.conversationId;
    let request = inFlightConversationRequests.get(key);
    if (!request) {
      request = fetchConversationContext(key).finally(() => {
        inFlightConversationRequests.delete(key);
      });
      inFlightConversationRequests.set(key, request);
    }

    void request.then(sendResponse);
    return true;
  }

  return false;
});
