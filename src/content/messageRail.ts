const USER_MSG_SELECTORS = [
  '[data-testid="user-message"]',
  '[data-message-author-role="user"]',
  ".font-user-message",
];

const RAIL_ID = "claude-user-message-rail";
const MIN_MESSAGES = 2;
const CLICK_LOCK_MS = 1800;
// Approximate height of Claude's sticky top bar, so a jump to an unmounted
// message lands the message just below it rather than under the header.
const JUMP_TOP_OFFSET = 88;

// A user message we've seen at least once. claude.ai virtualizes the transcript
// (messages far from the viewport are removed from the DOM), so we can't rely on
// the DOM to hold the whole conversation. Instead we accumulate every message we
// observe and keep it here even after it unmounts. `el` is the live node while
// mounted (null once virtualized away); `top` is its last-known absolute document
// position, used both to order the list and to scroll back to it when unmounted.
interface RailEntry {
  key: string;
  el: HTMLElement | null;
  top: number;
}

let railEl: HTMLElement | null = null;
let ioObserver: IntersectionObserver | null = null;
let scrollBound = false;
let entries: RailEntry[] = [];
let byKey = new Map<string, RailEntry>();
let markerEls: HTMLElement[] = [];
let renderedKeys = "";
let activeKey: string | null = null;
let clickLockUntil = 0;
let currentThemeIsLight = false;
let lastConversationKey = "";

const getUserMessages = (): HTMLElement[] => {
  const seen = new Set<HTMLElement>();
  for (const sel of USER_MSG_SELECTORS) {
    document.querySelectorAll<HTMLElement>(sel).forEach((el) => seen.add(el));
  }
  const all = [...seen];
  return all.filter((el) => !all.some((other) => other !== el && other.contains(el)));
};

// Content-based identity so a message keeps the same marker across unmount /
// remount cycles. Two byte-identical user messages collapse to one marker — rare
// and harmless for a navigator.
const keyOf = (el: HTMLElement): string => {
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  return `${text.length}:${text.slice(0, 160)}`;
};

const snippetOf = (el: HTMLElement): string => {
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  return text.length > 80 ? `${text.slice(0, 80)}…` : text || "User message";
};

// The element the transcript actually scrolls inside — usually an inner
// overflow container, sometimes the window. Detected fresh from a live message
// each pass so we stay correct across layout changes.
const findScroller = (el: HTMLElement): HTMLElement | null => {
  let cur: HTMLElement | null = el.parentElement;
  while (cur) {
    const oy = getComputedStyle(cur).overflowY;
    if ((oy === "auto" || oy === "scroll") && cur.scrollHeight > cur.clientHeight + 4) {
      return cur;
    }
    cur = cur.parentElement;
  }
  return null;
};

const scrollTopOf = (scroller: HTMLElement | null): number =>
  scroller ? scroller.scrollTop : window.scrollY || document.documentElement.scrollTop;

const clearChildren = (el: HTMLElement): void => {
  while (el.firstChild) el.removeChild(el.firstChild);
};

const resetState = (): void => {
  entries = [];
  byKey = new Map();
  markerEls = [];
  renderedKeys = "";
  activeKey = null;
  ioObserver?.disconnect();
  if (railEl) {
    railEl.remove();
    railEl = null;
  }
};

const conversationKey = (): string => location.pathname;

const setActiveKey = (key: string | null, override = false): void => {
  if (!railEl || activeKey === key) return;
  if (!override && Date.now() < clickLockUntil) return;
  activeKey = key;
  const activeIdx = key === null ? -1 : entries.findIndex((e) => e.key === key);
  markerEls.forEach((m, i) => {
    m.classList.toggle("cub-message-rail-marker--active", i === activeIdx);
  });
};

// The mounted message closest to the vertical middle of the viewport is "active".
const updateActiveFromViewport = (): void => {
  const mid = window.innerHeight / 2;
  let closestDist = Infinity;
  let closestKey: string | null = null;
  for (const entry of entries) {
    if (!entry.el || !entry.el.isConnected) continue;
    const rect = entry.el.getBoundingClientRect();
    const dist = Math.abs(rect.top + rect.height / 2 - mid);
    if (dist < closestDist) {
      closestDist = dist;
      closestKey = entry.key;
    }
  }
  if (closestKey !== null) setActiveKey(closestKey);
};

