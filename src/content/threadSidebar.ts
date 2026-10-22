import { t } from "../shared/i18n";
import "./threadSidebar.css";

// Thread sidebar: a T3-style view of Claude's sidebar. Pinned threads, threads
// that are working (or waiting on you) and the most recent few render as large
// cards; the rest fold away under a "Settled (N)" toggle. Pinned projects leave
// the list (they're still under Projects), and Claude's nav rows — Projects,
// Artifacts, Scheduled, … — fold into a single "Projects & tools" row.
//
// claude.ai's sidebar is a React tree we don't own, so this never moves, clones
// or re-parents its nodes. It only tags them with data-cub-thread* attributes and
// lets threadSidebar.css restyle them and reorder them with flex `order`. Claude's
// own handlers (navigation, hover menus, rename, drag) keep running on the real
// rows, and turning the option off strips the attributes and the two injected
// toggles, which leaves Claude's DOM exactly as it was.

const SIDEBAR_SELECTOR = '[data-testid="sidebar"]';
const RECENTS_SELECTOR = '[data-testid="sidebar-recents"]';
const PINNED_SELECTOR = '[data-testid="sidebar-pinned"]';
const NAV_ROWS_SELECTOR = '[data-testid="nav-pin-rows"]';
const ROW_SELECTOR = "[data-row-key]";
const MAIN_BUTTON_SELECTOR = "[data-row-main-button]";
const GROUP_LABEL_SELECTOR = "[data-sidebar-group-label]";
// claude.ai's "unread / read" grouping keys its label rows label:unread-<group>.
const UNREAD_GROUP_KEY = "label:unread-unread";

const ROOT_ATTR = "data-cub-threads";
const SETTLED_ATTR = "data-cub-threads-settled";
const ROW_ATTR = "data-cub-thread";
const STATUS_ATTR = "data-cub-thread-status";
const CARD_ATTR = "data-cub-thread-card";
const CURRENT_ATTR = "data-cub-thread-current";
const META_ATTR = "data-cub-thread-meta";
const FIRST_ATTR = "data-cub-thread-first";
const FLAT_ATTR = "data-cub-thread-flat";
const LABEL_ATTR = "data-cub-thread-label";
const HIDDEN_ATTR = "data-cub-thread-hidden";
const NAV_ATTR = "data-cub-thread-nav";
const NAV_DOT_ATTR = "data-cub-thread-nav-dot";
const OWN_ATTRS = [
  ROOT_ATTR,
  SETTLED_ATTR,
  ROW_ATTR,
  STATUS_ATTR,
  CARD_ATTR,
  CURRENT_ATTR,
  META_ATTR,
  FIRST_ATTR,
  FLAT_ATTR,
  LABEL_ATTR,
  HIDDEN_ATTR,
  NAV_ATTR,
];

export const SETTLED_TOGGLE_ID = "cub-thread-settled-toggle";
export const NAV_TOGGLE_ID = "cub-thread-nav-toggle";

// Attributes Claude flips when a row's state changes. Ours are deliberately
// absent so writing them never re-triggers the observer.
const WATCHED_ATTRIBUTES = [
  "aria-current",
  "aria-expanded",
  "data-selected",
  "data-kind",
  "data-unread-mark",
  "aria-busy",
  "href",
];

export const THREAD_RECENT_COUNTS = [3, 5, 8, 12] as const;
const DEFAULT_RECENT_COUNT = 5;

export type ThreadKind = "chat" | "cowork" | "routine" | "code" | "project" | "other";
export type ThreadStatus = "working" | "awaiting" | "error" | "ready" | "unread";
export type ThreadPlacement =
  | "label"
  | "label-hidden"
  | "hidden"
  | "pinned"
  | "live"
  | "recent"
  | "settled";

export interface ThreadRowInfo {
  label: boolean;
  status: ThreadStatus | null;
  current: boolean;
  pinned?: boolean;
  hidden?: boolean;
}

export interface ThreadSidebarOptions {
  threadSidebar?: boolean;
  threadSidebarRecentCount?: number;
}

// Claude's row status dots (.status-dot[data-kind]) mapped onto our states.
// "clay" is the breathing Claude mark shown while a reply is being written.
const STATUS_DOT_KINDS: Record<string, ThreadStatus> = {
  running: "working",
  clay: "working",
  awaiting: "awaiting",
  error: "error",
  ready: "ready",
  unread: "unread",
};

