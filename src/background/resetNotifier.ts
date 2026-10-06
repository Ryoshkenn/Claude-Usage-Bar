// Reset notifications.
//
// MV3 kills the service worker after ~30s idle, so a setTimeout aimed at a reset
// hours away never survives. chrome.alarms is the only thing that reliably wakes
// us. On wake we inject the banner into the tabs that are open at that moment
// and that is the end of it: nothing is persisted, so a reset is announced once,
// when it happens. Deliberately NOT a stored notice replayed on later
// navigations — that made the banner reappear on every new page for hours.
// The toolbar icon is left untouched; the banner is the whole notification.

import { STORAGE_KEYS } from "../shared/constants";
import type { RealUsageSnapshot, ResetKind, Settings } from "../shared/types";
import { getStorage } from "../shared/storage";

const ALARM_PREFIX = "cub-reset-";
export const SESSION_ALARM = `${ALARM_PREFIX}session`;
export const WEEKLY_ALARM = `${ALARM_PREFIX}weekly`;

// Chrome refuses alarms under 30s out; anything sooner just fires immediately.
const MIN_ALARM_DELAY_MS = 35_000;
// Keep the dedupe list short — it only needs to outlive one reset cycle.
const MAX_ANNOUNCED = 12;
// Below this much of the closing window consumed, a reset changes nothing worth
// interrupting for. Not zero, so integer rounding on a single stray message
// doesn't count as "you used Claude".
const MIN_USED_PERCENT_TO_ANNOUNCE = 1;

const isNotifiableUrl = (url: string | undefined): boolean =>
  Boolean(url) &&
  /^https?:/.test(url as string) &&
  // Chrome hard-blocks injection here; attempting it throws and spams the log.
  !(url as string).startsWith("https://chrome.google.com/webstore") &&
  !(url as string).startsWith("https://chromewebstore.google.com");

export const scheduleResetAlarms = async (snapshot: RealUsageSnapshot | undefined): Promise<void> => {
  if (!chrome.alarms) {
    return;
  }

  const now = Date.now();
  const targets: [string, number | undefined][] = [
    [SESSION_ALARM, snapshot?.sessionResetsAt],
    [WEEKLY_ALARM, snapshot?.weeklyAllModelsResetsAt],
  ];

  for (const [name, resetsAt] of targets) {
    await chrome.alarms.clear(name);
    if (typeof resetsAt !== "number" || resetsAt <= now) {
      continue;
    }
    // Fire a hair after the reset so the follow-up fetch sees the new window
    // rather than racing the server on the boundary.
    await chrome.alarms.create(name, { when: Math.max(now + MIN_ALARM_DELAY_MS, resetsAt + 5_000) });
  }
};

const wasAnnounced = async (resetAt: number): Promise<boolean> => {
  const data = await chrome.storage.local.get(STORAGE_KEYS.announcedResets);
  const announced = data[STORAGE_KEYS.announcedResets];
  return Array.isArray(announced) && announced.includes(resetAt);
};

const markAnnounced = async (resetAt: number): Promise<void> => {
  const data = await chrome.storage.local.get(STORAGE_KEYS.announcedResets);
  const announced: number[] = Array.isArray(data[STORAGE_KEYS.announcedResets])
    ? data[STORAGE_KEYS.announcedResets]
    : [];
  const next = [...announced.filter((value) => value !== resetAt), resetAt].slice(-MAX_ANNOUNCED);
  await chrome.storage.local.set({ [STORAGE_KEYS.announcedResets]: next });
};

