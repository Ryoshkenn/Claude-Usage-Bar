import { MESSAGE_TYPES, STORAGE_KEYS } from "../shared/constants";
import { t } from "../shared/i18n";
import { updateSettings } from "../shared/storage";
import type { ThreadSort } from "../shared/types";
import "./threadSidebar.css";

// Thread sidebar: a T3-style view of Claude's sidebar. Everything starts
// settled, folded under a "Settled (N)" bar locked to the bottom of the list.
// A thread that does something — you start it or send to it, Claude works on
// it, it changes in Claude's list — opens as a card and stays one until you
// settle it; there's no cap, the list just scrolls. Pinned threads always lead
// as cards. Pinned projects leave the list (they're still under Projects),
// Claude's nav rows — Projects, Artifacts, Scheduled, … — fold into one
// "Projects & tools" row, and a Search / sort / new-chat row sits at the top.
//
// claude.ai's sidebar is a React tree we don't own, so this never moves, clones
// or re-parents its nodes. It tags them with data-cub-thread* attributes, sets
// a flex `order` on each row, and adds a few nodes of its own (the toggles, the
// top row, and a meta line and Settle button on each card). threadSidebar.css
// does the rest.
// Claude's own handlers (navigation, hover menus, rename, drag) keep running on
// the real rows, and turning the option off removes every attribute, style and
// node this module added, which leaves Claude's DOM exactly as it was.
//
// "Done" is tracked here, not by Claude: a thread seen working that stops
// working, while you weren't looking at it, is done until you open it. That
// state is shared by every claude.ai tab through chrome.storage.session; which
// threads are open or settled lives in chrome.storage.local and is forgotten
// when the view is turned off. Both hold row keys and timestamps only.

const SIDEBAR_SELECTOR = '[data-testid="sidebar"]';
const RECENTS_SELECTOR = '[data-testid="sidebar-recents"]';
const PINNED_SELECTOR = '[data-testid="sidebar-pinned"]';
const NAV_ROWS_SELECTOR = '[data-testid="nav-pin-rows"]';
const ROW_SELECTOR = "[data-row-key]";
const MAIN_BUTTON_SELECTOR = "[data-row-main-button]";
const GROUP_LABEL_SELECTOR = "[data-sidebar-group-label]";
const NEW_LINK_SELECTOR = 'a[href="/new"][data-row-main-button]';
// Claude's Search row beside New (Oct 2026 layout): a sidebar row, not a bar,
// advertising Ctrl/⌘+K. Hidden like New; our Search row clicks it.
const SEARCH_ROW_SELECTOR = '[data-row-main-button][aria-keyshortcuts$="+k" i]';
// claude.ai's "unread / read" grouping keys its label rows label:unread-<group>.
const UNREAD_GROUP_KEY = "label:unread-unread";

const ROOT_ATTR = "data-cub-threads";
const SETTLED_ATTR = "data-cub-threads-settled";
const THEME_ATTR = "data-cub-threads-theme";
const ROW_ATTR = "data-cub-thread";
const STATUS_ATTR = "data-cub-thread-status";
const CARD_ATTR = "data-cub-thread-card";
const CURRENT_ATTR = "data-cub-thread-current";
const FIRST_ATTR = "data-cub-thread-first";
const FLAT_ATTR = "data-cub-thread-flat";
const LABEL_ATTR = "data-cub-thread-label";
const HIDDEN_ATTR = "data-cub-thread-hidden";
const NAV_ATTR = "data-cub-thread-nav";
const OWN_ATTRS = [
  ROOT_ATTR,
  SETTLED_ATTR,
  THEME_ATTR,
  ROW_ATTR,
  STATUS_ATTR,
  CARD_ATTR,
  CURRENT_ATTR,
  FIRST_ATTR,
  FLAT_ATTR,
  LABEL_ATTR,
  HIDDEN_ATTR,
  NAV_ATTR,
];

export const SETTLED_TOGGLE_ID = "cub-thread-settled-toggle";
export const NAV_TOGGLE_ID = "cub-thread-nav-toggle";
export const TOP_ROW_ID = "cub-thread-top";
export const TOP_ACTIONS_ID = "cub-thread-top-actions";
const META_CLASS = "cub-thread-meta";
const SETTLE_CLASS = "cub-thread-settle";
const OWN_NODE_SELECTOR = `#${SETTLED_TOGGLE_ID}, #${NAV_TOGGLE_ID}, #${TOP_ROW_ID}, .${META_CLASS}, .${SETTLE_CLASS}`;

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

// Relative times ("12m") are refreshed this often while the view is on.
const CLOCK_TICK_MS = 30_000;
// Done marks that were never opened, and working marks never seen to finish
// (the tab closed mid-task), stop counting after this long.
const DONE_TTL_MS = 24 * 60 * 60_000;
const WORKING_TTL_MS = 12 * 60 * 60_000;
const MAX_THREAD_TIMES = 2_000;
// Open and hand-settled threads kept in storage, newest first. Only bounds the
// store; the list itself has no cap.
const MAX_PLACES = 1_000;
// Claude bumps updated_at when a thread is merely opened; only a change this
// long after settling counts as new activity.
const SETTLE_GRACE_MS = 5_000;
// The flex gap between rows (threadSidebar.css).
const ROW_GAP_PX = 2;

// Flex `order` bands. Each row adds its position in the sorted list, so rows
// stay sorted inside their band; the settled toggle sits between the bands.
const ORDER_BASE = { label: 100, pinned: 1_000, live: 2_000, open: 3_000, settled: 5_000 } as const;

export type ThreadKind = "chat" | "cowork" | "routine" | "code" | "project" | "other";
export type ThreadStatus = "working" | "awaiting" | "error" | "done" | "unread";
export type ThreadPlacement =
  | "label"
  | "label-hidden"
  | "hidden"
  | "pinned"
  | "live"
  | "open"
  | "settled";

export interface ThreadRowInfo {
  label: boolean;
  status: ThreadStatus | null;
  current: boolean;
  pinned?: boolean;
  hidden?: boolean;
  // Has done something since it was last settled (or since the view started).
  open?: boolean;
  // Settled by hand and quiet since.
  settled?: boolean;
}

export interface ThreadSidebarOptions {
  threadSidebar?: boolean;
  threadSidebarSort?: ThreadSort;
}

interface ThreadTimes {
  createdAt?: number;
  updatedAt?: number;
}

interface ThreadActivity {
  workingSince?: number;
  awaitingSince?: number;
  doneAt?: number;
}