// When a row shows several signals (e.g. a cowork parent with children), the one
// that most needs the user wins.
const STATUS_PRIORITY: ThreadStatus[] = ["awaiting", "error", "working", "ready", "unread"];

// Sections that render as cards, top to bottom. A divider separates each from
// the one above it.
const CARD_SECTIONS: ThreadPlacement[] = ["pinned", "live", "recent"];

export const threadKindOf = (rowKey: string): ThreadKind => {
  const prefix = rowKey.slice(0, rowKey.indexOf(":"));
  switch (prefix) {
    case "chat":
      return "chat";
    case "cowork":
      return "cowork";
    case "scheduled-task":
      return "routine";
    case "code":
    case "code-session":
    case "session":
      return "code";
    case "project":
      return "project";
    default:
      return "other";
  }
};

export const readRowStatus = (row: Element): ThreadStatus | null => {
  const found = new Set<ThreadStatus>();
  row.querySelectorAll(".status-dot[data-kind]").forEach((dot) => {
    const status = STATUS_DOT_KINDS[dot.getAttribute("data-kind") ?? ""];
    if (status) found.add(status);
  });
  if (row.querySelector("[data-unread-mark]")) found.add("unread");
  if (row.querySelector('[aria-busy="true"]')) found.add("working");
  return STATUS_PRIORITY.find((status) => found.has(status)) ?? null;
};

const isCurrentRow = (row: Element): boolean => {
  const main = row.querySelector(MAIN_BUTTON_SELECTOR);
  if (!main) return false;
  if (main.getAttribute("aria-current") === "page") return true;
  const href = main.getAttribute("href");
  return Boolean(href) && href === location.pathname;
};

// Pinned threads lead the list. After them, live threads (working, waiting on
// you, finished but unseen) always get a card, then the first `recentCount`
// threads in Claude's own order — most recent first — and the open thread is
// never folded away. Only the first group label survives (it carries Claude's
// Search / Filter / View all buttons); later ones would split the re-sectioned
// list in odd places.
export const placeThreadRows = (rows: ThreadRowInfo[], recentCount: number): ThreadPlacement[] => {
  let seenLabel = false;
  let recent = 0;
  return rows.map((row) => {
    if (row.hidden) return "hidden";
    if (row.label) {
      const placement = seenLabel ? "label-hidden" : "label";
      seenLabel = true;
      return placement;
    }
    if (row.pinned) return "pinned";
    if (row.status) return "live";
    if (recent < recentCount) {
      recent += 1;
      return "recent";
    }
    return row.current ? "recent" : "settled";
  });
};

const kindLabel = (kind: ThreadKind): string => {
  switch (kind) {
    case "chat":
      return t("threadKindChat", "Chat");
    case "cowork":
      return t("threadKindCowork", "Cowork");
    case "routine":
      return t("threadKindRoutine", "Routine");
    case "code":
      return t("threadKindCode", "Code");
    case "project":
      return t("threadKindProject", "Project");
    default:
      return t("threadKindOther", "Thread");
  }
};

const statusLabel = (status: ThreadStatus): string => {
  switch (status) {
    case "working":
      return t("threadStatusWorking", "Working");
    case "awaiting":
      return t("threadStatusAwaiting", "Needs input");
    case "error":
      return t("threadStatusError", "Error");
    case "ready":
      return t("threadStatusReady", "Ready");
    case "unread":
      return t("threadStatusUnread", "Unread");
  }
};

export const threadMetaText = (
  kind: ThreadKind,
  status: ThreadStatus | null,
  current: boolean,
  pinned = false,
): string =>
  [
    kindLabel(kind),
    pinned ? t("threadStatusPinned", "Pinned") : null,
    status ? statusLabel(status) : current ? t("threadStatusOpen", "Open") : null,
  ]
    .filter(Boolean)
    .join(" · ");

// ── DOM application ──────────────────────────────────────────────────────────

let enabled = false;
let recentCount = DEFAULT_RECENT_COUNT;
// Both start collapsed, like T3; remembered for the life of the tab only.
let settledOpen = false;
let navOpen = false;
let isActive: () => boolean = () => true;
let sidebarObserver: MutationObserver | null = null;
let documentObserver: MutationObserver | null = null;
let observedSidebar: Element | null = null;
let attachFrame: number | undefined;

const setAttr = (el: Element, name: string, value: string | null): void => {
  if (value === null) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) {
    el.setAttribute(name, value);
  }
};

