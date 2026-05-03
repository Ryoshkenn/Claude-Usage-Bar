import React from "react";
import { createRoot } from "react-dom/client";
import { CLAUDE_ORIGIN, MESSAGE_TYPES } from "../shared/constants";
import {
  getStorage,
  saveChatUsage,
  saveDailyUsage,
  saveRealUsageSnapshot,
} from "../shared/storage";
import type { RealUsageSnapshot, StorageShape, UsageMetadata } from "../shared/types";
import { readClaudeDomSnapshot } from "./claudeDom";
import { ContentApp } from "./ContentApp";
import "./styles.css";
import { buildChatUsage, rollDailyUsageForward } from "./usageEstimator";
import { messageToSnapshot } from "./usageProbeBridge";

let storageState: StorageShape | null = null;
let metadata: UsageMetadata = {};
let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLElement | null = null;
let updateTimer: number | undefined;
let mountedComposer: HTMLElement | null = null;

const hasRealUsageValue = (metadata: UsageMetadata): boolean =>
  typeof metadata.percentageUsed === "number" ||
  typeof metadata.weeklyAllModelsPercentageUsed === "number" ||
  typeof metadata.claudeDesignPercentageUsed === "number" ||
  typeof metadata.routinesText === "string" ||
  (typeof metadata.totalMessages === "number" &&
    (typeof metadata.usedMessages === "number" || typeof metadata.remainingMessages === "number"));

const compactMetadata = (metadata: UsageMetadata): UsageMetadata =>
  Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined)) as UsageMetadata;

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

const ensureHost = () => {
  if (host && root) {
    return;
  }

  host = document.createElement("div");
  host.id = "claude-usage-bar-root";
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

const refreshUsage = async () => {
  if (!storageState || !document.body) {
    return;
  }

  const snapshot = readClaudeDomSnapshot();
  metadata = { ...metadata, ...compactMetadata(snapshot.metadata) };
  const now = new Date();
  const dailyUsage = rollDailyUsageForward(storageState.dailyUsage, snapshot.visibleSentCount, now);
  const chatUsage = buildChatUsage(snapshot.visibleText, snapshot.visibleMessageCount, now.getTime());
  const previousRealUsageSnapshot = storageState.realUsageSnapshot;
  const realUsageSnapshot: RealUsageSnapshot | undefined = hasRealUsageValue(metadata)
    ? {
        source: "real",
        capturedAt: now.getTime(),
        ...metadata,
      }
    : storageState.realUsageSnapshot;

  storageState = {
    ...storageState,
    dailyUsage,
    chatUsage,
    realUsageSnapshot,
  };

  await Promise.all([
    saveDailyUsage(dailyUsage),
    saveChatUsage(chatUsage),
    realUsageSnapshot && realUsageSnapshot !== previousRealUsageSnapshot
      ? saveRealUsageSnapshot(realUsageSnapshot)
      : Promise.resolve(),
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

  storageState = {
    ...storageState,
    realUsageSnapshot: snapshot,
  };
  await saveRealUsageSnapshot(snapshot);
  render();
};

const requestApiUsageRefresh = () => {
  chrome.runtime.sendMessage({ type: MESSAGE_TYPES.fetchApiUsage }, () => {
    void chrome.runtime.lastError;
  });
};

const init = async () => {
  injectPageProbe();
  storageState = await getStorage();
  render();
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
      realUsageSnapshot: changes.realUsageSnapshot?.newValue as RealUsageSnapshot | undefined,
    };
    render();
  });

  const observer = new MutationObserver(scheduleRefresh);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  scheduleRefresh();
};

void init();
