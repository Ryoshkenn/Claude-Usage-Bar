import { useState, useEffect, useCallback, useLayoutEffect, useRef } from "react";
import { t } from "../shared/i18n";
import { updateSettings } from "../shared/storage";
import { closeSettingsOverlay, isSettingsOverlayOpen, openUsageBarSettings } from "./settingsPage";
import { CacheTimerPreview, ThreadViewPreview } from "./tourPreviews";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

type StepId =
  | "welcome"
  | "usageBar"
  | "usageDetails"
  | "messageRail"
  | "cacheTimer"
  | "threadView"
  | "settings"
  | "pacing"
  | "done";

// A step that offers its feature: "No thanks" and a "Use it" button in place
// of Next, each saving the choice and moving on.
interface TourChoice {
  setting: "showCacheTimer" | "threadSidebar";
  question: () => string;
  accept: () => string;
}

interface TourStep {
  id: StepId;
  navigateTo?: string;
  // Open the settings overlay (a modal, opened via Claude's shortcut) and make
  // our panel its active section, instead of navigating to a page route.
  openSettings?: boolean;
  selector: string | null;
  fallbackRect?: () => TargetRect;
  title: () => string;
  body: () => string;
  forceShowBar?: boolean;
  postNavDelay?: number;
  scrollIntoView?: boolean;
  allowInteraction?: boolean;
  // Card width; steps with a preview in the card need more room.
  width?: number;
  choice?: TourChoice;
}

const THEME_SYNC_INTERVAL_MS = 500;

// Where the real message rail sits (styles.css: 20px from the right edge,
// centred, 36×18 markers 5px apart), for the demo one.
const DEMO_RAIL_MARKERS = 5;
const DEMO_RAIL_HEIGHT = DEMO_RAIL_MARKERS * 18 + (DEMO_RAIL_MARKERS - 1) * 5;
const getDemoRailRect = (): TargetRect => ({
  top: Math.round(window.innerHeight / 2 - DEMO_RAIL_HEIGHT / 2),
  left: window.innerWidth - 56,
  width: 36,
  height: DEMO_RAIL_HEIGHT,
});

const STEPS: TourStep[] = [
  {
    id: "welcome",
    navigateTo: "/new",
    selector: null,
    title: () => t("tourWelcomeTitle", "Welcome to Claude Usage Bar!"),
    body: () => t("tourWelcomeBody", "A quick look at what it adds to Claude. It only takes a minute."),
  },
  {
    id: "usageBar",
    navigateTo: "/new",
    selector: ".cub-meter",
    title: () => t("tourBarTitle", "Usage bar"),
    body: () =>
      t(
        "tourBarBody",
        "Your 5-hour plan usage, right in the composer. It fills up as you use Claude and turns orange near the limit.",
      ),
  },
  {
    id: "usageDetails",
    navigateTo: "/new",
    selector: ".cub-usage-tooltip",
    title: () => t("tourDetailsTitle", "Usage details"),
    body: () => t("tourDetailsBody", "Hover the bar for the details: your pace, weekly usage, and when each limit resets."),
    forceShowBar: true,
  },
  {
    id: "messageRail",
    navigateTo: "/new",
    selector: null,
    fallbackRect: getDemoRailRect,
    title: () => t("tourRailTitle", "Message navigator"),
    body: () =>
      t(
        "tourRailBody",
        "In a chat, these marks on the right edge stand for your messages, and the bright one is where you are. Click any mark to jump to it.",
      ),
    postNavDelay: 400,
  },
  {
    id: "cacheTimer",
    navigateTo: "/new",
    selector: null,
    title: () => t("tourCacheTitle", "Cache timer"),
    body: () =>
      t(
        "tourCacheBody",
        "After Claude replies, your prompt cache stays warm for a few minutes, so a follow-up costs less of your limit. The cache timer counts that down in the chat header.",
      ),
    width: 340,
    choice: {
      setting: "showCacheTimer",
      question: () => t("tourCacheAsk", "Show the cache timer?"),
      accept: () => t("tourUseIt", "Use it"),
    },
  },
  {
    id: "threadView",
    navigateTo: "/new",
    selector: null,
    title: () => t("tourThreadTitle", "Thread view"),
    body: () =>
      t(
        "tourThreadBody",
        "Turns your sidebar into cards. Threads that need you come first, then finished work, then work still running. Settle a card once you're done with it.",
      ),
    width: 540,
    choice: {
      setting: "threadSidebar",
      question: () => t("tourThreadAsk", "Use the thread view?"),
      accept: () => t("tourUseThis", "Use this"),
    },
  },
  {
    id: "settings",
    navigateTo: "/new",
    selector: ".cub-usage-link",
    title: () => t("tourSettingsTitle", "Settings"),
    body: () =>
      t("tourSettingsBody", "This arrow opens Usage Bar's settings, where you can change any of this. Let's go there now."),
    forceShowBar: true,
  },
  {
    id: "pacing",
    openSettings: true,
    selector: "#cub-section-pacing",
    title: () => t("tourPacingTitle", "Pace estimates"),
    body: () =>
      t(
        "tourPacingBody",
        "Usage Bar learns your 5-hour and weekly usage patterns to estimate your pace. Samples stay in this browser, and no prompts, responses or raw data are stored. Turn pacing off here if you'd rather not.",
      ),
    postNavDelay: 650,
    scrollIntoView: true,
    allowInteraction: true,
  },
  {
    id: "done",
    navigateTo: "/new",
    selector: null,
    title: () => t("tourDoneTitle", "All set!"),
    body: () =>
      t(
        "tourDoneBody",
        "Everything else is in Settings under Usage Bar, and you can replay this tour from there under General.",
      ),
  },
];