const setText = (el: Element, text: string): void => {
  if (el.textContent !== text) el.textContent = text;
};

// Rows nested inside another row (a cowork session's children) travel with
// their parent rather than being sectioned on their own.
const topLevelRows = (container: Element): HTMLElement[] =>
  [...container.querySelectorAll<HTMLElement>(ROW_SELECTOR)].filter((row) => {
    const parentRow = row.parentElement?.closest(ROW_SELECTOR);
    return !parentRow || !container.contains(parentRow);
  });

// Pinned and recent rows live in separate containers, but every wrapper above
// the recents list is display:contents, so its nearest real box — the sidebar's
// scroll column — holds both. That column becomes the flex container `order`
// sections the threads in. The walk only climbs above the recents list, never
// through boxes this module flattens itself, so it lands on the same element
// on every pass.
const flexRootOf = (recents: Element): Element => {
  let el = recents.parentElement;
  while (el && el !== document.body && getComputedStyle(el).display === "contents") el = el.parentElement;
  return el && el !== document.body ? el : recents;
};

const readRowInfos = (pinnedRows: HTMLElement[], recentRows: HTMLElement[]): ThreadRowInfo[] => {
  // Pinned projects are dropped from the list; they stay under Projects.
  const pinned = pinnedRows.map((row): ThreadRowInfo => {
    const key = row.getAttribute("data-row-key") ?? "";
    const hidden = key.startsWith("project:") || key.startsWith("section:") || key.startsWith("label:");
    return { label: false, pinned: !hidden, hidden, status: hidden ? null : readRowStatus(row), current: isCurrentRow(row) };
  });
  let inUnreadGroup = false;
  const recent = recentRows.map((row): ThreadRowInfo => {
    const key = row.getAttribute("data-row-key") ?? "";
    if (key.startsWith("label:")) {
      inUnreadGroup = key === UNREAD_GROUP_KEY;
      return { label: true, status: null, current: false };
    }
    const status = readRowStatus(row) ?? (inUnreadGroup ? "unread" : null);
    return { label: false, status, current: isCurrentRow(row) };
  });
  return [...pinned, ...recent];
};

const CARET_SVG =
  '<svg class="cub-thread-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';

const NAV_ICON_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></svg>';

const buildToggle = (id: string, onToggle: () => void): HTMLButtonElement => {
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.id = id;
  toggle.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onToggle();
    applyThreadSidebar();
  });
  return toggle;
};

const buildSettledToggle = (): HTMLButtonElement => {
  const toggle = buildToggle(SETTLED_TOGGLE_ID, () => {
    settledOpen = !settledOpen;
  });
  const label = document.createElement("span");
  label.className = "cub-thread-settled-label";
  const rule = document.createElement("span");
  rule.className = "cub-thread-settled-rule";
  rule.setAttribute("aria-hidden", "true");
  toggle.append(label, rule);
  toggle.insertAdjacentHTML("beforeend", CARET_SVG);
  return toggle;
};

const buildNavToggle = (): HTMLButtonElement => {
  const toggle = buildToggle(NAV_TOGGLE_ID, () => {
    navOpen = !navOpen;
  });
  const icon = document.createElement("span");
  icon.className = "cub-thread-nav-icon";
  icon.innerHTML = NAV_ICON_SVG;
  const label = document.createElement("span");
  label.className = "cub-thread-nav-label";
  const dot = document.createElement("span");
  dot.className = "cub-thread-nav-dot";
  dot.setAttribute("aria-hidden", "true");
  toggle.append(icon, label, dot);
  toggle.insertAdjacentHTML("beforeend", CARET_SVG);
  return toggle;
};

// Our toggles are the only nodes this module adds. Any copy outside its host —
// left behind when Claude re-rendered the host — is dropped, then the host gets
// one if it needs it.
const ensureToggle = (
  id: string,
  host: Element | null,
  wanted: boolean,
  build: () => HTMLButtonElement,
  prepend = false,
): HTMLButtonElement | null => {
  document.querySelectorAll(`#${id}`).forEach((el) => {
    if (!wanted || el.parentElement !== host) el.remove();
  });
  if (!wanted || !host) return null;
  let toggle = host.querySelector<HTMLButtonElement>(`:scope > #${id}`);
  if (!toggle) {
    toggle = build();
    if (prepend) host.insertBefore(toggle, host.firstChild);
    else host.appendChild(toggle);
  }
  return toggle;
};

