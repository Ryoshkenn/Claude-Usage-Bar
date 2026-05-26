import React from "react";
import { createRoot } from "react-dom/client";
import { CLAUDE_ORIGIN, MESSAGE_TYPES } from "../shared/constants";
import {
  getStorage,
  saveChatUsage,
  saveDailyUsage,
  saveRealUsageSnapshot,
} from "../shared/storage";
import type { ConversationContextResponse, RealUsageSnapshot, StorageShape } from "../shared/types";
import { readClaudeDomSnapshot } from "./claudeDom";
import { CacheTimer, ContentApp } from "./ContentApp";
import {
  hasMeaningfulChatUsageChange,
  hasMeaningfulDailyUsageChange,
  mutationsContainPageChanges,
} from "./contentLifecycle";
import "./pageOverrides.css";
import { syncMessageRailTheme, tickMessageRail } from "./messageRail";
import { initSettingsPage, tickSettingsPage } from "./settingsPage";
import "./styles.css";
import { buildChatUsage, rollDailyUsageForward } from "./usageEstimator";
import { messageToSnapshot } from "./usageProbeBridge";

// Each content-script instance gets a unique ID. When a newer instance starts
// it writes its ID to the page; older instances see they're displaced and stop.
const INSTANCE_ATTR = "data-cub-instance";
const HOST_ATTR = "data-cub-host-instance";
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

// Cache timer state
let cacheTimerRoot: ReturnType<typeof createRoot> | null = null;
let cacheTimerHost: HTMLElement | null = null;
let cacheTimerParent: HTMLElement | null = null;
let streamingEndedAt: number | null = null;
let wasStreaming = false;

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

// Detect whether Claude's UI is currently in light mode.
// Checks Claude's explicit theme class/attribute first, falls back to the OS preference.
const isLightMode = (): boolean => {
  const el = document.documentElement;
  if (el.classList.contains("dark") || el.getAttribute("data-theme") === "dark" || el.getAttribute("data-color-scheme") === "dark") {
    return false;
  }
  if (el.classList.contains("light") || el.getAttribute("data-theme") === "light" || el.getAttribute("data-color-scheme") === "light") {
    return true;
  }
  return !window.matchMedia("(prefers-color-scheme: dark)").matches;
};

const syncTheme = () => {
  const light = isLightMode();
  host?.classList.toggle("cub-theme-light", light);
  syncMessageRailTheme(light);
};

const ensureHost = () => {
  if (host && root) {
    return;
  }

  host = document.createElement("div");
  host.id = "claude-usage-bar-root";
  host.setAttribute(HOST_ATTR, myInstanceId);
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

const findComposerControls = (): HTMLElement | null => {
  const addButton = document.querySelector<HTMLElement>(
    'button[aria-label="Add files, connectors, and more"]',
  );
  const controls = addButton?.closest<HTMLElement>(
    "div.relative.flex-1.flex.items-center.shrink.min-w-0.gap-1",
  );

  return controls ?? null;
};

const isPreferencesComposer = (element: HTMLElement): boolean =>
  Boolean(
    element.querySelector("#conversation-preferences") ||
      element.closest('[data-testid*="preferences"], [aria-label*="preferences" i]'),
  );

// Selector for Claude's stop-generation button (appears while streaming)
const STOP_BTN_SELECTOR = 'button[aria-label*="Stop"]';

const findChatMenuParent = (): HTMLElement | null => {
  const chatMenuBtn = document.querySelector<HTMLElement>('[data-testid="chat-menu-trigger"]');
  // The innermost flex group that contains the title rename button + separator + chevron
  return chatMenuBtn?.parentElement ?? null;
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
    parent.appendChild(cacheTimerHost);
    cacheTimerRoot = createRoot(cacheTimerHost);
  }

  return true;
};

const renderCacheTimer = () => {
  if (!mountCacheTimerInHeader()) {
    return;
  }
  cacheTimerRoot?.render(
    <React.StrictMode>
      <CacheTimer cacheExpiresAt={storageState?.chatUsage.cacheExpiresAt} fallbackStartedAt={streamingEndedAt} />
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

const findComposer = (): HTMLElement | null => {
  const controls = findComposerControls();
  if (controls && !isPreferencesComposer(controls)) {
    return controls;
  }

  const input = document.querySelector<HTMLElement>(
    'form textarea:not(#conversation-preferences), form [contenteditable="true"][role="textbox"], form [role="textbox"]',
  );
  const form = input?.closest("form");

  if (form instanceof HTMLElement && !isPreferencesComposer(form) && form.querySelector('button[type="submit"], button[aria-label*="Send" i]')) {
    return form;
  }

  return null;
};

const mountHostInComposer = (): boolean => {
  ensureHost();
  if (!host) {
    return false;
  }

  const composer = findComposer();
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
    const insertionPoint = composer.children[1] ?? null;
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
    return;
  }
  if (!mountHostInComposer()) {
    return;
  }
  root?.render(
    <React.StrictMode>
      <ContentApp
        settings={storageState.settings}
        chatUsage={storageState.chatUsage}
        realUsageSnapshot={storageState.realUsageSnapshot}
        usageHistory={storageState.usageHistory}
      />
    </React.StrictMode>,
  );
};

const requestApiUsageRefresh = (force = false) => {
  chrome.runtime.sendMessage({ type: MESSAGE_TYPES.fetchApiUsage, force }, () => {
    void chrome.runtime.lastError;
  });
};

const getConversationId = (): string | null => location.pathname.match(/\/chat\/([^/?]+)/)?.[1] ?? null;

const requestConversationContextRefresh = (conversationId: string) => {
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
    // Delay after a message send so the server usage counter has time to update.
    window.setTimeout(() => requestApiUsageRefresh(true), messageSent ? 2000 : 0);
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

  storageState = {
    ...storageState,
    dailyUsage: shouldSaveDailyUsage ? dailyUsage : storageState.dailyUsage,
    chatUsage: shouldSaveChatUsage ? chatUsage : storageState.chatUsage,
  };

  await Promise.all([
    shouldSaveDailyUsage ? saveDailyUsage(dailyUsage) : Promise.resolve(),
    shouldSaveChatUsage ? saveChatUsage(chatUsage) : Promise.resolve(),
  ]);
  render();
};

const scheduleRefresh = (records?: MutationRecord[]) => {
  if (!mutationsContainPageChanges(records)) return;
  if (!isActiveInstance()) return;
  window.clearTimeout(updateTimer);
  updateTimer = window.setTimeout(() => {
    if (!isActiveInstance()) return;
    tickSettingsPage();
    tickMessageRail();
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
  initSettingsPage();
  tickMessageRail();
  render();

  // Capture initial state so the first refreshUsage call doesn't spuriously trigger a refresh.
  const initialSnapshot = readClaudeDomSnapshot();
  lastSentCount = initialSnapshot.visibleSentCount;
  lastApiRefreshUrl = location.href;

  requestApiUsageRefresh();

  window.addEventListener("message", (event) => {
    void handleRealUsageMessage(event);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !storageState) {
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
    };
    render();
  });

  // Watch Claude's html element for theme class/attribute changes
  const themeObserver = new MutationObserver(syncTheme);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "data-theme", "data-color-scheme"],
  });

  const observer = new MutationObserver(scheduleRefresh);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  scheduleRefresh();
};

void init();