// Claude's row status dots (.status-dot[data-kind]) mapped onto our states.
// "clay" is the breathing Claude mark shown while a reply is being written;
// "ready" is Claude's own finished-but-unseen marker.
const STATUS_DOT_KINDS: Record<string, ThreadStatus> = {
  running: "working",
  clay: "working",
  awaiting: "awaiting",
  error: "error",
  ready: "done",
  unread: "unread",
};

// When a row shows several signals (e.g. a cowork parent with children), the one
// that most needs the user wins.
const STATUS_PRIORITY: ThreadStatus[] = ["awaiting", "error", "working", "done", "unread"];

// Sections that render as cards, top to bottom. A divider separates each from
// the one above it.
const CARD_SECTIONS: ThreadPlacement[] = ["pinned", "live", "open"];

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

// The id Claude's APIs use for a row: "chat:<uuid>" → "<uuid>".
const threadIdOf = (rowKey: string): string => rowKey.slice(rowKey.indexOf(":") + 1);

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

// Rows arrive in display order. Pinned threads lead the list. Threads settled
// by hand stay settled. After them, live threads (working, waiting on you, done
// but unseen) get a card, then every open one — no cap. The rest are settled.
// The thread you're on is lifted out of a folded Settled section so it can
// always be seen (`liftCurrent`), but never out of an open one, where it would
// jump away from under the click that opened it. Only the first group label
// survives (it carries Claude's Search / Filter / View all buttons); later ones
// would split the re-sectioned list in odd places.
export const placeThreadRows = (rows: ThreadRowInfo[], liftCurrent = true): ThreadPlacement[] => {
  let seenLabel = false;
  return rows.map((row) => {
    if (row.hidden) return "hidden";
    if (row.label) {
      const placement = seenLabel ? "label-hidden" : "label";
      seenLabel = true;
      return placement;
    }
    if (row.pinned) return "pinned";
    if (row.settled) return "settled";
    if (row.status) return "live";
    if (row.open || (row.current && liftCurrent)) return "open";
    return "settled";
  });
};

export interface ThreadOrderEntry {
  createdAt?: number;
  updatedAt?: number;
  // Local activity — when we saw it start working or finish — which bumps a
  // thread up under "newest edited" even before Claude's list refetches.
  activityAt?: number;
}

// Display order (as indices) for rows given in Claude's DOM order. Rows without
// a timestamp inherit the one above them in Claude's order, so they stay next
// to the neighbours Claude put them by; with no timestamps at all, Claude's
// order is kept as is.
export const threadDisplayOrder = (entries: ThreadOrderEntry[], sort: ThreadSort): number[] => {
  let inherited = Number.POSITIVE_INFINITY;
  const keys = entries.map((entry) => {
    const own =
      sort === "created"
        ? entry.createdAt
        : [entry.updatedAt, entry.activityAt].reduce<number | undefined>(
            (max, value) => (value === undefined ? max : max === undefined ? value : Math.max(max, value)),
            undefined,
          );
    if (own !== undefined) inherited = own;
    return own ?? inherited;
  });
  return entries.map((_, index) => index).sort((a, b) => keys[b] - keys[a] || a - b);
};

export const formatThreadAgo = (ms: number): string => {
  const seconds = Math.max(0, Math.round(ms / 1_000));
  if (seconds < 60) return t("threadAgoSeconds", "$1s", seconds);
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("threadAgoMinutes", "$1m", minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("threadAgoHours", "$1h", hours);
  const days = Math.floor(hours / 24);
  if (days < 7) return t("threadAgoDays", "$1d", days);
  return t("threadAgoWeeks", "$1w", Math.floor(days / 7));
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

// Right-hand side of a card's meta line: the live state, or how long ago the
// thread last changed.
export const threadWhenText = (
  status: ThreadStatus | null,
  activity: ThreadActivity | undefined,
  times: ThreadTimes | undefined,
  now: number,
): string => {
  switch (status) {
    case "working":
      return activity?.workingSince
        ? t("threadWorkingFor", "Working $1", formatThreadAgo(now - activity.workingSince))
        : t("threadStatusWorking", "Working");
    case "awaiting":
      return activity?.awaitingSince
        ? t("threadWaitingFor", "Waiting $1", formatThreadAgo(now - activity.awaitingSince))
        : t("threadStatusAwaiting", "Waiting");
    case "error":
      return t("threadStatusError", "Error");
    case "done":
      return activity?.doneAt
        ? t("threadDoneAgo", "Done $1", formatThreadAgo(now - activity.doneAt))
        : t("threadStatusDone", "Done");
    case "unread":
      return t("threadStatusUnread", "Unread");
    default:
      return times?.updatedAt ? formatThreadAgo(now - times.updatedAt) : "";
  }
};

// ── State ────────────────────────────────────────────────────────────────────

let enabled = false;
let sort: ThreadSort = "edited";
let lightTheme = false;
// Both start collapsed, like T3; remembered for the life of the tab only.
let settledOpen = false;
let navOpen = false;
let isActive: () => boolean = () => true;
let sidebarObserver: MutationObserver | null = null;
let documentObserver: MutationObserver | null = null;
let observedSidebar: Element | null = null;
let attachFrame: number | undefined;
let clockTimer: number | undefined;
let claudeSearchBar: HTMLElement | null = null;
// The sidebar's painted background, for the Settled bar that sticks over the
// list. Read lazily, again after a theme change or a new sidebar.
let sidebarBackground: string | null = null;
let sortMenuOpen = false;
// When no bar was found, the scan (every button in the aside) is skipped for a
// few seconds rather than repeated on every sidebar mutation.
let searchScanAt = 0;
const SEARCH_RESCAN_MS = 3_000;

// Thread id → created / updated times, fed by the page probe from Claude's own
// list responses. Memory only.
const threadTimes = new Map<string, ThreadTimes>();
// Row key → working / done timestamps, mirrored to chrome.storage.session.
let activity: Record<string, ThreadActivity> = {};
// Rows this tab's own sidebar has shown working. Only that local working → idle
// transition writes "done" to the shared marks: acting on another tab's mark
// while the two sidebars briefly disagree had each tab overwrite the other's
// entry in session storage, back and forth, until they caught up.
const seenWorking = new Set<string>();
// Where each thread sits, mirrored to chrome.storage.local. Every thread counts
// as settled as of `viewSince` (when the view was turned on); `opened` holds
// row key → when it opened, `settled` row key → when it was settled by hand. A
// key is in one of the two at most. Nothing opens until they've loaded, so a
// page load can't open threads against a made-up baseline.
let viewSince: number | undefined;
let opened: Record<string, number> = {};
let settled: Record<string, number> = {};
let placesLoaded = false;
let placesLoad = 0;
let startedAt = 0;

const extensionAlive = (): boolean => typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);

const sessionArea = (): chrome.storage.StorageArea | null =>
  extensionAlive() && chrome.storage?.session ? chrome.storage.session : null;

const localArea = (): chrome.storage.StorageArea | null =>
  extensionAlive() && chrome.storage?.local ? chrome.storage.local : null;

const ROW_KEY_PATTERN = /^[a-z-]+:[\w-]{1,80}$/;

const sanitizeActivity = (value: unknown, now = Date.now()): Record<string, ThreadActivity> => {
  const out: Record<string, ThreadActivity> = {};
  if (!value || typeof value !== "object") return out;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!ROW_KEY_PATTERN.test(key) || !raw || typeof raw !== "object") continue;
    const { workingSince, awaitingSince, doneAt } = raw as ThreadActivity;
    const entry: ThreadActivity = {};
    if (typeof workingSince === "number" && now - workingSince < WORKING_TTL_MS) {
      entry.workingSince = workingSince;
      if (typeof awaitingSince === "number" && awaitingSince >= workingSince) entry.awaitingSince = awaitingSince;
    }
    if (typeof doneAt === "number" && now - doneAt < DONE_TTL_MS) entry.doneAt = doneAt;
    if (entry.workingSince || entry.doneAt) out[key] = entry;
  }
  return out;
};