const PAD = 10;
const ARROW_H = 9; // height of the CSS arrow pointer
const CARD_WIDTH = 280;
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

// Compute card position in viewport space (preferring above the target), from
// the card's measured size.
function computeCardPos(
  rect: TargetRect | null,
  card: { width: number; height: number },
): { top: number; left: number; arrowSide: "top" | "bottom" | "none"; arrowLeft: number } {
  if (!rect) {
    return {
      top: Math.max(8, (window.innerHeight - card.height) / 2),
      left: Math.max(8, (window.innerWidth - card.width) / 2),
      arrowSide: "none",
      arrowLeft: card.width / 2,
    };
  }

  // Prefer above; fall back to below only if very little space above
  const spaceAbove = rect.top - PAD;
  let top: number;
  let arrowSide: "top" | "bottom";
  if (spaceAbove >= 80) {
    top = Math.max(8, rect.top - PAD - ARROW_H - card.height);
    arrowSide = "bottom";
  } else {
    top = rect.top + rect.height + PAD + ARROW_H;
    arrowSide = "top";
  }

  // Safety net: keep the card on-screen even if the target is tall or partly
  // scrolled out of view, so the step is never positioned where it can't be seen.
  const maxTop = Math.max(8, window.innerHeight - card.height - 8);
  top = Math.min(Math.max(8, top), maxTop);

  const idealLeft = rect.left + rect.width / 2 - card.width / 2;
  const left = Math.max(8, Math.min(idealLeft, window.innerWidth - card.width - 8));
  const arrowLeft = Math.max(16, Math.min(rect.left + rect.width / 2 - left, card.width - 16));

  return { top, left, arrowSide, arrowLeft };
}

// Claude marks its theme with data-mode on <html> (older builds: a class,
// data-theme or data-color-scheme); without one, the OS setting decides.
const isLightTheme = (): boolean => {
  const el = document.documentElement;
  if (
    el.classList.contains("dark") ||
    el.getAttribute("data-mode") === "dark" ||
    el.getAttribute("data-theme") === "dark" ||
    el.getAttribute("data-color-scheme") === "dark"
  ) return false;
  if (
    el.classList.contains("light") ||
    el.getAttribute("data-mode") === "light" ||
    el.getAttribute("data-theme") === "light" ||
    el.getAttribute("data-color-scheme") === "light"
  ) return true;
  return !window.matchMedia("(prefers-color-scheme: dark)").matches;
};

