import React from "react";
import { createRoot } from "react-dom/client";
import { CLAUDE_ORIGIN, MESSAGE_TYPES, STORAGE_KEYS } from "../shared/constants";
import {
  appendDailyModelUsage,
  getStorage,
  saveChatUsage,
  saveDailyUsage,
  saveRealUsageSnapshot,
  updateSettings,
} from "../shared/storage";
import { normalizeModelFamily } from "../shared/modelUsage";
import { setLanguage } from "../shared/i18n";
import type { ConversationContextResponse, RealUsageSnapshot, StorageShape, ThinkingLevel } from "../shared/types";
import { readClaudeDomSnapshot, readThinkingEnabled, resolveEffectiveThinkingLevel } from "./claudeDom";
import { CacheTimer, ContentApp } from "./ContentApp";
import { OnboardingTour } from "./OnboardingTour";
import { findComposer, findComposerInsertionPoint, findDesignComposer, findDesignInsertionPoint } from "./composerMount";
import {
  hasMeaningfulChatUsageChange,
  hasMeaningfulDailyUsageChange,
  mutationsContainPageChanges,
} from "./contentLifecycle";
import "./pageOverrides.css";
import { syncMessageRailTheme, tickMessageRail } from "./messageRail";
import { initSettingsPage, openUsageBarSettings, tickSettingsPage } from "./settingsPage";
import "./styles.css";
import { buildChatUsage, deriveDailyIncrement, rollDailyUsageForward } from "./usageEstimator";
import { messageToSnapshot } from "./usageProbeBridge";

// Each content-script instance gets a unique ID. When a newer instance starts
// it writes its ID to the page; older instances see they're displaced and stop.
const INSTANCE_ATTR = "data-cub-instance";
const HOST_ATTR = "data-cub-host-instance";
const THEME_SYNC_INTERVAL_MS = 500;
const myInstanceId = `${Date.now()}-${Math.random()}`;
const isActiveInstance = () =>
  document.documentElement.getAttribute(INSTANCE_ATTR) === myInstanceId;

let storageState: StorageShape | null = null;
let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLElement | null = null;
let updateTimer: number | undefined;
let mountedComposer: HTMLElement | null = null;
let lastSentCount = 0;
let lastApiRefreshUrl = "";
let lastConversationContextUrl = "";
let lastSyncedTheme: "light" | "dark" | null = null;
// Sticky thinking on/off state. The effort-menu switch — the only on/off
// authority — is readable solely while the menu is open, so we remember its last
// value across DOM reads. undefined until the switch has ever been seen.
let lastKnownThinkingEnabled: boolean | undefined;

// Cache timer state
let cacheTimerRoot: ReturnType<typeof createRoot> | null = null;
let cacheTimerHost: HTMLElement | null = null;
let cacheTimerParent: HTMLElement | null = null;
let streamingEndedAt: number | null = null;
let wasStreaming = false;

// Onboarding tour state
let tourRoot: ReturnType<typeof createRoot> | null = null;
let tourHost: HTMLDivElement | null = null;

const injectPageProbe = () => {
  if (location.origin !== CLAUDE_ORIGIN) {
    return;
  }

  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("pageProbe.js");
  script.async = false;
  script.onload = () => script.remove();
  (document.documentElement || document.head).appendChild(script);
};

const isColorLight = (value: string): boolean | null => {
  const match = value.match(/rgba?\((\d+),?\s+(\d+),?\s+(\d+)(?:,?\s+([0-9.]+))?\)/i);
  if (!match) {
    return null;
  }

  const alpha = match[4] === undefined ? 1 : Number(match[4]);
  if (!Number.isFinite(alpha) || alpha < 0.2) {
    return null;
  }

  const red = Number(match[1]);
  const green = Number(match[2]);
  const blue = Number(match[3]);
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luminance > 0.62;
};

const readElementLightMode = (element: Element | null): boolean | null => {
  let current = element instanceof HTMLElement ? element : element?.parentElement ?? null;

  while (current) {
    const light = isColorLight(getComputedStyle(current).backgroundColor);
    if (light !== null) return light;
    current = current.parentElement;
  }

  return null;
};

