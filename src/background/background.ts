import { MESSAGE_TYPES, STORAGE_KEYS } from "../shared/constants";
import { extractOrganizationId, normalizeUsagePayload } from "../shared/claudeUsageApi";
import { getStorage, saveRealUsageSnapshot } from "../shared/storage";
import type { ApiUsageResponse, RealUsageSnapshot } from "../shared/types";

const CLAUDE_API_ORIGIN = "https://claude.ai";
const FETCH_COOLDOWN_MS = 60_000;

let inFlightUsageRequest: Promise<ApiUsageResponse> | null = null;

const jsonHeaders = {
  Accept: "application/json",
};

const isFresh = (snapshot?: RealUsageSnapshot): boolean =>
  Boolean(snapshot && Date.now() - snapshot.capturedAt < FETCH_COOLDOWN_MS);

const hasClaudeSessionCookie = async (): Promise<boolean> => {
  const cookies = await chrome.cookies.getAll({ domain: "claude.ai" });
  return cookies.length > 0;
};

const getJson = async (url: string): Promise<unknown> => {
  const response = await fetch(url, {
    method: "GET",
    credentials: "include",
    headers: jsonHeaders,
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

const fetchApiUsage = async (force = false): Promise<ApiUsageResponse> => {
  const current = await getStorage();
  if (!force && isFresh(current.realUsageSnapshot)) {
    return { ok: true, snapshot: current.realUsageSnapshot };
  }

  if (!(await hasClaudeSessionCookie())) {
    return { ok: false, error: "Please log in to Claude.ai" };
  }

  try {
    const organizationId = await getOrganizationId();
    const snapshot = await getUsageMetrics(organizationId);
    await saveRealUsageSnapshot(snapshot);
    return { ok: true, snapshot };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Claude usage error";

    if (/401|403|organization id/i.test(message)) {
      await chrome.storage.local.remove(STORAGE_KEYS.organizationId);
    }

    return { ok: false, error: message };
  }
};

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const data = message as { type?: unknown; force?: unknown } | undefined;

  if (!data || data.type !== MESSAGE_TYPES.fetchApiUsage) {
    return false;
  }

  inFlightUsageRequest ??= fetchApiUsage(Boolean(data.force)).finally(() => {
    inFlightUsageRequest = null;
  });

  void inFlightUsageRequest.then(sendResponse);
  return true;
});