// Follows Claude's theme while the tour (or another card drawn in its layer)
// is up.
export const useLightTheme = (): boolean => {
  const [light, setLight] = useState(isLightTheme);
  useEffect(() => {
    const syncLight = () => setLight(isLightTheme());
    const obs = new MutationObserver(syncLight);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-mode", "data-theme", "data-color-scheme", "style"],
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
  return light;
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
  const light = useLightTheme();
  const [hostOffset, setHostOffset] = useState({ top: 0, left: 0 });
  const [demoRailDots, setDemoRailDots] = useState(0);
  const [demoRailActive, setDemoRailActive] = useState(0);
  const [cardSize, setCardSize] = useState({ width: CARD_WIDTH, height: CARD_HEIGHT_APPROX });
  const cancelRef = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const totalSteps = STEPS.length;
  const current = STEPS[step];
  const isLast = step === totalSteps - 1;
  const cardWidth = Math.min(current.width ?? CARD_WIDTH, window.innerWidth - 16);

  // Recompute host offset (handles CSS transforms on ancestor elements)
  const syncHostOffset = useCallback(() => {
    setHostOffset(getHostOffset());
  }, []);

  useEffect(() => {
    syncHostOffset();
    window.addEventListener("resize", syncHostOffset);
    return () => window.removeEventListener("resize", syncHostOffset);
  }, [syncHostOffset]);

  // The card's real size places it; previews make some steps much taller.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const measure = () =>
      setCardSize((previous) =>
        previous.width === el.offsetWidth && previous.height === el.offsetHeight
          ? previous
          : { width: el.offsetWidth, height: el.offsetHeight },
      );
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [step]);

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

  // Demo message rail: the markers come in one by one, then the bright one
  // moves down them the way it follows you through a chat.
  useEffect(() => {
    if (current.id !== "messageRail") {
      setDemoRailDots(0);
      setDemoRailActive(0);
      return;
    }
    let dots = 0;
    let active = 0;
    setDemoRailDots(0);
    const id = window.setInterval(() => {
      if (dots < DEMO_RAIL_MARKERS) {
        dots += 1;
        active = dots - 1;
        setDemoRailDots(dots);
      } else {
        active = (active + 1) % DEMO_RAIL_MARKERS;
      }
      setDemoRailActive(active);
    }, 450);
    return () => window.clearInterval(id);
  }, [current.id]);

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

  const choose = (choice: TourChoice, value: boolean) => {
    void updateSettings({ [choice.setting]: value }).catch(() => undefined);
    next();
  };

  const railRect = getDemoRailRect();
  const demoRailStyle = {
    position: "absolute" as const,
    top: railRect.top - hostOffset.top,
    left: railRect.left - hostOffset.left,
    width: railRect.width,
    height: railRect.height,
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "flex-end",
    gap: 5,
    pointerEvents: "none" as const,
  };

  const cardVp = computeCardPos(targetRect, { width: cardWidth, height: cardSize.height });
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
    width: cardWidth,
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
  const title = current.title();

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
      {current.id === "messageRail" && demoRailDots > 0 && (
        <div className={demoRailClass} style={demoRailStyle}>
          {Array.from({ length: demoRailDots }, (_, i) => (
            <div
              key={i}
              className={`cub-message-rail-marker${i === demoRailActive ? " cub-message-rail-marker--active" : ""}`}
              style={{ pointerEvents: "none" }}
            />
          ))}
        </div>
      )}
      <div
        ref={cardRef}
        className={`cub-tour-card${current.choice ? " cub-tour-card--choice" : ""}`}
        style={cardStyle}
        role="dialog"
        aria-label={t("tourAria", "Feature tour: $1", title)}
      >
        {cardVp.arrowSide === "bottom" && (
          <div
            className="cub-tour-arrow cub-tour-arrow--bottom"
            style={{ left: cardVp.arrowLeft }}
          />
        )}
        {/* Scrolls when the card is taller than the window (a short window, or
            zoomed in), so its buttons stay reachable; the arrows stay outside. */}
        <div className="cub-tour-card-scroll">
          <div className="cub-tour-step-count">{t("tourStepCount", "$1 of $2", [step + 1, totalSteps])}</div>
          <div className="cub-tour-title">{title}</div>
          <p className="cub-tour-body">{current.body()}</p>
          {current.id === "cacheTimer" && <CacheTimerPreview />}
          {current.id === "threadView" && <ThreadViewPreview />}
          {current.choice && <p className="cub-tour-question">{current.choice.question()}</p>}
          <div className="cub-tour-buttons">
            <button className="cub-tour-btn-skip" type="button" onClick={dismiss}>
              {t("tourSkip", "Skip")}
            </button>
            <div className="cub-tour-nav">
              {step > 0 && (
                <button
                  className="cub-tour-btn-back"
                  type="button"
                  onClick={prev}
                  aria-label={t("tourBack", "Previous step")}
                >
                  ←
                </button>
              )}
              {current.choice ? (
                <>
                  <button className="cub-tour-btn-decline" type="button" onClick={() => choose(current.choice!, false)}>
                    {t("tourNoThanks", "No thanks")}
                  </button>
                  <button className="cub-tour-btn-next" type="button" onClick={() => choose(current.choice!, true)}>
                    {current.choice.accept()}
                  </button>
                </>
              ) : (
                <button className="cub-tour-btn-next" type="button" onClick={next}>
                  {isLast ? t("tourDone", "Done") : t("tourNext", "Next →")}
                </button>
              )}
            </div>
          </div>
        </div>
        {cardVp.arrowSide === "top" && (
          <div
            className="cub-tour-arrow cub-tour-arrow--top"
            style={{ left: cardVp.arrowLeft }}
          />
        )}
      </div>
    </div>
  );
};
