import { useState, useEffect, useCallback, useRef } from "react";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface TourStep {
  navigateTo?: string;
  selector: string | null;
  fallbackRect?: () => TargetRect;
  title: string;
  body: string;
  forceShowBar?: boolean;
  postNavDelay?: number;
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
    body: "Hover the bar to open this panel — it shows your 5-hour pace, weekly usage, and Design-model spend.",
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
    navigateTo: "/settings/usage-bar",
    selector: "#cub-settings-panel",
    title: "Extension Settings",
    body: "Toggle the bar and ring, switch metrics, show labels, adjust pace format, and replay this tour anytime.",
    postNavDelay: 650,
  },
  {
    navigateTo: "/new",
    selector: "#claude-user-message-rail",
    fallbackRect: () => ({
      top: Math.round(window.innerHeight / 2) - 30,
      left: window.innerWidth - 36,
      width: 16,
      height: 60,
    }),
    title: "Message Navigator",
    body: "These dots on the right edge let you jump between messages in long conversations with a single click.",
    postNavDelay: 750,
  },
  {
    navigateTo: "/new",
    selector: ".cub-cache-timer",
    fallbackRect: () => {
      const trigger = document.querySelector<HTMLElement>('[data-testid="chat-menu-trigger"]');
      if (trigger) {
        const r = trigger.getBoundingClientRect();
        return { top: r.top, left: r.right + 12, width: 90, height: 26 };
      }
      return { top: 14, left: Math.round(window.innerWidth / 2) - 45, width: 90, height: 26 };
    },
    title: "Cache Timer",
    body: "After Claude responds, this countdown shows how long your prompt cache stays warm — saving tokens on follow-up messages.",
  },
  {
    navigateTo: "/new",
    selector: null,
    title: "All set!",
    body: "You're all caught up on Claude Usage Bar's features. Start a new chat and enjoy!",
  },
];

const PAD = 10;
const CARD_WIDTH = 268;
const CARD_HEIGHT_APPROX = 165;

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
    top = Math.max(8, rect.top - PAD - CARD_HEIGHT_APPROX);
    arrowSide = "bottom";
  } else {
    top = rect.top + rect.height + PAD;
    arrowSide = "top";
  }

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

      // Navigate if needed
      if (s.navigateTo && window.location.pathname !== s.navigateTo) {
        setFading(true);
        await sleep(180);
        if (cancelled()) return;

        document.body.classList.remove("cub-tour-bar-open");
        history.pushState(null, "", s.navigateTo);
        window.dispatchEvent(new PopStateEvent("popstate", { state: null }));

        await sleep(s.postNavDelay ?? 700);
        if (cancelled()) return;

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
    const obs = new MutationObserver(() => setLight(isLightTheme()));
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "data-color-scheme"],
    });
    return () => obs.disconnect();
  }, []);

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
    return () => window.removeEventListener("resize", remeasure);
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
  ]
    .filter(Boolean)
    .join(" ");

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