const syncSettledToggle = (recents: Element, settledCount: number): void => {
  const toggle = ensureToggle(SETTLED_TOGGLE_ID, recents, settledCount > 0, buildSettledToggle);
  if (!toggle) return;
  const label = toggle.querySelector(".cub-thread-settled-label");
  if (label) setText(label, t("threadSettled", "Settled ($1)", settledCount));
  setAttr(toggle, "aria-expanded", settledOpen ? "true" : "false");
};

// Projects, Artifacts, Scheduled, Design, Customize and More fold into one row
// under New. A status dot Claude shows on any of them (e.g. "Scheduled tasks
// have updates") is mirrored on the folded row so it isn't lost.
const syncNavRows = (sidebar: Element): void => {
  const nav = sidebar.querySelector(NAV_ROWS_SELECTOR);
  const toggle = ensureToggle(NAV_TOGGLE_ID, nav, true, buildNavToggle, true);
  if (!nav || !toggle) return;
  setAttr(nav, NAV_ATTR, navOpen ? "open" : "closed");
  const label = toggle.querySelector(".cub-thread-nav-label");
  if (label) setText(label, t("threadNavLabel", "Projects & tools"));
  setAttr(toggle, "aria-expanded", navOpen ? "true" : "false");
  setAttr(toggle, NAV_DOT_ATTR, nav.querySelector(".status-dot") ? "" : null);
};

// Claude's own "Pinned" heading goes: its threads now lead the Threads list. If
// the group is collapsed it stays, so it can still be opened.
const syncPinnedLabel = (pinned: Element): void => {
  const label = pinned.querySelector(GROUP_LABEL_SELECTOR);
  if (!label) return;
  const collapsed = label.querySelector("[data-group-toggle]")?.getAttribute("aria-expanded") === "false";
  setAttr(label, HIDDEN_ATTR, collapsed ? null : "");
};

export const applyThreadSidebar = (): void => {
  if (!enabled) return;
  const sidebar = document.querySelector(SIDEBAR_SELECTOR);
  if (sidebar) syncNavRows(sidebar);

  const recents = document.querySelector(RECENTS_SELECTOR);
  if (!recents) return;
  const root = flexRootOf(recents);
  document.querySelectorAll(`[${ROOT_ATTR}]`).forEach((el) => {
    if (el !== root) {
      el.removeAttribute(ROOT_ATTR);
      el.removeAttribute(SETTLED_ATTR);
    }
  });
  setAttr(root, ROOT_ATTR, "on");
  setAttr(root, SETTLED_ATTR, settledOpen ? "open" : "closed");

  const pinnedEl = document.querySelector(PINNED_SELECTOR);
  const pinned = pinnedEl && root.contains(pinnedEl) ? pinnedEl : null;
  if (pinned) syncPinnedLabel(pinned);
  const pinnedRows = pinned ? topLevelRows(pinned) : [];
  const rows = [...pinnedRows, ...topLevelRows(recents)];
  const infos = readRowInfos(pinnedRows, rows.slice(pinnedRows.length));
  const placements = placeThreadRows(infos, recentCount);

  const firstOfSection = new Set<number>();
  let earlierSection = false;
  for (const section of CARD_SECTIONS) {
    const index = placements.indexOf(section);
    if (index === -1) continue;
    if (earlierSection) firstOfSection.add(index);
    earlierSection = true;
  }

  let settledCount = 0;
  const flat = new Set<Element>();

  rows.forEach((row, index) => {
    const placement = placements[index];
    const info = infos[index];
    setAttr(row, ROW_ATTR, placement);
    setAttr(row, STATUS_ATTR, info.status);
    setAttr(row, FIRST_ATTR, firstOfSection.has(index) ? "" : null);
    if (placement === "settled") settledCount += 1;

    // Every wrapper between the flex root and a row is flattened, so all rows
    // are flex items of one container and `order` can section them even though
    // Claude splits them across pinned, group and recents containers.
    if (placement !== "hidden") {
      for (let el = row.parentElement; el && el !== root; el = el.parentElement) flat.add(el);
    }

    const isCard = CARD_SECTIONS.includes(placement);
    const main = row.querySelector(MAIN_BUTTON_SELECTOR);
    const card = main?.closest("[data-row]") ?? null;
    if (card) {
      setAttr(card, CARD_ATTR, isCard ? "" : null);
      setAttr(card, CURRENT_ATTR, isCard && info.current ? "" : null);
    }
    const label = main?.querySelector("[data-row-label]");
    if (label) {
      const kind = threadKindOf(row.getAttribute("data-row-key") ?? "");
      setAttr(label, META_ATTR, isCard ? threadMetaText(kind, info.status, info.current, info.pinned) : null);
    }

    if (placement === "label") {
      const name = row.querySelector("[data-group-name]");
      if (name) setAttr(name, LABEL_ATTR, t("threadsLabel", "Threads"));
    }
  });

  root.querySelectorAll(`[${FLAT_ATTR}]`).forEach((el) => {
    if (!flat.has(el)) el.removeAttribute(FLAT_ATTR);
  });
  flat.forEach((el) => setAttr(el, FLAT_ATTR, ""));

  syncSettledToggle(recents, settledCount);
};