const readComputedLightMode = (): boolean | null => {
  const selectors = [
    "main",
    'form textarea:not(#conversation-preferences), form [contenteditable="true"][role="textbox"], form [role="textbox"]',
    "body",
    "html",
  ];
  const centerElement = document.elementFromPoint(
    Math.max(0, Math.floor(window.innerWidth / 2)),
    Math.max(0, Math.floor(window.innerHeight / 2)),
  );
  const candidates = [
    centerElement,
    ...selectors.map((selector) => document.querySelector<HTMLElement>(selector)),
  ];

  for (const element of candidates) {
    const light = readElementLightMode(element);
    if (light !== null) return light;
  }

  return null;
};

// Detect whether Claude's UI is currently in light mode.
// Checks Claude's explicit theme signal first, then actual UI colors, then OS preference.
export const isLightMode = (): boolean => {
  const el = document.documentElement;
  if (el.classList.contains("dark") || el.getAttribute("data-theme") === "dark" || el.getAttribute("data-color-scheme") === "dark") {
    return false;
  }
  if (el.classList.contains("light") || el.getAttribute("data-theme") === "light" || el.getAttribute("data-color-scheme") === "light") {
    return true;
  }
  const computed = readComputedLightMode();
  if (computed !== null) {
    return computed;
  }
  return !window.matchMedia("(prefers-color-scheme: dark)").matches;
};

const isDesignPage = (): boolean =>
  location.pathname === "/design" ||
  location.pathname.startsWith("/design/") ||
  location.pathname === "/designs" ||
  location.pathname.startsWith("/designs/");
const isNewChatPage = (): boolean => location.pathname === "/new" || location.pathname === "/new/";

// After the extension is reloaded/updated, this content script is orphaned but its
// timers and observers keep firing; any chrome.* call then throws "Extension context
// invalidated". chrome.runtime.id goes undefined on invalidation, so this gates the
// recurring chrome callers and lets the orphan idle harmlessly until the page unloads.
const extensionAlive = (): boolean => Boolean(chrome.runtime?.id);

const syncTheme = () => {
  const light = isLightMode();
  const theme = light ? "light" : "dark";
  host?.classList.toggle("cub-theme-light", light);
  cacheTimerHost?.classList.toggle("cub-theme-light", light);
  syncMessageRailTheme(light);
  if (theme !== lastSyncedTheme && extensionAlive()) {
    lastSyncedTheme = theme;
    void chrome.storage.local.set({ [STORAGE_KEYS.detectedTheme]: light ? "light" : "dark" });
  }
};

const ensureHost = () => {
  if (host && root) {
    return;
  }

  host = document.createElement("div");
  host.id = "claude-usage-bar-root";
  host.setAttribute(HOST_ATTR, myInstanceId);
  host.classList.toggle("cub-design", isDesignPage());
  // Apply theme class before first render so there is no flash
  syncTheme();
  root = createRoot(host);
};

const removeStaleHosts = () => {
  document.querySelectorAll<HTMLElement>("#claude-usage-bar-root").forEach((element) => {
    if (element !== host) {
      element.remove();
    }
  });
};

const removeComposerHost = () => {
  root?.render(null);
  host?.remove();
  mountedComposer?.classList.remove("cub-composer-host");
  mountedComposer = null;
  removeStaleHosts();
};

// Selector for Claude's stop-generation button (appears while streaming)
const STOP_BTN_SELECTOR = 'button[aria-label*="Stop"]';

const findChatMenuParent = (): HTMLElement | null => {
  // Anchor to the title group's *parent*, not chat-title-split itself: clicking
  // the title makes Claude tear down and rebuild chat-title-split, which would
  // destroy a host injected inside it (and the re-mount races into the wrong
  // slot). The parent survives that teardown. The host's CSS `order:1` keeps it
  // right of the title. (Was [data-testid="chat-menu-trigger"]'s parent before
  // Claude's header rework.)
  return document.querySelector<HTMLElement>('[data-testid="chat-title-split"]')?.parentElement ?? null;
};

const mountCacheTimerInHeader = (): boolean => {
  const parent = findChatMenuParent();
  if (!parent) {
    return false;
  }

  if (parent !== cacheTimerParent) {
    cacheTimerHost?.remove();
    cacheTimerHost = null;
    cacheTimerRoot = null;
    cacheTimerParent = parent;
  }

  if (!cacheTimerHost) {
    cacheTimerHost = document.createElement("span");
    cacheTimerHost.id = "claude-cache-timer-host";
    cacheTimerHost.classList.toggle("cub-theme-light", isLightMode());
    parent.appendChild(cacheTimerHost);
    cacheTimerRoot = createRoot(cacheTimerHost);
  }

  return true;
};