// Runs inside the target page. Must be fully self-contained: chrome.scripting
// serializes the function, so it closes over nothing from this module.
const renderResetBanner = (title: string, actionLabel: string, claudeUrl: string) => {
  const HOST_ID = "claude-usage-bar-reset-banner";
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement("div");
  host.id = HOST_ID;
  // Shadow DOM so the host page's CSS can't restyle us and ours can't leak out.
  const root = host.attachShadow({ mode: "closed" });
  host.style.cssText =
    "position:fixed;top:16px;right:16px;z-index:2147483647;width:auto;height:auto;margin:0;padding:0;border:0;";

  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .card {
      display: flex; align-items: flex-start; gap: 10px;
      box-sizing: border-box; width: 320px; padding: 12px 14px;
      border-radius: 12px; border: 1px solid rgb(255 255 255 / 10%);
      background: rgb(38 38 36); color: rgb(245 245 241);
      box-shadow: 0 16px 40px rgb(0 0 0 / 38%);
      font-family: ui-sans-serif, -apple-system, "Segoe UI", sans-serif;
      font-size: 13px; line-height: 1.45;
      animation: slide-in 220ms cubic-bezier(0.16, 1, 0.3, 1);
      cursor: pointer; outline: none; transition: background-color 150ms ease;
      /* Horizontal trackpad swipes move the card, not the page history. */
      overscroll-behavior: contain;
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
    .text { flex: 1; min-width: 0; }
    .title { font-weight: 500; }
    .close {
      flex-shrink: 0; width: 20px; height: 20px; padding: 0; border: 0; border-radius: 4px;
      background: none; color: currentColor; opacity: 0.5; cursor: pointer;
      font: inherit; font-size: 15px; line-height: 1;
    }
    .close:hover { opacity: 1; }

    .meter-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
    /* Fixed width + tabular digits so the bar doesn't shift as the count grows. */
    .pct {
      flex-shrink: 0; width: 4ch; font-size: 12px; font-weight: 500;
      font-variant-numeric: tabular-nums; color: rgb(204 124 94);
    }
    .meter-wrap { position: relative; width: 160px; }
    .meter {
      height: 8px; border-radius: 999px; overflow: hidden;
      background: rgb(255 255 255 / 12%);
    }
    @media (prefers-color-scheme: light) { .meter { background: rgb(0 0 0 / 10%); } }
    /* Width is animated from JS (Web Animations) alongside the count; only the
       celebration colour change is a CSS transition. */
    .meter-fill {
      display: block; width: 0; height: 100%; border-radius: inherit;
      background: rgb(204 124 94);
      transition: background-color 380ms ease;
    }
    /* Confetti bursts from the bar, so the layer tracks the bar's own box and
       is allowed to overflow the card. */
    .confetti-layer { position: absolute; inset: 0; pointer-events: none; }
    .confetti {
      position: absolute; top: 1px; width: 6px; height: 6px; border-radius: 1px;
      opacity: 0; animation: confetti-fly 820ms cubic-bezier(0.15, 0.75, 0.3, 1) forwards;
    }
    /* Hold full opacity through most of the flight — fading from frame one read
       as drifting dust rather than a burst. */
    @keyframes confetti-fly {
      0% { opacity: 1; transform: translate(0, 0) rotate(0deg) scale(0.6); }
      25% { transform: translate(calc(var(--dx) * 0.55), calc(var(--dy) * 0.55)) rotate(calc(var(--rot) * 0.4)) scale(1); }
      60% { opacity: 1; }
      100% { opacity: 0; transform: translate(var(--dx), var(--dy)) rotate(var(--rot)) scale(0.85); }
    }
    @media (prefers-reduced-motion: reduce) {
      .card { animation: none; }
    }
  `;

  // The whole card is the link to Claude; only the close button opts out.
  const card = document.createElement("div");
  card.className = "card";
  card.tabIndex = 0;
  card.setAttribute("role", "link");
  card.setAttribute("aria-label", `${title}. ${actionLabel}`);

  const text = document.createElement("div");
  text.className = "text";
  const titleEl = document.createElement("div");
  titleEl.className = "title";
  titleEl.textContent = title;

  const meterRow = document.createElement("div");
  meterRow.className = "meter-row";
  const pct = document.createElement("span");
  pct.className = "pct";
  pct.textContent = "0%";
  const meterWrap = document.createElement("div");
  meterWrap.className = "meter-wrap";
  const meter = document.createElement("div");
  meter.className = "meter";
  const fill = document.createElement("span");
  fill.className = "meter-fill";
  meter.appendChild(fill);
  const confettiLayer = document.createElement("div");
  confettiLayer.className = "confetti-layer";
  meterWrap.append(meter, confettiLayer);
  meterRow.append(pct, meterWrap);
  text.append(titleEl, meterRow);

  const close = document.createElement("button");
  close.className = "close";
  close.type = "button";
  close.setAttribute("aria-label", "Dismiss");
  close.textContent = "×";

  const ORANGE = "rgb(204 124 94)";
  const GREEN = "rgb(122 184 132)";
  const CONFETTI_COLORS = [
    "rgb(122 184 132)",
    "rgb(204 124 94)",
    "rgb(196 168 106)",
    "rgb(150 128 186)",
    "rgb(122 145 176)",
  ];

  const timers: number[] = [];
  const after = (ms: number, fn: () => void) => {
    timers.push(setTimeout(fn, ms) as unknown as number);
  };
  let frame = 0;
  let swipeSettleTimer = 0;

  const dismiss = () => {
    timers.forEach(clearTimeout);
    clearTimeout(swipeSettleTimer);
    cancelAnimationFrame(frame);
    fill.getAnimations().forEach((animation) => animation.cancel());
    host.remove();
  };
  const openClaude = () => {
    window.open(claudeUrl, "_blank", "noopener,noreferrer");
    dismiss();
  };
  close.addEventListener("click", (event) => {
    // Don't let the dismiss click fall through to the card and open Claude.
    event.stopPropagation();
    dismiss();
  });
  card.addEventListener("click", openClaude);
  card.addEventListener("keydown", (event) => {
    if (event.target !== card) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openClaude();
    }
  });

  // Two-finger trackpad swipe. Right flings the card off and dismisses it; left
  // only gives a little and springs back. Trackpads report swipes as wheel
  // events and never send an "end", so a short quiet gap counts as letting go.
  const SWIPE_DISMISS_PX = 90;
  const SWIPE_SETTLE_MS = 140;
  let swipeTravel = 0;
  let swipeLeaving = false;
  const placeCard = (offset: number, transition: string) => {
    card.style.transition = transition;
    card.style.transform = offset === 0 ? "" : `translateX(${offset}px)`;
    card.style.opacity = offset > 0 ? String(Math.max(0.3, 1 - offset / (SWIPE_DISMISS_PX * 1.6))) : "";
  };
  card.addEventListener(
    "wheel",
    (event) => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      // Claim the gesture so Chrome doesn't treat it as back/forward navigation.
      event.preventDefault();
      if (swipeLeaving) return;
      // Fingers moving right report a negative deltaX.
      swipeTravel -= event.deltaX;
      const offset = swipeTravel > 0 ? swipeTravel : Math.max(-40, swipeTravel * 0.25);
      clearTimeout(swipeSettleTimer);
      if (offset >= SWIPE_DISMISS_PX) {
        swipeLeaving = true;
        placeCard(360, "transform 180ms ease-out, opacity 180ms ease-out");
        card.style.opacity = "0";
        after(180, dismiss);
        return;
      }
      placeCard(offset, "none");
      swipeSettleTimer = setTimeout(() => {
        swipeTravel = 0;
        placeCard(0, "transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 240ms ease, background-color 150ms ease");
      }, SWIPE_SETTLE_MS) as unknown as number;
    },
    { passive: false },
  );

  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const burstConfetti = () => {
    for (let i = 0; i < 20; i += 1) {
      const piece = document.createElement("span");
      piece.className = "confetti";
      // Radial burst off the bar. An upward-only spray drifted over the title and
      // read as dust; a full 360° pop with a short throw stays centred on the bar.
      const angle = ((i / 20) * 360 + Math.random() * 14) * (Math.PI / 180);
      const distance = 15 + Math.random() * 24;
      const size = 4 + Math.round(Math.random() * 3);
      piece.style.width = `${size}px`;
      piece.style.height = `${size}px`;
      piece.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
      piece.style.setProperty("--dy", `${Math.sin(angle) * distance * 0.75}px`);
      piece.style.setProperty("--rot", `${Math.random() * 400 - 200}deg`);
      piece.style.left = `${14 + Math.random() * 72}%`;
      piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      piece.style.animationDelay = `${Math.random() * 90}ms`;
      confettiLayer.appendChild(piece);
    }
    after(1_200, () => {
      confettiLayer.replaceChildren();
    });
  };

  card.append(text, close);
  root.append(style, card);
  document.documentElement.appendChild(host);

  const showPercent = (value: number) => {
    pct.textContent = `${Math.round(value * 100)}%`;
  };

  // Count 0 → 100% with the bar, easing in and out, then flash green with
  // confetti and settle back to orange for the rest of the 10s. Reduced motion
  // gets the end state with no celebration.
  if (reduceMotion) {
    fill.style.width = "100%";
    showPercent(1);
  } else {
    // Kicked off from the first frame rather than at injection: frames don't run
    // in a background tab, so the fill starts when the banner is actually seen.
    frame = requestAnimationFrame(() => {
      // The bar is a real Web Animation so it stays smooth even if frames are
      // throttled; the count just reads its eased progress, keeping the two in
      // lockstep.
      const fillAnimation = fill.animate([{ width: "0%" }, { width: "100%" }], {
        duration: 1_600,
        easing: "cubic-bezier(0.65, 0, 0.35, 1)",
        fill: "forwards",
      });
      const tick = () => {
        showPercent(fillAnimation.effect?.getComputedTiming().progress ?? 0);
        frame = requestAnimationFrame(tick);
      };
      tick();
      void fillAnimation.finished.then(
        () => {
          cancelAnimationFrame(frame);
          showPercent(1);
          fill.style.backgroundColor = GREEN;
          burstConfetti();
          after(1_100, () => {
            fill.style.backgroundColor = ORANGE;
          });
        },
        // Cancelled by dismiss — nothing left to celebrate.
        () => undefined,
      );
    });
  }

  after(10_000, dismiss);
};

interface BannerCopy {
  title: string;
  actionLabel: string;
}

const injectInto = async (tabId: number, copy: BannerCopy): Promise<void> => {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: renderResetBanner,
      args: [copy.title, copy.actionLabel, "https://claude.ai/new"],
    });
  } catch {
    // Restricted page, tab closed mid-flight, or permission revoked. Not worth
    // surfacing: the badge and the claude.ai banner still carry the message.
  }
};

// Only tabs whose origin the user actually granted. `chrome.tabs.query` without
// the "tabs" permission still returns tabs we hold host permission for, and the
// injection itself is gated by Chrome regardless.
const bannerTargets = async (scope: Settings["resetBannerScope"]): Promise<number[]> => {
  const urlPattern = scope === "everywhere" ? undefined : "https://claude.ai/*";
  const tabs = await chrome.tabs.query(urlPattern ? { url: urlPattern } : {});
  return tabs
    .filter((tab) => typeof tab.id === "number" && isNotifiableUrl(tab.url))
    .map((tab) => tab.id as number);
};

export const buildBannerCopy = (
  kind: ResetKind,
  translate: (key: string, fallback: string) => string,
): BannerCopy =>
  kind === "session"
    ? {
        title: translate("resetBannerSessionTitle", "Your 5-hour Claude limit reset"),
        actionLabel: translate("resetBannerAction", "Open Claude"),
      }
    : {
        title: translate("resetBannerWeeklyTitle", "Your weekly Claude limit reset"),
        actionLabel: translate("resetBannerAction", "Open Claude"),
      };

export const announceReset = async (
  kind: ResetKind,
  resetAt: number,
  copy: BannerCopy,
  settings: Settings,
  // `force` (the test button) pushes past the once-only dedupe and the
  // idle-window check so it can be pressed repeatedly. Scope is still honoured — testing the delivery path is the point, and we can't inject
  // where the user hasn't granted access anyway.
  // `usedPercentBeforeReset` is how much of the window that just closed was
  // actually consumed; undefined means "unknown", which announces rather than
  // silently swallowing a real rollover.
  options: { force?: boolean; usedPercentBeforeReset?: number } = {},
): Promise<void> => {
  if (settings.resetBannerScope === "off") {
    return;
  }
  if (!options.force) {
    // Nothing was spent in the window that just rolled over, so nothing changed
    // for the user — the meter read empty before and reads empty now. Announcing
    // that is pure noise, and it's the common case for the 5-hour window, which
    // rolls over all night whether or not you touched Claude.
    if (
      typeof options.usedPercentBeforeReset === "number" &&
      options.usedPercentBeforeReset < MIN_USED_PERCENT_TO_ANNOUNCE
    ) {
      return;
    }
    if (await wasAnnounced(resetAt)) {
      return;
    }
    await markAnnounced(resetAt);
  }

  // Fire-and-forget into whatever is open right now. Tabs opened later do not
  // get the banner: the reset was a moment, not a state to keep re-advertising.
  const targets = await bannerTargets(settings.resetBannerScope);
  await Promise.all(targets.map((tabId) => injectInto(tabId, copy)));
};

