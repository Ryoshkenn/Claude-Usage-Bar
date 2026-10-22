// Task alerts for the thread sidebar.
//
// A claude.ai tab running the thread view watches its sidebar; when a thread it
// saw working finishes (or starts waiting on the user) and nobody was looking at
// it, the tab tells us. We banner the active tab of each window — wherever the
// user is, within the chosen scope — and that is the end of it: like reset
// banners, nothing is stored or replayed. The thread's title rides along in the
// message purely to label the banner, inside a closed shadow root in the
// extension's isolated world, out of the host page's reach.

import { MESSAGE_TYPES } from "../shared/constants";
import type { Settings } from "../shared/types";
import { isNotifiableUrl } from "./resetNotifier";

export type ThreadEvent = "done" | "awaiting";

export interface ThreadEventDetails {
  event: ThreadEvent;
  key: string;
  title: string;
  path: string | null;
}

const CLAUDE_ORIGIN = "https://claude.ai";
// Every open claude.ai tab sees the same transition; one banner is enough.
const DEDUPE_MS = 90_000;
const recentEvents = new Map<string, number>();

const isThreadPath = (value: unknown): value is string =>
  typeof value === "string" && /^\/[\w/-]{1,200}$/.test(value);

export const parseThreadEvent = (message: unknown): ThreadEventDetails | null => {
  if (!message || typeof message !== "object") return null;
  const { event, key, title, path } = message as Record<string, unknown>;
  if (event !== "done" && event !== "awaiting") return null;
  if (typeof key !== "string" || !/^[a-z-]+:[\w-]{1,80}$/.test(key)) return null;
  return {
    event,
    key,
    title: typeof title === "string" ? title.replace(/\s+/g, " ").trim().slice(0, 120) : "",
    path: isThreadPath(path) ? path : null,
  };
};

const pathOfTab = (url: string | undefined): string | null => {
  try {
    const parsed = new URL(url ?? "");
    return parsed.origin === CLAUDE_ORIGIN ? parsed.pathname : null;
  } catch {
    return null;
  }
};

// The active tab of every window we may draw on, minus any already showing the
// thread — whoever is looking at it doesn't need telling.
export const threadBannerTargets = async (
  scope: Settings["threadDoneAlerts"],
  path: string | null,
): Promise<number[]> => {
  const tabs = await chrome.tabs.query({ active: true });
  return tabs
    .filter((tab) => {
      if (typeof tab.id !== "number" || !isNotifiableUrl(tab.url)) return false;
      const tabPath = pathOfTab(tab.url);
      if (scope !== "everywhere" && tabPath === null) return false;
      return !(path && tabPath === path);
    })
    .map((tab) => tab.id as number);
};