const removeCacheTimer = () => {
  cacheTimerRoot?.render(null);
  cacheTimerHost?.remove();
  cacheTimerHost = null;
  cacheTimerRoot = null;
  cacheTimerParent = null;
};

const renderCacheTimer = () => {
  if (storageState && storageState.settings.showCacheTimer === false) {
    removeCacheTimer();
    return;
  }
  if (!mountCacheTimerInHeader()) {
    return;
  }
  cacheTimerRoot?.render(
    <React.StrictMode>
      <CacheTimer cacheExpiresAt={storageState?.chatUsage.cacheExpiresAt} fallbackStartedAt={streamingEndedAt} />
    </React.StrictMode>,
  );
};

const ensureTourHost = () => {
  if (tourHost && document.body.contains(tourHost)) return;
  tourHost = document.createElement("div");
  tourHost.id = "claude-usage-bar-tour";
  document.body.appendChild(tourHost);
  tourRoot = createRoot(tourHost);
};

const renderTour = () => {
  if (!storageState || !isActiveInstance()) return;
  ensureTourHost();
  const showTour = storageState.settings.hasSeenTour === false && isNewChatPage();
  tourRoot?.render(
    <React.StrictMode>
      {showTour ? (
        <OnboardingTour
          onComplete={() => {
            void updateSettings({ hasSeenTour: true });
          }}
        />
      ) : null}
    </React.StrictMode>,
  );
};

const checkStreamingState = () => {
  const isStreaming = !!document.querySelector(STOP_BTN_SELECTOR);
  if (wasStreaming && !isStreaming) {
    streamingEndedAt = Date.now();
    renderCacheTimer();
  }
  wasStreaming = isStreaming;
};

const mountHostInComposer = (): boolean => {
  ensureHost();
  if (!host) {
    return false;
  }

  const onDesign = isDesignPage();
  const composer = onDesign ? findDesignComposer() : findComposer();
  if (!composer) {
    host.remove();
    mountedComposer?.classList.remove("cub-composer-host");
    mountedComposer = null;
    return false;
  }

  if (mountedComposer !== composer) {
    mountedComposer?.classList.remove("cub-composer-host");
    mountedComposer = composer;
    mountedComposer.classList.add("cub-composer-host");
  }

  removeStaleHosts();

  if (host.parentElement !== composer) {
    const insertionPoint = onDesign
      ? findDesignInsertionPoint(composer)
      : findComposerInsertionPoint(composer);
    composer.insertBefore(host, insertionPoint);
  }

  return true;
};

const render = () => {
  if (!storageState || !isActiveInstance()) {
    return;
  }
  renderCacheTimer();
  if (!storageState.settings.showOverlay) {
    removeComposerHost();
    renderTour();
    return;
  }
  if (!mountHostInComposer()) {
    renderTour();
    return;
  }
  const effectiveSettings = isDesignPage()
    ? {
        ...storageState.settings,
        barMetric: "session" as const,
        showWheel: false,
        showClipboard: false,
        ringTarget: "hidden" as const,
      }
    : storageState.settings;
  root?.render(
    <React.StrictMode>
      <ContentApp
        settings={effectiveSettings}
        chatUsage={storageState.chatUsage}
        realUsageSnapshot={storageState.realUsageSnapshot}
        usageHistory={storageState.usageHistory}
        weeklyUsageMetrics={storageState.weeklyUsageMetrics}
      />
    </React.StrictMode>,
  );
  renderTour();
  syncTheme();
};

interface UsageRefreshSample {
  modelLabel?: string;
  thinkingLevel?: ThinkingLevel;
  messageCount?: number;
}

const requestApiUsageRefresh = (force = false, sample?: UsageRefreshSample, skipHistory = false) => {
  if (!extensionAlive()) return;
  chrome.runtime.sendMessage(
    {
      type: MESSAGE_TYPES.fetchApiUsage,
      force,
      skipHistory,
      modelLabel: sample?.modelLabel,
      thinkingLevel: sample?.thinkingLevel,
      messageCount: sample?.messageCount,
    },
    () => {
      void chrome.runtime.lastError;
    },
  );
};

// The API snapshot is otherwise only refreshed on message-send / navigation, so a
// snapshot captured before a limit window rolls over stays stale — commonly
// showing a maxed-out percentage long after the window actually reset (the user
// then "fixes" it by navigating to settings, which forces a refresh). Self-heal:
// when any tracked reset time has passed, force a fresh fetch; otherwise issue a
// gentle refresh the background's freshness cooldown collapses to a no-op when
// recent. Either way skipHistory=true — these aren't user-attributable samples.
const USAGE_POLL_INTERVAL_MS = 120_000;