const saveActivity = (): void => {
  activity = sanitizeActivity(activity);
  void sessionArea()
    ?.set({ [STORAGE_KEYS.threadActivity]: activity })
    .catch(() => undefined);
};

const loadActivity = (): void => {
  void sessionArea()
    ?.get(STORAGE_KEYS.threadActivity)
    .then((data) => {
      activity = { ...sanitizeActivity(data[STORAGE_KEYS.threadActivity]), ...activity };
      applyThreadSidebar();
    })
    .catch(() => undefined);
};

interface ThreadPlaces {
  since?: number;
  open: Record<string, number>;
  settled: Record<string, number>;
}

const sanitizeKeyTimes = (value: unknown): [string, number][] =>
  value && typeof value === "object"
    ? Object.entries(value as Record<string, unknown>).filter(
        (entry): entry is [string, number] =>
          ROW_KEY_PATTERN.test(entry[0]) && typeof entry[1] === "number" && Number.isFinite(entry[1]),
      )
    : [];

// A key in both maps keeps whichever happened last; a hand-settle from before
// the view started is already covered by its baseline.
const sanitizePlaces = (value: unknown): ThreadPlaces => {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const since = typeof raw.since === "number" && Number.isFinite(raw.since) ? raw.since : undefined;
  const open = sanitizeKeyTimes(raw.open);
  const settledEntries = sanitizeKeyTimes(raw.settled).filter(([, at]) => since === undefined || at > since);
  const openAt = new Map(open);
  const settledAt = new Map(settledEntries);
  const keep = (entries: [string, number][], other: Map<string, number>) =>
    Object.fromEntries(
      entries
        .filter(([key, at]) => (other.get(key) ?? Number.NEGATIVE_INFINITY) < at)
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_PLACES),
    );
  return { since, open: keep(open, settledAt), settled: keep(settledEntries, openAt) };
};

const savePlaces = (): void => {
  const places = sanitizePlaces({ since: viewSince, open: opened, settled });
  opened = places.open;
  settled = places.settled;
  void localArea()
    ?.set({ [STORAGE_KEYS.threadPlaces]: places })
    .catch(() => undefined);
};

const adoptPlaces = (places: ThreadPlaces): void => {
  viewSince = places.since ?? startedAt;
  opened = places.open;
  settled = places.settled;
  placesLoaded = true;
};

// A view turned on for the first time (or again after being off) has nothing
// stored, and starts its baseline at the moment it was turned on.
const loadPlaces = (): void => {
  const area = localArea();
  const load = ++placesLoad;
  if (!area) {
    adoptPlaces({ open: {}, settled: {} });
    return;
  }
  void area
    .get(STORAGE_KEYS.threadPlaces)
    .then((data) => {
      if (load !== placesLoad || !enabled) return;
      const stored = sanitizePlaces(data[STORAGE_KEYS.threadPlaces]);
      adoptPlaces(stored);
      if (stored.since === undefined) savePlaces();
      applyThreadSidebar();
    })
    .catch(() => {
      if (load === placesLoad && !placesLoaded) adoptPlaces({ open: {}, settled: {} });
    });
};

const forgetPlaces = (): void => {
  placesLoad += 1;
  placesLoaded = false;
  viewSince = undefined;
  opened = {};
  settled = {};
  void localArea()
    ?.remove(STORAGE_KEYS.threadPlaces)
    .catch(() => undefined);
};

// Both shared stores: done marks from other claude.ai tabs (session), and
// threads opened or settled in another tab (local).
const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
  if (area === "session" && changes[STORAGE_KEYS.threadActivity]) {
    activity = sanitizeActivity(changes[STORAGE_KEYS.threadActivity].newValue);
    applyThreadSidebar();
  } else if (area === "local" && changes[STORAGE_KEYS.threadPlaces] && placesLoaded) {
    // Gone means another tab turned the view off; this one is about to follow.
    const next = changes[STORAGE_KEYS.threadPlaces].newValue;
    adoptPlaces(next === undefined ? { since: Date.now(), open: {}, settled: {} } : sanitizePlaces(next));
    applyThreadSidebar();
  }
};

const THREAD_ID_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-z]{2,12}_[A-Za-z0-9]{8,64})$/;

const saneTime = (value: unknown, now: number): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 1_500_000_000_000 && value < now + 86_400_000
    ? value
    : undefined;

// Page probe → thread times. Registered at import so the sidebar's first list
// fetch, which lands before settings load, isn't missed.
export const handleThreadTimesMessage = (event: MessageEvent): void => {
  if (event.source !== window) return;
  const data = event.data as { type?: unknown; items?: unknown } | undefined;
  if (!data || data.type !== MESSAGE_TYPES.threadTimes || !Array.isArray(data.items)) return;
  const now = Date.now();
  let changed = false;
  for (const item of data.items.slice(0, 500)) {
    if (!item || typeof item !== "object") continue;
    const { id, createdAt, updatedAt } = item as { id?: unknown; createdAt?: unknown; updatedAt?: unknown };
    if (typeof id !== "string" || !THREAD_ID_PATTERN.test(id)) continue;
    const previous = threadTimes.get(id);
    const next: ThreadTimes = {
      createdAt: saneTime(createdAt, now) ?? previous?.createdAt,
      updatedAt: Math.max(saneTime(updatedAt, now) ?? 0, previous?.updatedAt ?? 0) || undefined,
    };
    if (next.createdAt !== previous?.createdAt || next.updatedAt !== previous?.updatedAt) {
      threadTimes.delete(id);
      threadTimes.set(id, next);
      changed = true;
    }
  }
  while (threadTimes.size > MAX_THREAD_TIMES) {
    const oldest = threadTimes.keys().next().value;
    if (oldest === undefined) break;
    threadTimes.delete(oldest);
  }
  if (changed) applyThreadSidebar();
};