const jumpTo = (entry: RailEntry): void => {
  clickLockUntil = Date.now() + CLICK_LOCK_MS;
  setActiveKey(entry.key, true);

  if (entry.el && entry.el.isConnected) {
    entry.el.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  // Message has been virtualized away — scroll its container to the last-known
  // absolute position so claude.ai re-renders it, then it settles into view.
  const anchor = entries.find((e) => e.el && e.el.isConnected)?.el ?? null;
  const scroller = anchor ? findScroller(anchor) : null;
  const target = Math.max(0, entry.top - JUMP_TOP_OFFSET);
  if (scroller) {
    scroller.scrollTo({ top: target, behavior: "smooth" });
  } else {
    window.scrollTo({ top: target, behavior: "smooth" });
  }
};

const rebuildMarkers = (): void => {
  if (!railEl) return;
  clearChildren(railEl);
  markerEls = entries.map((entry, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cub-message-rail-marker";
    btn.setAttribute("aria-label", `Jump to user message ${i + 1}`);
    btn.title = snippetOf(entry.el ?? document.createElement("div")) || `User message ${i + 1}`;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      jumpTo(entry);
    });
    railEl!.appendChild(btn);
    return btn;
  });
  activeKey = null;
};

// Merge the currently-mounted messages into the persistent list without losing
// anything already seen, then order everything by absolute document position.
const reconcile = (domMsgs: HTMLElement[], scroller: HTMLElement | null): void => {
  const baseScrollTop = scrollTopOf(scroller);

  // Any entry whose element has been virtualized away loses its live ref but
  // keeps its place (via `top`).
  for (const entry of entries) {
    if (entry.el && !entry.el.isConnected) entry.el = null;
  }

  for (const msg of domMsgs) {
    const key = keyOf(msg);
    const top = msg.getBoundingClientRect().top + baseScrollTop;
    const existing = byKey.get(key);
    if (existing) {
      existing.el = msg;
      existing.top = top;
    } else {
      const entry: RailEntry = { key, el: msg, top };
      byKey.set(key, entry);
      entries.push(entry);
    }
  }

  entries.sort((a, b) => a.top - b.top);
};

export const syncMessageRailTheme = (isLight: boolean): void => {
  currentThemeIsLight = isLight;
  railEl?.classList.toggle("cub-message-rail--light", isLight);
};

export const tickMessageRail = (): void => {
  // Switching conversations must start the list over — otherwise markers from
  // the previous chat linger.
  const convo = conversationKey();
  if (convo !== lastConversationKey) {
    lastConversationKey = convo;
    resetState();
  }

  const domMsgs = getUserMessages();
  const scroller = domMsgs.length > 0 ? findScroller(domMsgs[0]) : null;
  reconcile(domMsgs, scroller);

  if (entries.length < MIN_MESSAGES) {
    if (railEl) {
      railEl.remove();
      railEl = null;
      ioObserver?.disconnect();
      renderedKeys = "";
    }
    return;
  }

  if (!railEl) {
    railEl = document.createElement("nav");
    railEl.id = RAIL_ID;
    railEl.className = "cub-message-rail";
    railEl.classList.toggle("cub-message-rail--light", currentThemeIsLight);
    railEl.setAttribute("aria-label", "User message navigation");
    document.body.appendChild(railEl);
    renderedKeys = "";
  }

  const orderKeys = entries.map((e) => e.key).join("");
  if (orderKeys !== renderedKeys) {
    renderedKeys = orderKeys;
    rebuildMarkers();
  }

  // Re-observe only the mounted messages so active tracking follows the viewport
  // as claude.ai swaps nodes in and out during scroll.
  ioObserver?.disconnect();
  ioObserver = new IntersectionObserver(() => updateActiveFromViewport(), { threshold: 0 });
  for (const entry of entries) {
    if (entry.el && entry.el.isConnected) ioObserver.observe(entry.el);
  }

  if (!scrollBound) {
    scrollBound = true;
    let raf = 0;
    window.addEventListener(
      "scroll",
      () => {
        if (raf) return;
        raf = window.requestAnimationFrame(() => {
          raf = 0;
          updateActiveFromViewport();
        });
      },
      { capture: true, passive: true },
    );
  }

  updateActiveFromViewport();
};
