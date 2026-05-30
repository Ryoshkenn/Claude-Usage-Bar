const USER_MSG_SELECTORS = [
  '[data-testid="user-message"]',
  '[data-message-author-role="user"]',
  ".font-user-message",
];

const RAIL_ID = "claude-user-message-rail";
const MIN_MESSAGES = 2;

let railEl: HTMLElement | null = null;
let ioObserver: IntersectionObserver | null = null;
let lastCount = -1;
let activeIndex = -1;
let currentMessages: HTMLElement[] = [];
let clickLockUntil = 0;
let currentThemeIsLight = false;

const CLICK_LOCK_MS = 1800;

const getUserMessages = (): HTMLElement[] => {
  const seen = new Set<HTMLElement>();
  for (const sel of USER_MSG_SELECTORS) {
    document.querySelectorAll<HTMLElement>(sel).forEach((el) => seen.add(el));
  }
  const all = [...seen];
  return all.filter((el) => !all.some((other) => other !== el && other.contains(el)));
};

const clearChildren = (el: HTMLElement): void => {
  while (el.firstChild) el.removeChild(el.firstChild);
};

const setActiveMarker = (index: number, override = false): void => {
  if (!railEl || activeIndex === index) return;
  if (!override && Date.now() < clickLockUntil) return;
  activeIndex = index;
  railEl.querySelectorAll<HTMLElement>(".cub-message-rail-marker").forEach((m, i) => {
    m.classList.toggle("cub-message-rail-marker--active", i === index);
  });
};

const updateActiveFromViewport = (): void => {
  if (currentMessages.length === 0) return;
  const viewportMid = window.innerHeight / 2;
  let closestDist = Infinity;
  let closestIdx = 0;
  currentMessages.forEach((msg, i) => {
    const rect = msg.getBoundingClientRect();
    const dist = Math.abs(rect.top + rect.height / 2 - viewportMid);
    if (dist < closestDist) {
      closestDist = dist;
      closestIdx = i;
    }
  });
  setActiveMarker(closestIdx);
};

const rebuildMarkers = (messages: HTMLElement[]): void => {
  if (!railEl) return;
  currentMessages = messages;
  activeIndex = -1;
  clearChildren(railEl);

  messages.forEach((msg, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cub-message-rail-marker";
    btn.setAttribute("aria-label", `Jump to user message ${i + 1}`);
    btn.setAttribute("title", `User message ${i + 1}`);
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      clickLockUntil = Date.now() + CLICK_LOCK_MS;
      setActiveMarker(i, true);
      msg.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    railEl!.appendChild(btn);
  });

  ioObserver?.disconnect();
  ioObserver = new IntersectionObserver(() => { updateActiveFromViewport(); }, { threshold: 0 });
  messages.forEach((msg) => ioObserver!.observe(msg));

  updateActiveFromViewport();
};

export const syncMessageRailTheme = (isLight: boolean): void => {
  currentThemeIsLight = isLight;
  railEl?.classList.toggle("cub-message-rail--light", isLight);
};

export const tickMessageRail = (): void => {
  const messages = getUserMessages();

  if (messages.length < MIN_MESSAGES) {
    if (railEl) {
      railEl.remove();
      railEl = null;
      ioObserver?.disconnect();
      currentMessages = [];
      lastCount = -1;
      activeIndex = -1;
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
    lastCount = -1;
  }

  if (messages.length !== lastCount) {
    lastCount = messages.length;
    rebuildMarkers(messages);
  }
};