if (typeof window !== "undefined") {
  window.addEventListener("message", handleThreadTimesMessage);
}

// ── DOM helpers ──────────────────────────────────────────────────────────────

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

// The only style this module writes on Claude's nodes. Removing it drops the
// attribute again when nothing else is left, so turning off restores the DOM.
const setOrder = (el: HTMLElement, order: number | null): void => {
  const value = order === null ? "" : String(order);
  if (el.style.order === value) return;
  if (order === null) {
    el.style.removeProperty("order");
    if (!el.getAttribute("style")) el.removeAttribute("style");
  } else {
    el.style.order = value;
  }
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

const svg = (body: string, size = 16, stroke = 1.75): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const ICONS = {
  caret: '<polyline points="6 9 12 15 18 9"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><line x1="20" y1="20" x2="16" y2="16"/>',
  sort: '<line x1="4" y1="7" x2="20" y2="7"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="10" y1="17" x2="14" y2="17"/>',
  compose: '<path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/><path d="M17.5 3.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/>',
  pin: '<path d="M9 4h6l-1 5 3 3v2H7v-2l3-3z"/><line x1="12" y1="14" x2="12" y2="20"/>',
  check: '<polyline points="5 12.5 10 17 19 7.5"/>',
  alert: '<circle cx="12" cy="12" r="8.5"/><line x1="12" y1="8" x2="12" y2="12.5"/><line x1="12" y1="16" x2="12" y2="16"/>',
  dot: '<circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>',
  spinner: '<circle cx="12" cy="12" r="8.5" stroke-dasharray="3.2 3.2"/>',
  chat: '<path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6a2.5 2.5 0 0 1-2.5 2.5H11l-4 3.5V15h0.5"/>',
  cowork: '<path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4"/>',
  routine: '<circle cx="12" cy="12" r="8.5"/><polyline points="12 7.5 12 12 15 14"/>',
  code: '<polyline points="9 7 4 12 9 17"/><polyline points="15 7 20 12 15 17"/>',
  project: '<path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>',
} as const;

const STATUS_ICONS: Record<ThreadStatus, string> = {
  working: ICONS.spinner,
  awaiting: ICONS.spinner,
  error: ICONS.alert,
  done: ICONS.check,
  unread: ICONS.dot,
};

const KIND_ICONS: Record<ThreadKind, string> = {
  chat: ICONS.chat,
  cowork: ICONS.cowork,
  routine: ICONS.routine,
  code: ICONS.code,
  project: ICONS.project,
  other: ICONS.dot,
};

// ── Our nodes ────────────────────────────────────────────────────────────────

const buildButton = (id: string | null, className: string, onClick: () => void): HTMLButtonElement => {
  const button = document.createElement("button");
  button.type = "button";
  if (id) button.id = id;
  button.className = className;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return button;
};

const buildSettledToggle = (): HTMLButtonElement => {
  const toggle = buildButton(SETTLED_TOGGLE_ID, "", () => {
    settledOpen = !settledOpen;
    applyThreadSidebar();
    if (settledOpen) revealSettled(toggle);
  });
  const label = document.createElement("span");
  label.className = "cub-thread-settled-label";
  const rule = document.createElement("span");
  rule.className = "cub-thread-settled-rule";
  rule.setAttribute("aria-hidden", "true");
  toggle.append(label, rule);
  toggle.insertAdjacentHTML("beforeend", svg(ICONS.caret, 12, 2.25).replace("<svg", '<svg class="cub-thread-caret"'));
  return toggle;
};

const buildNavToggle = (): HTMLButtonElement => {
  const toggle = buildButton(NAV_TOGGLE_ID, "", () => {
    navOpen = !navOpen;
    applyThreadSidebar();
  });
  const icon = document.createElement("span");
  icon.className = "cub-thread-nav-icon";
  icon.innerHTML = svg(ICONS.grid);
  const label = document.createElement("span");
  label.className = "cub-thread-nav-label";
  const dot = document.createElement("span");
  dot.className = "cub-thread-nav-dot";
  dot.setAttribute("aria-hidden", "true");
  toggle.append(icon, label, dot);
  toggle.insertAdjacentHTML("beforeend", svg(ICONS.caret, 12, 2.25).replace("<svg", '<svg class="cub-thread-caret"'));
  return toggle;
};

const isMac = (): boolean => /Mac|iPhone|iPad|iPod/.test(navigator.platform) || /Mac OS X/.test(navigator.userAgent);

const isShown = (el: Element): boolean => el.getClientRects().length > 0;

// Claude's own search, from our Search row: its search button in the Threads
// heading where that layout has one; else its top search bar, which this view
// hides in favour of our row; else the shortcut both advertise (Claude's
// keydown handler doesn't check isTrusted — the route the settings panel uses).
const openClaudeSearch = (): void => {
  const scope = document.querySelector(SIDEBAR_SELECTOR)?.closest("aside") ?? document;
  const headingButton = scope.querySelector<HTMLElement>(
    `${GROUP_LABEL_SELECTOR} [aria-keyshortcuts$="+k" i], ${GROUP_LABEL_SELECTOR} [aria-label="Search"]`,
  );
  if (headingButton && isShown(headingButton)) {
    headingButton.click();
    return;
  }
  const searchRow = scope.querySelector<HTMLElement>(SEARCH_ROW_SELECTOR);
  if (searchRow) {
    searchRow.click();
    return;
  }
  const barTrigger = claudeSearchBar?.isConnected
    ? claudeSearchBar.matches('button, [role="button"]')
      ? claudeSearchBar
      : claudeSearchBar.querySelector<HTMLElement>('button, [role="button"]')
    : null;
  if (barTrigger) {
    barTrigger.click();
    return;
  }
  const mac = isMac();
  document.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "k",
      code: "KeyK",
      keyCode: 75,
      which: 75,
      shiftKey: true,
      metaKey: mac,
      ctrlKey: !mac,
      bubbles: true,
      cancelable: true,
    }),
  );
};

// Claude's New row is hidden in this view; its link still does the navigating
// so it stays an in-app route change rather than a page load.
const startNewChat = (): void => {
  const link = document.querySelector<HTMLElement>(NEW_LINK_SELECTOR);
  if (link) link.click();
  else location.assign("/new");
};

