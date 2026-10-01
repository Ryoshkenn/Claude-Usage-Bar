import { MESSAGE_TYPES, STORAGE_KEYS } from "../shared/constants";
import { buildChatUsageFromConversationPayload } from "../shared/claudeConversationContext";
import { extractOrganizationId, normalizeUsagePayload } from "../shared/claudeUsageApi";
import { getEffectiveModelWeight } from "../shared/modelUsage";
import { appendUsageHistoryEntry, getStorage, saveChatUsage, saveRealUsageSnapshot } from "../shared/storage";
import type { ApiUsageResponse, ConversationContextResponse, RealUsageSnapshot, ThinkingLevel } from "../shared/types";
import { setLanguage, t } from "../shared/i18n";
import {
  SESSION_ALARM,
  WEEKLY_ALARM,
  announceReset,
  buildBannerCopy,
  scheduleResetAlarms,
} from "./resetNotifier";

// Per-message context the content script attaches to a usage refresh, since the
// background worker has no DOM access to the active model, thinking level, or
// message count.
interface UsageRefreshSample {
  modelLabel?: string;
  thinkingLevel?: ThinkingLevel;
  messageCount?: number;
}

const CLAUDE_API_ORIGIN = "https://claude.ai";
const FETCH_COOLDOWN_MS = 60_000;
export const TEST_BANNER_DELAY_MS = 5_000;

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

const getUsageMetrics = async (organizationId: string): Promise<RealUsageSnapshot> => {
  const payload = await getJson(`${CLAUDE_API_ORIGIN}/api/organizations/${organizationId}/usage`);
  const snapshot = normalizeUsagePayload(payload);

  if (!snapshot) {
    throw new Error("Claude usage response did not include supported metrics");
  }

  return snapshot;
};

const fetchApiUsage = async (
  force = false,
  sample?: UsageRefreshSample,
  skipHistory = false,
): Promise<ApiUsageResponse> => {
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
    // Idle/auto refreshes (visibility, poll, reset-rollover) only freshen the
    // snapshot; they must not append history, or these unattributed samples would
    // flood the 100-entry cap and evict the message-bearing entries the
    // model-aware projection learns from.
    if (!skipHistory && current.settings.weeklyMetricsEnabled !== false) {
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
        weeklyUsedPercent: snapshot.weeklyAllModelsPercentageUsed,
        weeklyResetsAt: snapshot.weeklyAllModelsResetsAt,
      });
    }
    // Every fetch re-arms the alarms, so the schedule tracks the server's reset
    // times instead of drifting off a stale snapshot.
    await scheduleResetAlarms(snapshot);
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
  void rearmFromStoredSnapshot();
});

// Alarms survive a worker restart but not a browser restart in every case, so
// re-arm from the last snapshot whenever Chrome brings us back up.
chrome.runtime.onStartup?.addListener(() => {
  void rearmFromStoredSnapshot();
});

async function rearmFromStoredSnapshot(): Promise<void> {
  const current = await getStorage();
  setLanguage(current.settings.language);
  await scheduleResetAlarms(current.realUsageSnapshot);
}

// The alarm only tells us the clock hit the reset time. Confirm against the API
// before claiming a reset happened, so a server-side extension of the window
// doesn't produce a wrong "you're back to zero" banner.
chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name !== SESSION_ALARM && alarm.name !== WEEKLY_ALARM) {
    return;
  }

  const kind = alarm.name === SESSION_ALARM ? "session" : "weekly";

  void (async () => {
    const before = await getStorage();
    setLanguage(before.settings.language);
    const previousResetAt =
      kind === "session"
        ? before.realUsageSnapshot?.sessionResetsAt
        : before.realUsageSnapshot?.weeklyAllModelsResetsAt;
    // How much of the closing window was actually spent. Read from the snapshot
    // taken BEFORE the confirming fetch — after the fetch this is already the new
    // window's (zero) usage, which would suppress every banner.
    const usedPercentBeforeReset =
      kind === "session"
        ? before.realUsageSnapshot?.percentageUsed
        : before.realUsageSnapshot?.weeklyAllModelsPercentageUsed;

    const result = await fetchApiUsage(true, undefined, true);
    if (!result.ok || !result.snapshot) {
      // Signed out or offline. Re-arm a little later rather than dropping the
      // rollover on the floor entirely.
      await chrome.alarms.create(alarm.name, { when: Date.now() + 10 * 60_000 });
      return;
    }

    const nextResetAt =
      kind === "session"
        ? result.snapshot.sessionResetsAt
        : result.snapshot.weeklyAllModelsResetsAt;

    // A genuine rollover moves the reset timestamp forward.
    const rolledOver =
      typeof previousResetAt === "number" &&
      (typeof nextResetAt !== "number" || nextResetAt > previousResetAt);

    if (!rolledOver) {
      await scheduleResetAlarms(result.snapshot);
      return;
    }

    const { settings } = await getStorage();
    await announceReset(kind, previousResetAt, buildBannerCopy(kind, t), settings, {
      usedPercentBeforeReset,
    });
  })();
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const data = message as
    | {
        type?: unknown;
        force?: unknown;
        skipHistory?: unknown;
        conversationId?: unknown;
        modelLabel?: unknown;
        thinkingLevel?: unknown;
        messageCount?: unknown;
        kind?: unknown;
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
    inFlightUsageRequest ??= fetchApiUsage(Boolean(data.force), sample, Boolean(data.skipHistory)).finally(() => {
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

  // Content scripts can't call chrome.permissions.request(), so the settings
  // panel routes the all-sites grant through a small extension window.
  if (data.type === MESSAGE_TYPES.requestAllSites) {
    void chrome.windows.create({
      url: chrome.runtime.getURL("src/grant/grant.html"),
      type: "popup",
      width: 460,
      height: 280,
    });
    sendResponse({ ok: true });
    return true;
  }

  // The popup toggles banner scope; re-arm so a freshly enabled banner doesn't
  // wait for the next usage fetch to get its alarms.
  if (data.type === MESSAGE_TYPES.syncResetBanner) {
    void rearmFromStoredSnapshot().then(() => sendResponse({ ok: true }));
    return true;
  }

  // Test button: fire the real delivery path after a delay long enough to close
  // the popup and switch tabs. chrome.alarms can't do this — MV3 clamps alarms
  // to 30s minimum — but a 5s setTimeout comfortably fits inside the worker's
  // idle timeout, and the message itself just reset that timer.
  if (data.type === MESSAGE_TYPES.testResetBanner) {
    const kind = data.kind === "weekly" ? "weekly" : "session";
    setTimeout(() => {
      void (async () => {
        const { settings } = await getStorage();
        setLanguage(settings.language);
        await announceReset(kind, Date.now(), buildBannerCopy(kind, t), settings, { force: true });
      })();
    }, TEST_BANNER_DELAY_MS);
    sendResponse({ ok: true, delayMs: TEST_BANNER_DELAY_MS });
    return true;
  }

  return false;
});
