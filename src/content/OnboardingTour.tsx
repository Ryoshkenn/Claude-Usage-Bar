import { useState, useEffect, useCallback, useRef } from "react";
import { closeSettingsOverlay, isSettingsOverlayOpen, openUsageBarSettings } from "./settingsPage";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface TourStep {
  navigateTo?: string;
  // Open the settings overlay (a modal, opened via Claude's shortcut) and make
  // our panel its active section, instead of navigating to a page route.
  openSettings?: boolean;
  selector: string | null;
  fallbackRect?: () => TargetRect;
  title: string;
  body: string;
  forceShowBar?: boolean;
  postNavDelay?: number;
  scrollIntoView?: boolean;
  allowInteraction?: boolean;
}

const MESSAGE_NAV_STEP = 6;
const CACHE_TIMER_STEP = 7;
const THEME_SYNC_INTERVAL_MS = 500;

// Compute where to render the demo cache timer: centered inside <main> on /new
function getCacheTimerDemoPos(): TargetRect {
  const main = document.querySelector<HTMLElement>("main");
  if (main) {
    const r = main.getBoundingClientRect();
    return { top: r.top + 12, left: r.left + 12, width: 88, height: 28 };
  }
  return { top: Math.round(window.innerHeight * 0.12), left: 12, width: 88, height: 28 };
}

const STEPS: TourStep[] = [
  {
    navigateTo: "/new",
    selector: null,
    title: "Welcome to Claude Usage Bar!",
    body: "Let's take a quick tour of all the features — we'll highlight each one as we go. It only takes a moment.",
  },
  {
    navigateTo: "/new",
    selector: ".cub-meter",
    title: "Usage Bar",
    body: "This bar tracks your Claude plan usage for the current 5-hour window. It turns orange as you approach the limit.",
  },
  {
    navigateTo: "/new",
    selector: ".cub-usage-tooltip",
    title: "Usage Details Panel",
    body: "Hover the bar to open this panel — it shows your 5-hour pace and weekly usage.",
    forceShowBar: true,
  },
  {
    navigateTo: "/new",
    selector: ".cub-usage-link",
    title: "Settings Shortcut",
    body: "This arrow takes you directly to your extension settings. Let's go there now!",
    forceShowBar: true,
  },
  {
    openSettings: true,
    selector: "#cub-section-general",
    title: "Extension Settings",
    body: "Toggle the bar and ring, switch metrics, show labels, adjust pace format, and replay this tour anytime.",
    postNavDelay: 650,
    scrollIntoView: true,
  },
  {
    openSettings: true,
    selector: "#cub-section-usage-metrics",
    title: "Usage metrics learning",
    body: "Claude Usage Bar learns local 5-hour and weekly usage patterns to power smarter pace estimates. Samples stay in this browser — no prompts, responses, or raw payloads are stored. If you'd rather not have this data collected, toggle pattern learning off here.",
    postNavDelay: 200,
    scrollIntoView: true,
    allowInteraction: true,
  },
  {
    navigateTo: "/new",
    selector: null,
    fallbackRect: () => ({
      top: Math.round(window.innerHeight / 2) - 33,
      left: window.innerWidth - 56,
      width: 36,
      height: 66,
    }),
    title: "Message Navigator",
    body: "These dash markers on the right edge let you jump between messages in long conversations with a single click. This only appears inside active chats.",
    postNavDelay: 400,
  },
  {
    navigateTo: "/new",
    selector: null,
    fallbackRect: getCacheTimerDemoPos,
    title: "Cache Timer",
    body: "After Claude responds, this countdown shows how long your prompt cache stays warm — saving tokens on follow-up messages. This only appears in active chats.",
  },
  {
    navigateTo: "/new",
    selector: null,
    title: "All set!",
    body: "You're all caught up on Claude Usage Bar's features. Start a new chat and enjoy!",
  },
];

const PAD = 10;
const ARROW_H = 9; // height of the CSS arrow pointer
const CARD_WIDTH = 268;
const CARD_HEIGHT_APPROX = 210;