const sortOptions = (): { value: ThreadSort; label: string }[] => [
  { value: "edited", label: t("threadSortEdited", "Newest edited") },
  { value: "created", label: t("threadSortCreated", "Newest created") },
];

const sortItems = (menu: Element): HTMLElement[] => [...menu.querySelectorAll<HTMLElement>("[role=menuitemradio]")];

const closeSortMenu = (focusButton = false): void => {
  if (!sortMenuOpen) return;
  sortMenuOpen = false;
  document.removeEventListener("pointerdown", onSortMenuOutside, true);
  const menu = document.querySelector<HTMLElement>(`#${TOP_ROW_ID} .cub-thread-menu`);
  if (menu) menu.hidden = true;
  const button = document.querySelector<HTMLElement>(`#${TOP_ROW_ID} .cub-thread-sort-btn`);
  button?.setAttribute("aria-expanded", "false");
  if (focusButton) button?.focus();
};

const onSortMenuOutside = (event: PointerEvent): void => {
  const wrap = document.querySelector(`#${TOP_ROW_ID} .cub-thread-sort`);
  if (wrap && event.target instanceof Node && wrap.contains(event.target)) return;
  closeSortMenu();
};

const openSortMenu = (): void => {
  const menu = document.querySelector<HTMLElement>(`#${TOP_ROW_ID} .cub-thread-menu`);
  if (!menu) return;
  sortMenuOpen = true;
  menu.hidden = false;
  document.querySelector(`#${TOP_ROW_ID} .cub-thread-sort-btn`)?.setAttribute("aria-expanded", "true");
  document.addEventListener("pointerdown", onSortMenuOutside, true);
  (sortItems(menu).find((item) => item.getAttribute("aria-checked") === "true") ?? sortItems(menu)[0])?.focus();
};

const chooseSort = (next: ThreadSort): void => {
  closeSortMenu(true);
  if (next === sort) return;
  sort = next;
  applyThreadSidebar();
  void updateSettings({ threadSidebarSort: next }).catch(() => undefined);
};

// Sort picker: an icon button with a small menu of our own, so it matches the
// sidebar instead of opening the OS menu.
const buildSortPicker = (): HTMLElement => {
  const wrap = document.createElement("span");
  wrap.className = "cub-thread-sort";
  const button = buildButton(null, "cub-thread-icon-btn cub-thread-sort-btn", () =>
    sortMenuOpen ? closeSortMenu(true) : openSortMenu(),
  );
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  button.innerHTML = svg(ICONS.sort);
  const menu = document.createElement("div");
  menu.className = "cub-thread-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  wrap.append(button, menu);
  wrap.addEventListener("keydown", (event) => {
    if (!sortMenuOpen) return;
    const items = sortItems(menu);
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      // Ours to handle; Claude would otherwise act on it too.
      event.preventDefault();
      event.stopPropagation();
      closeSortMenu(true);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    } else if (event.key === "Tab") {
      closeSortMenu();
    }
  });
  return wrap;
};

const syncSortPicker = (wrap: Element): void => {
  const menu = wrap.querySelector(".cub-thread-menu");
  if (!menu) return;
  const options = sortOptions();
  if (sortItems(menu).length !== options.length) {
    menu.replaceChildren(
      ...options.map(({ value }) => {
        const item = buildButton(null, "cub-thread-menu-item", () => chooseSort(value));
        item.setAttribute("role", "menuitemradio");
        item.dataset.value = value;
        item.innerHTML = `<span class="cub-thread-menu-label"></span>${svg(ICONS.check, 14, 2.5)}`;
        return item;
      }),
    );
  }
  sortItems(menu).forEach((item, index) => {
    const label = item.querySelector(".cub-thread-menu-label");
    if (label) setText(label, options[index].label);
    setAttr(item, "aria-checked", options[index].value === sort ? "true" : "false");
  });
  const button = wrap.querySelector(".cub-thread-sort-btn");
  if (button) {
    const label = t("threadSort", "Sort threads");
    setAttr(button, "aria-label", label);
    setAttr(button, "title", label);
  }
};

// Search, sort and new chat at the top, as in T3.
const buildTopRow = (): HTMLElement => {
  const row = document.createElement("div");
  row.id = TOP_ROW_ID;
  const search = buildButton(null, "cub-thread-search", openClaudeSearch);
  search.innerHTML = `${svg(ICONS.search, 17)}<span class="cub-thread-search-label"></span>`;
  const actions = document.createElement("div");
  actions.id = TOP_ACTIONS_ID;
  const newButton = buildButton(null, "cub-thread-icon-btn cub-thread-new", startNewChat);
  newButton.innerHTML = svg(ICONS.compose);
  actions.append(buildSortPicker(), newButton);
  row.append(search, actions);
  return row;
};

const syncTopRowContent = (row: Element): void => {
  const searchLabel = row.querySelector(".cub-thread-search-label");
  if (searchLabel) setText(searchLabel, t("threadSearch", "Search"));
  const search = row.querySelector(".cub-thread-search");
  if (search) setAttr(search, "aria-label", t("threadSearch", "Search"));
  const sortPicker = row.querySelector(".cub-thread-sort");
  if (sortPicker) syncSortPicker(sortPicker);
  const newButton = row.querySelector(".cub-thread-new");
  if (newButton) {
    const label = t("threadNewChat", "New chat");
    setAttr(newButton, "aria-label", label);
    setAttr(newButton, "title", label);
  }
};