const maybeRefreshUsage = () => {
  if (!storageState || document.visibilityState !== "visible") {
    return;
  }
  const snapshot = storageState.realUsageSnapshot;
  const now = Date.now();
  const resetTimes = [
    snapshot?.sessionResetsAt,
    snapshot?.weeklyAllModelsResetsAt,
    ...(snapshot?.weeklyScopedLimits?.map((limit) => limit.resetsAt) ?? []),
  ];
  const resetPassed = Boolean(
    snapshot && resetTimes.some((t) => typeof t === "number" && now > t && snapshot.capturedAt <= t),
  );
  requestApiUsageRefresh(resetPassed, undefined, true);
};

const getConversationId = (): string | null => location.pathname.match(/\/chat\/([^/?]+)/)?.[1] ?? null;

const requestConversationContextRefresh = (conversationId: string) => {
  if (!extensionAlive()) return;
  chrome.runtime.sendMessage(
    { type: MESSAGE_TYPES.fetchConversationContext, conversationId },
    (response: ConversationContextResponse | undefined) => {
      void chrome.runtime.lastError;
      if (!storageState) {
        return;
      }

      if (!response?.ok || !response.chatUsage) {
        storageState = {
          ...storageState,
          chatUsage: {
            ...storageState.chatUsage,
            isRefreshingContext: false,
          },
        };
        void saveChatUsage(storageState.chatUsage);
        render();
        return;
      }

      storageState = {
        ...storageState,
        chatUsage: response.chatUsage,
      };

      render();
    },
  );
};