const clearThreadSidebar = (): void => {
  document.querySelectorAll(`#${SETTLED_TOGGLE_ID}, #${NAV_TOGGLE_ID}`).forEach((el) => el.remove());
  const selector = OWN_ATTRS.map((name) => `[${name}]`).join(",");
  document.querySelectorAll(selector).forEach((el) => {
    for (const name of OWN_ATTRS) el.removeAttribute(name);
  });
};

// Claude swaps its sidebar subtree when switching chat / code modes; re-point
// the scoped observer at whichever sidebar is current.
const attach = (): void => {
  const sidebar = document.querySelector(SIDEBAR_SELECTOR);
  if (sidebar !== observedSidebar) {
    sidebarObserver?.disconnect();
    observedSidebar = sidebar;
    if (sidebar) {
      sidebarObserver?.observe(sidebar, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: WATCHED_ATTRIBUTES,
      });
    }
  }
  applyThreadSidebar();
};

const stopObserving = (): void => {
  sidebarObserver?.disconnect();
  documentObserver?.disconnect();
  sidebarObserver = null;
  documentObserver = null;
  observedSidebar = null;
  if (attachFrame !== undefined) {
    cancelAnimationFrame(attachFrame);
    attachFrame = undefined;
  }
};

// A displaced content-script instance (after an extension reload) must stop
// touching the sidebar, but leaves the attributes for the live instance to own.
const stillActive = (): boolean => {
  if (isActive()) return true;
  enabled = false;
  stopObserving();
  return false;
};

const start = (): void => {
  enabled = true;
  // Sidebar mutations are handled synchronously: observer callbacks run before
  // the next paint, so a row Claude re-renders never flashes unstyled.
  sidebarObserver = new MutationObserver(() => {
    if (stillActive()) applyThreadSidebar();
  });
  // The document-wide observer only notices the sidebar itself being replaced,
  // checked at most once per frame since it fires for every streamed token.
  documentObserver = new MutationObserver(() => {
    if (attachFrame !== undefined) return;
    attachFrame = requestAnimationFrame(() => {
      attachFrame = undefined;
      if (!stillActive()) return;
      const sidebar = document.querySelector(SIDEBAR_SELECTOR);
      const recents = document.querySelector(RECENTS_SELECTOR);
      if (sidebar !== observedSidebar || (recents && !recents.closest(`[${ROOT_ATTR}]`))) attach();
    });
  });
  documentObserver.observe(document.body, { childList: true, subtree: true });
  attach();
};

const stop = (): void => {
  enabled = false;
  stopObserving();
  clearThreadSidebar();
};

export const initThreadSidebar = (activeInstance: () => boolean): void => {
  isActive = activeInstance;
};

const normalizeRecentCount = (value: number | undefined): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : DEFAULT_RECENT_COUNT;

// Called on every render: cheap when nothing changed, and it re-applies so the
// open-thread highlight follows SPA navigation.
export const syncThreadSidebar = (settings: ThreadSidebarOptions): void => {
  recentCount = normalizeRecentCount(settings.threadSidebarRecentCount);
  if (settings.threadSidebar === true) {
    if (enabled) applyThreadSidebar();
    else start();
  } else if (enabled) {
    stop();
  }
};

// Test hook: drop all module state between cases.
export const resetThreadSidebarForTests = (): void => {
  stop();
  settledOpen = false;
  navOpen = false;
  recentCount = DEFAULT_RECENT_COUNT;
  isActive = () => true;
};