// Claude's own top search bar, in layouts that have one: a *visible*, bar-wide
// control matched by the Ctrl/⌘+Shift+K shortcut it advertises or its
// "Search" label (the icon-only search in the Threads heading and any hidden
// variant for other layouts don't count). Climbs to the outermost wrapper that
// is just the bar, so hiding it leaves no gap. A bar with a text field in it
// filters in place, so it's left alone rather than hidden.
const findClaudeSearchBar = (scope: Element, sidebar: Element): HTMLElement | null => {
  if (claudeSearchBar?.isConnected) return claudeSearchBar;
  claudeSearchBar = null;
  const now = Date.now();
  if (now - searchScanAt < SEARCH_RESCAN_MS) return null;
  searchScanAt = now;
  const scopeWidth = scope.getBoundingClientRect().width;
  const candidates = scope.querySelectorAll<HTMLElement>('[aria-keyshortcuts], [role="search"], button, [role="button"]');
  for (const el of candidates) {
    if (el.hasAttribute("data-cds-icon-only") || el.hasAttribute("data-row-main-button")) continue;
    if (el.closest(`${GROUP_LABEL_SELECTOR}, ${RECENTS_SELECTOR}, ${PINNED_SELECTOR}, ${NAV_ROWS_SELECTOR}, ${OWN_NODE_SELECTOR}`)) {
      continue;
    }
    const shortcut = el.getAttribute("aria-keyshortcuts") ?? "";
    const label = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim();
    if (!/shift\+k$/i.test(shortcut) && !/^search\b/i.test(label)) continue;
    if (!isShown(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < Math.max(120, scopeWidth * 0.45)) continue;
    if (el.querySelector('input, textarea, [contenteditable="true"], [role="searchbox"]')) continue;
    let bar: HTMLElement = el;
    for (let parent = bar.parentElement; parent; parent = bar.parentElement) {
      if (parent === sidebar || parent === scope || parent.childElementCount !== 1) break;
      const parentRect = parent.getBoundingClientRect();
      if (parentRect.width > rect.width + 24 || parentRect.height > rect.height + 20) break;
      bar = parent;
    }
    claudeSearchBar = bar;
    return bar;
  }
  return null;
};

// Our row takes the place of Claude's top search bar when the layout has one,
// otherwise of Claude's New row. Claude's New, search bar and Search row are
// all hidden: our row drives them.
const syncTopRow = (scope: Element, sidebar: Element): void => {
  const newLink = scope.querySelector<HTMLElement>(NEW_LINK_SELECTOR);
  if (newLink) setAttr(newLink, HIDDEN_ATTR, "");
  const searchRow = scope.querySelector<HTMLElement>(SEARCH_ROW_SELECTOR);
  if (searchRow) setAttr(searchRow, HIDDEN_ATTR, "");
  const bar = findClaudeSearchBar(scope, sidebar);

  let row = document.getElementById(TOP_ROW_ID);
  if (bar?.parentElement) {
    setAttr(bar, HIDDEN_ATTR, "");
    if (!row || row.nextElementSibling !== bar) {
      row ??= buildTopRow();
      bar.before(row);
    }
  } else {
    // From the link's parent: the link itself is .shrink-0 in newer markup, and
    // the row must never end up inside the (hidden) link.
    const host = newLink?.parentElement?.closest(".shrink-0") ?? newLink?.parentElement ?? sidebar.firstElementChild;
    if (!host) return;
    if (!row || row.parentElement !== host) {
      row ??= buildTopRow();
      host.insertBefore(row, host.firstChild);
    }
  }
  syncTopRowContent(row);
};

// Our toggles are the only nodes this module adds outside a row. Any copy
// outside its host — left behind when Claude re-rendered the host — is
// dropped, then the host gets one if it needs it.
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

// Alpha of a computed colour: rgb() / rgba() or a modern "… / a" form.
const colorAlpha = (color: string): number => {
  if (!color || color === "transparent") return 0;
  const slash = /\/\s*([\d.]+)(%?)\s*\)$/.exec(color);
  if (slash) return Number(slash[1]) / (slash[2] ? 100 : 1);
  const rgba = /^rgba\((?:[^,]+,){3}\s*([\d.]+)\s*\)$/.exec(color);
  return rgba ? Number(rgba[1]) : 1;
};

// What the sidebar paints behind its rows, as a background value: each
// translucent layer up to the first opaque one, so the Settled bar can cover
// the rows scrolling under it with exactly the colour around it.
const paintedBackground = (from: Element): string => {
  const layers: string[] = [];
  for (let el: Element | null = from; el; el = el.parentElement) {
    const style = getComputedStyle(el);
    const alpha = colorAlpha(style.backgroundColor);
    if (alpha <= 0 || style.display === "contents") continue;
    layers.push(style.backgroundColor);
    if (alpha >= 1) break;
  }
  if (!layers.length) return "";
  // Translucent layers stack as flat gradients over the opaque base (or over
  // the menu surface if nothing up the tree was opaque).
  const base = colorAlpha(layers[layers.length - 1]) >= 1 ? (layers.pop() as string) : "var(--cub-thread-menu-bg)";
  return [...layers.map((color) => `linear-gradient(${color}, ${color})`), base].join(", ");
};

const syncSettledToggle = (recents: Element, settledCount: number): void => {
  const toggle = ensureToggle(SETTLED_TOGGLE_ID, recents, settledCount > 0, buildSettledToggle);
  if (!toggle) return;
  const label = toggle.querySelector(".cub-thread-settled-label");
  if (label) setText(label, t("threadSettled", "Settled ($1)", settledCount));
  setAttr(toggle, "aria-expanded", settledOpen ? "true" : "false");
  sidebarBackground ??= paintedBackground(recents);
  if (toggle.style.getPropertyValue("--cub-thread-bar-bg") !== sidebarBackground) {
    if (sidebarBackground) toggle.style.setProperty("--cub-thread-bar-bg", sidebarBackground);
    else toggle.style.removeProperty("--cub-thread-bar-bg");
  }
};