const refreshUsage = async () => {
  if (!storageState || !document.body) {
    return;
  }

  const snapshot = readClaudeDomSnapshot();
  // Resolve the effective thinking level from the always-visible composer level
  // and the (intermittently visible) effort-menu switch, carrying the last-seen
  // on/off state forward. undefined means "no fresh reading" — keep the stored value.
  const { level: detectedThinkingLevel, enabled: nextThinkingEnabled } = resolveEffectiveThinkingLevel(
    snapshot.thinkingLevel,
    snapshot.composerThinkingLevel,
    lastKnownThinkingEnabled,
  );
  lastKnownThinkingEnabled = nextThinkingEnabled;
  const now = new Date();
  const dailyUsage = rollDailyUsageForward(storageState.dailyUsage, snapshot.visibleSentCount, now);
  const chatUsage = buildChatUsage(snapshot.visibleMessageTexts, now.getTime());

  checkStreamingState();

  // Trigger a forced API refresh when a new message is sent or the URL changes (new chat).
  const currentUrl = location.href;
  const conversationId = getConversationId();
  const messageSent = snapshot.visibleSentCount > lastSentCount;
  const urlChanged = currentUrl !== lastApiRefreshUrl;

  if (urlChanged) {
    streamingEndedAt = null;
    renderCacheTimer();
  }

  if (messageSent || urlChanged) {
    lastSentCount = snapshot.visibleSentCount;
    lastApiRefreshUrl = currentUrl;
    // Attach the active model + cumulative message count so the background can
    // record a per-message usage sample alongside the fresh percentage.
    const sample: UsageRefreshSample = {
      modelLabel: snapshot.modelLabel ?? storageState.realUsageSnapshot?.modelLabel,
      thinkingLevel: detectedThinkingLevel ?? storageState.realUsageSnapshot?.thinkingLevel,
      messageCount: dailyUsage.messagesUsed,
    };
    // Delay after a message send so the server usage counter has time to update.
    window.setTimeout(() => requestApiUsageRefresh(true, sample), messageSent ? 2000 : 0);
  }

  if (conversationId && (currentUrl !== lastConversationContextUrl || messageSent)) {
    lastConversationContextUrl = currentUrl;
    storageState = {
      ...storageState,
      chatUsage: {
        ...storageState.chatUsage,
        source: "conversation_api",
        isRefreshingContext: true,
      },
    };
    await saveChatUsage(storageState.chatUsage);
    render();
    window.setTimeout(() => requestConversationContextRefresh(conversationId), messageSent ? 2500 : 500);
  }

  const shouldSaveDailyUsage = hasMeaningfulDailyUsageChange(storageState.dailyUsage, dailyUsage);
  const shouldSaveChatUsage = !conversationId && hasMeaningfulChatUsageChange(storageState.chatUsage, chatUsage);

  // Attribute newly sent messages for the popup chart. We only bucket a message
  // under a model when it's confidently detected from the claude.ai chat UI;
  // anything else (Claude Code, cowork, undetectable) falls into "unknown".
  // Failures here never block the usage snapshot.
  const dailyIncrement = deriveDailyIncrement(storageState.dailyUsage, dailyUsage);
  if (dailyIncrement > 0) {
    const modelLabel = snapshot.modelLabel ?? storageState.realUsageSnapshot?.modelLabel;
    void appendDailyModelUsage(normalizeModelFamily(modelLabel) ?? "unknown", dailyIncrement, undefined, now.getTime());
  }

  // Propagate the DOM-detected model + thinking level into the live snapshot so
  // model-aware estimates (messages left, projections) update in real time when
  // the user switches model or thinking level. The network probe only reports the
  // model sporadically, and the background API fetch carries neither, so the DOM
  // is the timely source. Preserve capturedAt so the background's freshness
  // cooldown is unaffected.
  const detectedModel = snapshot.modelLabel;
  const existingSnapshot = storageState.realUsageSnapshot;
  const modelChanged =
    Boolean(detectedModel) && existingSnapshot !== undefined && detectedModel !== existingSnapshot.modelLabel;
  // detectedThinkingLevel is undefined only when neither signal could be read —
  // keep the stored value rather than wiping it. Only a concrete, different level
  // counts as a change.
  const thinkingChanged =
    detectedThinkingLevel !== undefined &&
    existingSnapshot !== undefined &&
    detectedThinkingLevel !== existingSnapshot.thinkingLevel;
  const snapshotChanged = modelChanged || thinkingChanged;
  const nextRealUsageSnapshot =
    snapshotChanged && existingSnapshot
      ? {
          ...existingSnapshot,
          ...(modelChanged ? { modelLabel: detectedModel } : {}),
          ...(thinkingChanged ? { thinkingLevel: detectedThinkingLevel } : {}),
        }
      : existingSnapshot;

  storageState = {
    ...storageState,
    dailyUsage: shouldSaveDailyUsage ? dailyUsage : storageState.dailyUsage,
    chatUsage: shouldSaveChatUsage ? chatUsage : storageState.chatUsage,
    realUsageSnapshot: nextRealUsageSnapshot,
  };

  await Promise.all([
    snapshotChanged && nextRealUsageSnapshot ? saveRealUsageSnapshot(nextRealUsageSnapshot) : Promise.resolve(),
    shouldSaveDailyUsage ? saveDailyUsage(dailyUsage) : Promise.resolve(),
    shouldSaveChatUsage ? saveChatUsage(chatUsage) : Promise.resolve(),
  ]);
  render();
};

const scheduleRefresh = (records?: MutationRecord[]) => {
  if (!mutationsContainPageChanges(records)) return;
  if (!isActiveInstance()) return;
  // The Thinking switch unmounts when the effort menu closes, and flipping it can
  // close the menu before the debounced refreshUsage runs — so the toggle's new
  // state would never be read and we'd fall back to a stale value. Capture the
  // on/off state synchronously here (the mutation fires while the switch is still
  // in the DOM mid-toggle) so resolveEffectiveThinkingLevel sees the fresh state.
  const eagerThinkingEnabled = readThinkingEnabled();
  if (eagerThinkingEnabled !== undefined) {
    lastKnownThinkingEnabled = eagerThinkingEnabled;
  }
  window.clearTimeout(updateTimer);
  updateTimer = window.setTimeout(() => {
    if (!isActiveInstance()) return;
    tickSettingsPage();
    tickMessageRail();
    syncTheme();
    void refreshUsage();
  }, 350);
};

const handleRealUsageMessage = async (event: MessageEvent) => {
  const snapshot: RealUsageSnapshot | null = messageToSnapshot(event);
  if (!snapshot || !storageState) {
    return;
  }

  // Merge with existing snapshot so a partial probe result (e.g. only modelLabel)
  // doesn't wipe percentage data that came from the background API fetch.
  const merged: RealUsageSnapshot = {
    ...storageState.realUsageSnapshot,
    ...snapshot,
  };

  storageState = {
    ...storageState,
    realUsageSnapshot: merged,
  };
  await saveRealUsageSnapshot(merged);
  render();
};