// Try to find element with up to maxAttempts retries (250ms each)
async function findElement(
  selector: string | null,
  maxAttempts = 5,
  cancelRef?: React.MutableRefObject<boolean>,
): Promise<TargetRect | null> {
  if (!selector) return null;
  for (let i = 0; i < maxAttempts; i++) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 || r.height > 0) {
        return { top: r.top, left: r.left, width: r.width, height: r.height };
      }
    }
    if (i < maxAttempts - 1) {
      await sleep(250);
      if (cancelRef?.current) return null;
    }
  }
  return null;
}

// Compute card position in viewport space (preferring above the target)
function computeCardPos(
  rect: TargetRect | null,
): { top: number; left: number; arrowSide: "top" | "bottom" | "none"; arrowLeft: number } {
  if (!rect) {
    return {
      top: Math.max(8, (window.innerHeight - CARD_HEIGHT_APPROX) / 2),
      left: Math.max(8, (window.innerWidth - CARD_WIDTH) / 2),
      arrowSide: "none",
      arrowLeft: CARD_WIDTH / 2,
    };
  }

  // Prefer above; fall back to below only if very little space above
  const spaceAbove = rect.top - PAD;
  let top: number;
  let arrowSide: "top" | "bottom";
  if (spaceAbove >= 80) {
    top = Math.max(8, rect.top - PAD - ARROW_H - CARD_HEIGHT_APPROX);
    arrowSide = "bottom";
  } else {
    top = rect.top + rect.height + PAD + ARROW_H;
    arrowSide = "top";
  }

  // Safety net: keep the card on-screen even if the target is tall or partly
  // scrolled out of view, so the step is never positioned where it can't be seen.
  const maxTop = Math.max(8, window.innerHeight - CARD_HEIGHT_APPROX - 8);
  top = Math.min(Math.max(8, top), maxTop);

  const idealLeft = rect.left + rect.width / 2 - CARD_WIDTH / 2;
  const left = Math.max(8, Math.min(idealLeft, window.innerWidth - CARD_WIDTH - 8));
  const arrowLeft = Math.max(16, Math.min(rect.left + rect.width / 2 - left, CARD_WIDTH - 16));

  return { top, left, arrowSide, arrowLeft };
}

const isLightTheme = (): boolean => {
  const el = document.documentElement;
  if (
    el.classList.contains("dark") ||
    el.getAttribute("data-theme") === "dark" ||
    el.getAttribute("data-color-scheme") === "dark"
  ) return false;
  if (
    el.classList.contains("light") ||
    el.getAttribute("data-theme") === "light" ||
    el.getAttribute("data-color-scheme") === "light"
  ) return true;
  return !window.matchMedia("(prefers-color-scheme: dark)").matches;
};

// Get the offset of our tour host from the viewport top-left.
// Non-zero when a parent has a CSS transform, which changes the containing block for fixed children.
function getHostOffset(): { top: number; left: number } {
  const host = document.getElementById("claude-usage-bar-tour");
  if (!host) return { top: 0, left: 0 };
  const r = host.getBoundingClientRect();
  return { top: r.top, left: r.left };
}

interface OnboardingTourProps {
  onComplete: () => void;
}

