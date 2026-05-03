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
import { ContentApp } from "./ContentApp";
import "./pageOverrides.css";
import "./styles.css";
import { buildChatUsage, rollDailyUsageForward } from "./usageEstimator";
import { messageToSnapshot } from "./usageProbeBridge";

let storageState: StorageShape | null = null;
let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLElement | null = null;
let updateTimer: number | undefined;
let mountedComposer: HTMLElement | null = null;
let lastSentCount = 0;
let lastApiRefreshUrl = "";
let lastConversationContextUrl = "";

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
  host?.classList.toggle("cub-theme-light", isLightMode());
};

const ensureHost = () => {
  if (host && root) {
    return;
  }

  host = document.createElement("div");
  host.id = "claude-usage-bar-root";
  // Apply theme class before first render so there is no flash
  syncTheme();
  root = createRoot(host);
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

  if (host.parentElement !== composer) {
    const insertionPoint = composer.children[1] ?? null;
    composer.insertBefore(host, insertionPoint);
  }

  return true;
};

const render = () => {
  if (!storageState) {
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
      if (!response?.ok || !response.chatUsage || !storageState) {
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

  // Trigger a forced API refresh when a new message is sent or the URL changes (new chat).
  const currentUrl = location.href;
  const conversationId = getConversationId();
  const messageSent = snapshot.visibleSentCount > lastSentCount;
  const urlChanged = currentUrl !== lastApiRefreshUrl;

  if (messageSent || urlChanged) {
    lastSentCount = snapshot.visibleSentCount;
    lastApiRefreshUrl = currentUrl;
    // Delay after a message send so the server usage counter has time to update.
    window.setTimeout(() => requestApiUsageRefresh(true), messageSent ? 2000 : 0);
  }

  if (conversationId && (currentUrl !== lastConversationContextUrl || messageSent)) {
    lastConversationContextUrl = currentUrl;
    window.setTimeout(() => requestConversationContextRefresh(conversationId), messageSent ? 2500 : 500);
  }

  storageState = {
    ...storageState,
    dailyUsage,
    chatUsage: conversationId ? storageState.chatUsage : chatUsage,
  };

  await Promise.all([
    saveDailyUsage(dailyUsage),
    conversationId ? Promise.resolve() : saveChatUsage(chatUsage),
  ]);
  render();
};

const scheduleRefresh = () => {
  window.clearTimeout(updateTimer);
  updateTimer = window.setTimeout(() => {
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
  injectPageProbe();
  storageState = await getStorage();
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