// Runs inside the target page. Must be fully self-contained: chrome.scripting
// serializes the function, so it closes over nothing from this module.
const renderThreadBanner = (
  state: "done" | "awaiting",
  heading: string,
  title: string,
  actionLabel: string,
  dismissLabel: string,
  path: string | null,
  openType: string,
) => {
  const HOST_ID = "claude-usage-bar-thread-banner";
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement("div");
  host.id = HOST_ID;
  // Shadow DOM so the host page's CSS can't restyle us and ours can't leak out;
  // closed so the page can't read the thread title out of it.
  const root = host.attachShadow({ mode: "closed" });
  // Below a reset banner if one is up, rather than on top of it.
  const top = document.getElementById("claude-usage-bar-reset-banner") ? 104 : 16;
  host.style.cssText = `position:fixed;top:${top}px;right:16px;z-index:2147483647;width:auto;height:auto;margin:0;padding:0;border:0;`;

  const accent = state === "done" ? "rgb(106 182 128)" : "rgb(219 147 0)";
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .card {
      display: flex; align-items: center; gap: 10px;
      box-sizing: border-box; width: 320px; padding: 11px 12px 11px 14px;
      border-radius: 12px; border: 1px solid rgb(255 255 255 / 10%);
      background: rgb(38 38 36); color: rgb(245 245 241);
      box-shadow: 0 16px 40px rgb(0 0 0 / 38%);
      font-family: ui-sans-serif, -apple-system, "Segoe UI", sans-serif;
      font-size: 13px; line-height: 1.4;
      animation: slide-in 220ms cubic-bezier(0.16, 1, 0.3, 1);
      cursor: pointer; outline: none; transition: background-color 150ms ease;
    }
    .card:hover, .card:focus-visible { background: rgb(46 46 44); }
    .card:focus-visible { box-shadow: 0 16px 40px rgb(0 0 0 / 38%), 0 0 0 2px rgb(204 124 94 / 60%); }
    @media (prefers-color-scheme: light) {
      .card {
        background: rgb(255 255 255); color: rgb(40 40 38);
        border-color: rgb(0 0 0 / 10%); box-shadow: 0 16px 40px rgb(0 0 0 / 14%);
      }
      .card:hover, .card:focus-visible { background: rgb(247 246 242); }
    }
    @keyframes slide-in {
      from { opacity: 0; transform: translateX(16px); }
      to { opacity: 1; transform: translateX(0); }
    }
    .icon {
      display: flex; flex-shrink: 0; align-items: center; justify-content: center;
      width: 26px; height: 26px; border-radius: 8px;
      color: ${accent}; background: color-mix(in srgb, ${accent} 16%, transparent);
    }
    .text { flex: 1; min-width: 0; }
    .heading { font-weight: 500; }
    .title { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; opacity: 0.7; }
    .open { flex-shrink: 0; font-size: 12px; font-weight: 500; color: ${accent}; }
    .close {
      flex-shrink: 0; width: 20px; height: 20px; padding: 0; border: 0; border-radius: 4px;
      background: none; color: currentColor; opacity: 0.5; cursor: pointer;
      font: inherit; font-size: 15px; line-height: 1;
    }
    .close:hover { opacity: 1; }
    @media (prefers-reduced-motion: reduce) { .card { animation: none; } }
  `;

  const card = document.createElement("div");
  card.className = "card";
  card.tabIndex = 0;
  card.setAttribute("role", "link");
  card.setAttribute("aria-label", title ? `${heading}: ${title}. ${actionLabel}` : `${heading}. ${actionLabel}`);

  const icon = document.createElement("span");
  icon.className = "icon";
  icon.innerHTML =
    state === "done"
      ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 12.5 10 17 19 7.5"/></svg>'
      : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5" stroke-dasharray="3.2 3.2"/></svg>';

  const text = document.createElement("div");
  text.className = "text";
  const headingEl = document.createElement("div");
  headingEl.className = "heading";
  headingEl.textContent = heading;
  text.appendChild(headingEl);
  if (title) {
    const titleEl = document.createElement("div");
    titleEl.className = "title";
    titleEl.textContent = title;
    text.appendChild(titleEl);
  }

  const open = document.createElement("span");
  open.className = "open";
  open.textContent = actionLabel;

  const close = document.createElement("button");
  close.className = "close";
  close.type = "button";
  close.setAttribute("aria-label", dismissLabel);
  close.textContent = "×";

  let timer = 0;
  const dismiss = () => {
    clearTimeout(timer);
    host.remove();
  };
  // The worker focuses the tab already showing the thread, or opens one.
  const openThread = () => {
    try {
      chrome.runtime.sendMessage({ type: openType, path }, () => {
        void chrome.runtime.lastError;
      });
    } catch {
      window.open(path ? `https://claude.ai${path}` : "https://claude.ai/", "_blank", "noopener,noreferrer");
    }
    dismiss();
  };
  close.addEventListener("click", (event) => {
    event.stopPropagation();
    dismiss();
  });
  card.addEventListener("click", openThread);
  card.addEventListener("keydown", (event) => {
    if (event.target !== card) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openThread();
    } else if (event.key === "Escape") {
      dismiss();
    }
  });

  card.append(icon, text, open, close);
  root.append(style, card);
  document.documentElement.appendChild(host);
  timer = setTimeout(dismiss, 9_000) as unknown as number;
};

export const announceThreadEvent = async (
  details: ThreadEventDetails,
  settings: Settings,
  translate: (key: string, fallback: string) => string,
  now = Date.now(),
): Promise<void> => {
  if (settings.threadSidebar !== true || settings.threadDoneAlerts === "off") return;

  const dedupeKey = `${details.event}:${details.key}`;
  const last = recentEvents.get(dedupeKey);
  if (last !== undefined && now - last < DEDUPE_MS) return;
  recentEvents.set(dedupeKey, now);
  for (const [key, at] of recentEvents) {
    if (now - at >= DEDUPE_MS) recentEvents.delete(key);
  }

  const heading =
    details.event === "done"
      ? translate("threadBannerDone", "Claude finished")
      : translate("threadBannerAwaiting", "Claude needs your input");
  const targets = await threadBannerTargets(settings.threadDoneAlerts, details.path);
  await Promise.all(
    targets.map((tabId) =>
      chrome.scripting
        .executeScript({
          target: { tabId },
          func: renderThreadBanner,
          args: [
            details.event,
            heading,
            details.title,
            translate("threadBannerOpen", "Open"),
            translate("threadBannerDismiss", "Dismiss"),
            details.path,
            MESSAGE_TYPES.openThread,
          ],
        })
        // Restricted page, tab closed mid-flight, or permission revoked.
        .catch(() => undefined),
    ),
  );
};

// Banner click: bring up the tab already on that thread, or open it.
export const openThread = async (path: unknown): Promise<void> => {
  const threadPath = isThreadPath(path) ? path : null;
  const tabs = await chrome.tabs.query({ url: `${CLAUDE_ORIGIN}/*` });
  const match = threadPath ? tabs.find((tab) => pathOfTab(tab.url) === threadPath) : undefined;
  if (match?.id !== undefined) {
    await chrome.tabs.update(match.id, { active: true });
    if (match.windowId !== undefined) await chrome.windows.update(match.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url: `${CLAUDE_ORIGIN}${threadPath ?? "/"}` });
};

// Test hook.
export const resetThreadNotifierForTests = (): void => {
  recentEvents.clear();
};