const scrollParentOf = (el: Element): HTMLElement | null => {
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (/^(auto|scroll|overlay)$/.test(overflowY) && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
};

// The Settled bar is locked to the bottom of the scroll area, so over a long
// list of cards the rows it just opened land out of sight below it. Scroll the
// bar up to the top of the column to show them.
const revealSettled = (toggle: HTMLElement): void => {
  let first: HTMLElement | null = null;
  for (const row of document.querySelectorAll<HTMLElement>('[data-cub-thread="settled"]')) {
    if (!first || Number(row.style.order) < Number(first.style.order)) first = row;
  }
  const scroller = scrollParentOf(toggle);
  if (!first || !scroller) return;
  const view = scroller.getBoundingClientRect();
  const row = first.getBoundingClientRect();
  if (row.bottom <= view.bottom) return;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  scroller.scrollBy?.({
    top: row.top - view.top - toggle.offsetHeight - ROW_GAP_PX,
    behavior: reduceMotion ? "auto" : "smooth",
  });
};

// Projects, Artifacts, Scheduled, Design, Customize and More fold into one row
// under the top row. A status dot Claude shows on any of them (e.g. "Scheduled
// tasks have updates") is mirrored on the folded row so it isn't lost.
const syncNavRows = (sidebar: Element): void => {
  const nav = sidebar.querySelector(NAV_ROWS_SELECTOR);
  const toggle = ensureToggle(NAV_TOGGLE_ID, nav, true, buildNavToggle, true);
  if (!nav || !toggle) return;
  setAttr(nav, NAV_ATTR, navOpen ? "open" : "closed");
  const label = toggle.querySelector(".cub-thread-nav-label");
  if (label) setText(label, t("threadNavLabel", "Projects & tools"));
  setAttr(toggle, "aria-expanded", navOpen ? "true" : "false");
  setAttr(toggle, "data-dot", nav.querySelector(".status-dot") ? "" : null);
};

// Claude's own "Pinned" heading goes: its threads now lead the Threads list. If
// the group is collapsed it stays, so it can still be opened.
const syncPinnedLabel = (pinned: Element): void => {
  const label = pinned.querySelector(GROUP_LABEL_SELECTOR);
  if (!label) return;
  const collapsed = label.querySelector("[data-group-toggle]")?.getAttribute("aria-expanded") === "false";
  setAttr(label, HIDDEN_ATTR, collapsed ? null : "");
};

// The meta line on top of each card: kind chip and label, a pin for pinned
// threads, and the live state or age on the right. It lives inside Claude's row
// link so the whole card stays one click target. Rebuilt only when its shape
// changes; the clock tick just rewrites the time, so a running spinner never
// restarts.
const syncCardMeta = (
  main: Element,
  kind: ThreadKind,
  pinned: boolean,
  status: ThreadStatus | null,
  when: string,
): void => {
  let meta = main.querySelector<HTMLElement>(`:scope > .${META_CLASS}`);
  const shape = [kind, pinned, status ?? "", kindLabel(kind)].join("|");
  if (meta?.dataset.shape === shape) {
    const whenText = meta.querySelector(".cub-thread-when-text");
    if (whenText) setText(whenText, when);
    return;
  }
  if (!meta) {
    meta = document.createElement("span");
    meta.className = META_CLASS;
    main.insertBefore(meta, main.firstChild);
  }
  meta.dataset.shape = shape;
  const label = document.createElement("span");
  label.className = "cub-thread-kind";
  label.textContent = kindLabel(kind);
  const whenEl = document.createElement("span");
  whenEl.className = "cub-thread-when";
  whenEl.dataset.state = status ?? "time";
  if (status) whenEl.innerHTML = svg(STATUS_ICONS[status], 13, status === "done" ? 2.5 : 2);
  const whenText = document.createElement("span");
  whenText.className = "cub-thread-when-text";
  whenText.textContent = when;
  whenEl.append(whenText);
  meta.innerHTML = `<span class="cub-thread-chip" data-kind="${kind}">${svg(KIND_ICONS[kind], 11, 2)}</span>`;
  meta.append(label);
  if (pinned) meta.insertAdjacentHTML("beforeend", `<span class="cub-thread-pin">${svg(ICONS.pin, 12)}</span>`);
  meta.append(whenEl);
};

const removeCardMeta = (main: Element): void => {
  main.querySelector(`:scope > .${META_CLASS}`)?.remove();
};

// T3's Settle, next to Claude's ⋮ on a card's hover: files the thread under
// Settled until it next has activity. Sits on Claude's row box rather than in
// its link, so it's its own button; placed just left of Claude's actions,
// whose width is measured since rows can carry more than one.
const syncSettleButton = (card: HTMLElement, key: string, wanted: boolean): void => {
  let button = card.querySelector<HTMLElement>(`:scope > .${SETTLE_CLASS}`);
  if (!wanted) {
    button?.remove();
    return;
  }
  if (!button) {
    button = buildButton(null, SETTLE_CLASS, () => settleThread(button?.dataset.key ?? ""));
    button.innerHTML = `${svg(ICONS.check, 13, 2.5)}<span class="cub-thread-settle-label"></span>`;
    card.appendChild(button);
  }
  button.dataset.key = key;
  const label = button.querySelector(".cub-thread-settle-label");
  if (label) setText(label, t("threadSettle", "Settle"));
  const actions = card.querySelector<HTMLElement>(":scope > div:not([data-row-main-button])");
  const offset = actions?.offsetWidth ? card.clientWidth - actions.offsetLeft + 2 : 34;
  const inset = `${Math.max(0, Math.round(offset))}px`;
  if (button.style.insetInlineEnd !== inset) button.style.insetInlineEnd = inset;
};

const settleThread = (key: string): void => {
  if (!ROW_KEY_PATTERN.test(key) || !placesLoaded) return;
  settled[key] = Date.now();
  delete opened[key];
  if (activity[key]?.doneAt) {
    delete activity[key];
    saveActivity();
  }
  savePlaces();
  applyThreadSidebar();
};

// Working → done bookkeeping for one row. Returns the status to show, which
// adds "done" for threads that finished while you weren't looking.
const trackActivity = (
  key: string,
  info: ThreadRowInfo,
  now: number,
  looking: boolean,
): { status: ThreadStatus | null; changed: boolean } => {
  const previous = activity[key];
  let next: ThreadActivity | undefined = previous;

  if (info.status === "working" || info.status === "awaiting") {
    seenWorking.add(key);
    next = { workingSince: previous?.workingSince ?? now };
    if (info.status === "awaiting") next.awaitingSince = previous?.awaitingSince ?? now;
  } else if (previous?.workingSince) {
    if (!seenWorking.delete(key)) {
      // Another tab saw it working and this sidebar shows it idle. Show it done
      // here, but leave the shared mark to the tab that saw it working.
      return { status: info.status ?? (looking ? null : "done"), changed: false };
    }
    next = looking ? undefined : { doneAt: now };
  } else if (previous?.doneAt && looking) {
    next = undefined;
  }

  const changed =
    next?.workingSince !== previous?.workingSince ||
    next?.awaitingSince !== previous?.awaitingSince ||
    next?.doneAt !== previous?.doneAt;
  if (next) activity[key] = next;
  else delete activity[key];
  return { status: info.status ?? (next?.doneAt ? "done" : null), changed };
};

// Whether a thread did something after it was settled (by hand, or by the view
// starting): started working or finished, as seen by any tab, or changed in
// Claude's list — which also catches chats made or answered elsewhere.
const activeSince = (key: string, since: number | undefined): boolean => {
  if (since === undefined) return false;
  const local = activity[key];
  const updatedAt = threadTimes.get(threadIdOf(key))?.updatedAt ?? 0;
  return (
    (local?.workingSince ?? 0) >= since ||
    (local?.doneAt ?? 0) >= since ||
    updatedAt > since + SETTLE_GRACE_MS
  );
};

// ── Apply ────────────────────────────────────────────────────────────────────

export const applyThreadSidebar = (): void => {
  if (!enabled) return;
  const sidebar = document.querySelector(SIDEBAR_SELECTOR);
  if (sidebar) {
    // On the whole aside: Claude's search bar, and so our row, can sit above
    // the sidebar body.
    const scope = sidebar.closest("aside") ?? sidebar;
    setAttr(scope, THEME_ATTR, lightTheme ? "light" : "dark");
    syncTopRow(scope, sidebar);
    syncNavRows(sidebar);
  }

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
  const keys = rows.map((row) => row.getAttribute("data-row-key") ?? "");

  // Live state, including our own "done".
  const now = Date.now();
  const visible = document.visibilityState === "visible";
  let activityChanged = false;
  let placesChanged = false;
  rows.forEach((_row, index) => {
    const info = infos[index];
    const key = keys[index];
    if (info.label || info.hidden || !key) return;
    const tracked = trackActivity(key, info, now, info.current && visible);
    info.status = tracked.status;
    activityChanged ||= tracked.changed;
    if (info.pinned || !placesLoaded) return;
    if (opened[key] === undefined && activeSince(key, settled[key] ?? viewSince)) {
      opened[key] = now;
      delete settled[key];
      placesChanged = true;
    }
    info.open = opened[key] !== undefined;
    info.settled = settled[key] !== undefined;
  });
  if (activityChanged) saveActivity();
  if (placesChanged) savePlaces();

  // Display order: labels and pinned rows keep Claude's order; everything else
  // is sorted by the chosen rule, then sectioned.
  const fixed: number[] = [];
  const sortable: number[] = [];
  infos.forEach((info, index) => (info.label || info.hidden || info.pinned ? fixed : sortable).push(index));
  const sortedSortable = threadDisplayOrder(
    sortable.map((index) => {
      const times = threadTimes.get(threadIdOf(keys[index]));
      const local = activity[keys[index]];
      const activityAt = Math.max(local?.workingSince ?? 0, local?.doneAt ?? 0) || undefined;
      return { createdAt: times?.createdAt, updatedAt: times?.updatedAt, activityAt };
    }),
    sort,
  ).map((position) => sortable[position]);
  const ordered = [...fixed, ...sortedSortable];
  const orderedPlacements = placeThreadRows(
    ordered.map((index) => infos[index]),
    !settledOpen,
  );
  const placements: ThreadPlacement[] = [];
  const rank: number[] = [];
  ordered.forEach((index, position) => {
    placements[index] = orderedPlacements[position];
    rank[index] = position;
  });

  const firstOfSection = new Set<number>();
  let earlierSection = false;
  for (const section of CARD_SECTIONS) {
    const position = orderedPlacements.indexOf(section);
    if (position === -1) continue;
    if (earlierSection) firstOfSection.add(ordered[position]);
    earlierSection = true;
  }

  let settledCount = 0;
  const flat = new Set<Element>();

  rows.forEach((row, index) => {
    const placement = placements[index];
    const info = infos[index];
    const key = keys[index];
    setAttr(row, ROW_ATTR, placement);
    setAttr(row, STATUS_ATTR, info.status);
    setAttr(row, FIRST_ATTR, firstOfSection.has(index) ? "" : null);
    const base = ORDER_BASE[placement as keyof typeof ORDER_BASE];
    setOrder(row, base === undefined ? null : base + (placement === "label" ? 0 : rank[index]));
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
    if (card instanceof HTMLElement) {
      setAttr(card, CARD_ATTR, isCard ? "" : null);
      setAttr(card, CURRENT_ATTR, isCard && info.current ? "" : null);
      syncSettleButton(card, key, isCard && placement !== "pinned");
    }
    if (main) {
      if (isCard) {
        const when = threadWhenText(info.status, activity[key], threadTimes.get(threadIdOf(key)), now);
        syncCardMeta(main, threadKindOf(key), Boolean(info.pinned), info.status, when);
      } else {
        removeCardMeta(main);
      }
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
  closeSortMenu();
  document.querySelectorAll<HTMLElement>(`[${ROW_ATTR}]`).forEach((row) => setOrder(row, null));
  document.querySelectorAll(OWN_NODE_SELECTOR).forEach((el) => el.remove());
  const selector = OWN_ATTRS.map((name) => `[${name}]`).join(",");
  document.querySelectorAll(selector).forEach((el) => {
    for (const name of OWN_ATTRS) el.removeAttribute(name);
  });
  claudeSearchBar = null;
  searchScanAt = 0;
  sidebarBackground = null;
};

// ── Lifecycle ────────────────────────────────────────────────────────────────

// Claude swaps its sidebar subtree when switching chat / code modes; re-point
// the scoped observer at whichever sidebar is current.
const attach = (): void => {
  const sidebar = document.querySelector(SIDEBAR_SELECTOR);
  if (sidebar !== observedSidebar) {
    sidebarObserver?.disconnect();
    observedSidebar = sidebar;
    claudeSearchBar = null;
    searchScanAt = 0;
    sidebarBackground = null;
    // Observe the whole aside when there is one: Claude's top search bar can
    // sit outside the sidebar body.
    const target = sidebar?.closest("aside") ?? sidebar;
    if (target) {
      sidebarObserver?.observe(target, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: WATCHED_ATTRIBUTES,
      });
    }
  }
  applyThreadSidebar();
};

const onVisibilityChange = (): void => {
  if (enabled && stillActive()) applyThreadSidebar();
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
  if (clockTimer !== undefined) {
    window.clearInterval(clockTimer);
    clockTimer = undefined;
  }
  document.removeEventListener("visibilitychange", onVisibilityChange);
  if (extensionAlive()) chrome.storage.onChanged?.removeListener(onStorageChanged);
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
  clockTimer = window.setInterval(() => {
    if (stillActive()) applyThreadSidebar();
  }, CLOCK_TICK_MS);
  document.addEventListener("visibilitychange", onVisibilityChange);
  if (extensionAlive()) chrome.storage.onChanged?.addListener(onStorageChanged);
  startedAt = Date.now();
  loadActivity();
  loadPlaces();
  attach();
};

// Turning the view off forgets which threads were open, so turning it back on
// starts from everything settled again.
const stop = (): void => {
  enabled = false;
  stopObserving();
  clearThreadSidebar();
  forgetPlaces();
};

export const initThreadSidebar = (activeInstance: () => boolean): void => {
  isActive = activeInstance;
};

export const syncThreadSidebarTheme = (light: boolean): void => {
  if (lightTheme === light) return;
  lightTheme = light;
  sidebarBackground = null;
  applyThreadSidebar();
};

// Called on every render: cheap when nothing changed, and it re-applies so the
// open-thread highlight follows SPA navigation.
export const syncThreadSidebar = (settings: ThreadSidebarOptions): void => {
  sort = settings.threadSidebarSort === "created" ? "created" : "edited";
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
  sort = "edited";
  lightTheme = false;
  isActive = () => true;
  threadTimes.clear();
  activity = {};
  seenWorking.clear();
  sortMenuOpen = false;
};