const init = async () => {
  // Claim this instance as the active one. Any older content-script instances
  // will see their ID no longer matches and stop rendering/re-inserting.
  document.documentElement.setAttribute(INSTANCE_ATTR, myInstanceId);

  // Remove bars left by the now-displaced instance.
  removeStaleHosts();
  document.querySelectorAll("#claude-cache-timer-host").forEach((el) => el.remove());

  injectPageProbe();
  storageState = await getStorage();
  setLanguage(storageState.settings.language);
  initSettingsPage();
  tickMessageRail();
  render();
  syncTheme();

  // Capture initial state so the first refreshUsage call doesn't spuriously trigger a refresh.
  const initialSnapshot = readClaudeDomSnapshot();
  lastSentCount = initialSnapshot.visibleSentCount;
  lastApiRefreshUrl = location.href;

  requestApiUsageRefresh(isDesignPage());

  window.addEventListener("message", (event) => {
    void handleRealUsageMessage(event);
  });

  // The toolbar popup can't dispatch Claude's settings shortcut itself (wrong
  // context), so it asks the active content script to open our settings panel —
  // the same path the in-bar "→" shortcut uses.
  chrome.runtime.onMessage.addListener((message: { type?: string } | undefined) => {
    if (!isActiveInstance()) {
      return;
    }
    if (message?.type === MESSAGE_TYPES.openSettings) {
      void openUsageBarSettings();
    }
  });

  // Opened from the popup on a tab that wasn't already showing claude.ai: surface
  // the panel once the page is ready. Retry a few times because the keyboard
  // handler the shortcut relies on mounts a beat after the content script.
  void chrome.storage.local.get(STORAGE_KEYS.openSettingsOnLoad).then((data) => {
    const requestedAt = data[STORAGE_KEYS.openSettingsOnLoad];
    if (typeof requestedAt === "number" && Date.now() - requestedAt < 30_000) {
      void chrome.storage.local.remove(STORAGE_KEYS.openSettingsOnLoad);
      [1200, 2600, 4200].forEach((delay) =>
        window.setTimeout(() => void openUsageBarSettings(), delay),
      );
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !storageState) {
      return;
    }

    // Prompt clipboard manages its own storage; skip its changes to avoid flicker.
    const changeKeys = Object.keys(changes);
    if (changeKeys.length === 1 && changeKeys[0] === STORAGE_KEYS.prompts) {
      return;
    }

    storageState = {
      ...storageState,
      settings: (changes.settings?.newValue ?? storageState.settings) as StorageShape["settings"],
      dailyUsage: (changes.dailyUsage?.newValue ?? storageState.dailyUsage) as StorageShape["dailyUsage"],
      chatUsage: (changes.chatUsage?.newValue ?? storageState.chatUsage) as StorageShape["chatUsage"],
      realUsageSnapshot: (changes.realUsageSnapshot?.newValue ?? storageState.realUsageSnapshot) as RealUsageSnapshot | undefined,
      usageHistory: Array.isArray(changes.usageHistory?.newValue)
        ? (changes.usageHistory.newValue as StorageShape["usageHistory"])
        : storageState.usageHistory,
      weeklyUsageMetrics:
        (changes.weeklyUsageMetrics?.newValue as StorageShape["weeklyUsageMetrics"] | undefined) ??
        storageState.weeklyUsageMetrics,
    };
    setLanguage(storageState.settings.language);
    render();
  });

  // Watch Claude's theme attributes and style changes wherever the live switch applies them.
  const themeObserver = new MutationObserver(syncTheme);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "data-theme", "data-color-scheme", "style"],
  });
  themeObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ["class", "data-theme", "data-color-scheme", "style"],
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncTheme);
  window.setInterval(syncTheme, THEME_SYNC_INTERVAL_MS);

  // Keep the usage snapshot self-healing without a navigation: poll gently while
  // the tab is visible, and refresh immediately when the user returns to the tab.
  window.setInterval(maybeRefreshUsage, USAGE_POLL_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      maybeRefreshUsage();
    }
  });

  const observer = new MutationObserver(scheduleRefresh);
  // aria-checked is included so flipping the Thinking switch fires the observer
  // (and the eager capture in scheduleRefresh) while the effort menu is still open.
  observer.observe(document.documentElement, { attributes: true, childList: true, subtree: true, characterData: true, attributeFilter: ["class", "data-theme", "data-color-scheme", "style", "aria-checked"] });
  scheduleRefresh();
};

void init();