export const OnboardingTour = ({ onComplete }: OnboardingTourProps) => {
  const [step, setStep] = useState(0);
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [fading, setFading] = useState(false);
  const [light, setLight] = useState(isLightTheme);
  const [hostOffset, setHostOffset] = useState({ top: 0, left: 0 });
  const [demoRailDots, setDemoRailDots] = useState(0);
  const cancelRef = useRef(false);

  const totalSteps = STEPS.length;
  const current = STEPS[step];
  const isLast = step === totalSteps - 1;

  // Recompute host offset (handles CSS transforms on ancestor elements)
  const syncHostOffset = useCallback(() => {
    setHostOffset(getHostOffset());
  }, []);

  useEffect(() => {
    syncHostOffset();
    window.addEventListener("resize", syncHostOffset);
    return () => window.removeEventListener("resize", syncHostOffset);
  }, [syncHostOffset]);

  // Main step execution effect
  useEffect(() => {
    cancelRef.current = false;
    const cancelled = () => cancelRef.current;

    const runStep = async () => {
      const s = STEPS[step];

      if (s.openSettings) {
        // Settings is a modal overlay opened via Claude's shortcut — not a
        // route. Open it and activate our panel as the visible section.
        setFading(true);
        await sleep(180);
        if (cancelled()) return;

        document.body.classList.remove("cub-tour-bar-open");
        await openUsageBarSettings();

        await sleep(s.postNavDelay ?? 650);
        if (cancelled()) return;

        syncHostOffset();
        setFading(false);
      } else {
        // Page step — make sure the settings overlay is dismissed first, so it
        // doesn't sit on top of the page we're about to highlight.
        if (isSettingsOverlayOpen()) {
          setFading(true);
          closeSettingsOverlay();
          await sleep(240);
          if (cancelled()) return;
        }

        if (s.navigateTo && window.location.pathname !== s.navigateTo) {
          setFading(true);
          await sleep(180);
          if (cancelled()) return;

          document.body.classList.remove("cub-tour-bar-open");
          history.pushState(null, "", s.navigateTo);
          window.dispatchEvent(new PopStateEvent("popstate", { state: null }));

          await sleep(s.postNavDelay ?? 700);
          if (cancelled()) return;
        }

        syncHostOffset();
        setFading(false);
      }

      // Force bar tooltip visible if needed
      if (s.forceShowBar) {
        document.body.classList.add("cub-tour-bar-open");
        await sleep(160);
        if (cancelled()) return;
      } else {
        document.body.classList.remove("cub-tour-bar-open");
      }

      // Scroll target into view if requested
      if (s.scrollIntoView && s.selector) {
        const el = document.querySelector<HTMLElement>(s.selector);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          await sleep(400);
          if (cancelled()) return;
          syncHostOffset();
        }
      }

      // Find element with retries, fall back to fallbackRect
      const rect =
        (await findElement(s.selector, 5, cancelRef)) ??
        (s.fallbackRect?.() ?? null);

      if (!cancelled()) {
        setTargetRect(rect);
      }
    };

    void runStep();

    return () => {
      cancelRef.current = true;
    };
  }, [step, syncHostOffset]);

  // Theme observer
  useEffect(() => {
    const syncLight = () => setLight(isLightTheme());
    const obs = new MutationObserver(syncLight);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "data-color-scheme", "style"],
    });
    obs.observe(document.body, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "data-color-scheme", "style"],
    });
    const interval = window.setInterval(() => setLight(isLightTheme()), THEME_SYNC_INTERVAL_MS);
    return () => {
      obs.disconnect();
      window.clearInterval(interval);
    };
  }, []);

  // Animate fake message-rail dots into existence one per second
  useEffect(() => {
    if (step !== MESSAGE_NAV_STEP) {
      setDemoRailDots(0);
      return;
    }
    setDemoRailDots(1);
    const t1 = window.setTimeout(() => setDemoRailDots(2), 1000);
    const t2 = window.setTimeout(() => setDemoRailDots(3), 2000);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [step]);

  // Re-measure on resize
  useEffect(() => {
    const remeasure = () => {
      const s = STEPS[step];
      const el = s.selector ? document.querySelector<HTMLElement>(s.selector) : null;
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 || r.height > 0) {
          setTargetRect({ top: r.top, left: r.left, width: r.width, height: r.height });
          return;
        }
      }
      if (s.fallbackRect) setTargetRect(s.fallbackRect());
    };
    window.addEventListener("resize", remeasure);
    window.addEventListener("scroll", remeasure, true);
    return () => {
      window.removeEventListener("resize", remeasure);
      window.removeEventListener("scroll", remeasure, true);
    };
  }, [step]);

  const dismiss = useCallback(() => {
    cancelRef.current = true;
    document.body.classList.remove("cub-tour-bar-open");
    onComplete();
  }, [onComplete]);

  const next = () => {
    if (step < totalSteps - 1) {
      setTargetRect(null);
      setStep((s) => s + 1);
    } else {
      dismiss();
    }
  };

  const prev = () => {
    if (step > 0) {
      setTargetRect(null);
      setStep((s) => s - 1);
    }
  };

  // Compute demo element overlay positions (viewport coords → overlay-local coords)
  const demoRailStyle = {
    position: "absolute" as const,
    top: Math.round(window.innerHeight / 2) - 33 - hostOffset.top,
    left: window.innerWidth - 56 - hostOffset.left,
    width: 36,
    height: 66,
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "flex-end",
    gap: 6,
    pointerEvents: "none" as const,
  };
  const cachePos = step === CACHE_TIMER_STEP ? getCacheTimerDemoPos() : { top: 0, left: 0, width: 0, height: 0 };
  const demoCacheStyle = {
    position: "absolute" as const,
    top: cachePos.top - hostOffset.top,
    left: cachePos.left - hostOffset.left,
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    height: 28,
    padding: "0 6px",
    borderRadius: 6,
    font: '12px/1 "Anthropic Sans", system-ui, sans-serif',
    color: "rgb(204 124 94)",
    pointerEvents: "none" as const,
    userSelect: "none" as const,
  };

  const cardVp = computeCardPos(targetRect);
  // Adjust for host offset so positioning works even when a parent has CSS transforms
  const spotlightStyle = targetRect
    ? {
        top: targetRect.top - PAD - hostOffset.top,
        left: targetRect.left - PAD - hostOffset.left,
        width: targetRect.width + PAD * 2,
        height: targetRect.height + PAD * 2,
      }
    : null;
  const cardStyle = {
    top: cardVp.top - hostOffset.top,
    left: cardVp.left - hostOffset.left,
    width: CARD_WIDTH,
  };

  const rootClass = [
    "cub-tour-root",
    light ? "cub-tour-light" : "",
    fading ? "cub-tour-fading" : "",
    current.allowInteraction ? "cub-tour-interactive" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const demoRailClass = light ? "cub-tour-demo-rail cub-message-rail--light" : "cub-tour-demo-rail";

  return (
    <div className={rootClass}>
      {/* Interaction blocker — transparent when spotlight dims things, solid when no target */}
      <div
        className="cub-tour-backdrop"
        style={{ background: spotlightStyle ? "transparent" : "rgba(0,0,0,0.52)" }}
      />
      {spotlightStyle && (
        <div className="cub-tour-spotlight" style={spotlightStyle} />
      )}
      {step === MESSAGE_NAV_STEP && demoRailDots > 0 && (
        <div className={demoRailClass} style={demoRailStyle}>
          {Array.from({ length: demoRailDots }, (_, i) => (
            <div
              key={i}
              className={`cub-message-rail-marker${i === demoRailDots - 1 ? " cub-message-rail-marker--active" : ""}`}
              style={{ pointerEvents: "none" }}
            />
          ))}
        </div>
      )}
      {step === CACHE_TIMER_STEP && (
        <div className="cub-tour-demo-cache" style={demoCacheStyle}>
          <svg
            className="cub-cache-timer-icon"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span className="cub-cache-timer-text">4:32</span>
        </div>
      )}
      <div
        className="cub-tour-card"
        style={cardStyle}
        role="dialog"
        aria-label={`Feature tour: ${current.title}`}
      >
        {cardVp.arrowSide === "bottom" && (
          <div
            className="cub-tour-arrow cub-tour-arrow--bottom"
            style={{ left: cardVp.arrowLeft - hostOffset.left }}
          />
        )}
        <div className="cub-tour-step-count">{step + 1} of {totalSteps}</div>
        <div className="cub-tour-title">{current.title}</div>
        <p className="cub-tour-body">{current.body}</p>
        <div className="cub-tour-buttons">
          <button className="cub-tour-btn-skip" type="button" onClick={dismiss}>
            Skip
          </button>
          <div className="cub-tour-nav">
            {step > 0 && (
              <button
                className="cub-tour-btn-back"
                type="button"
                onClick={prev}
                aria-label="Previous step"
              >
                ←
              </button>
            )}
            <button className="cub-tour-btn-next" type="button" onClick={next}>
              {isLast ? "Done" : "Next →"}
            </button>
          </div>
        </div>
        {cardVp.arrowSide === "top" && (
          <div
            className="cub-tour-arrow cub-tour-arrow--top"
            style={{ left: cardVp.arrowLeft - hostOffset.left }}
          />
        )}
      </div>
    </div>
  );
};
