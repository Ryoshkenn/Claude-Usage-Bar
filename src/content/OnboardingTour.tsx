import { useState, useEffect, useCallback } from "react";

interface TourStep {
  selector: string | null;
  title: string;
  body: string;
  forceShowBar?: boolean;
}

const STEPS: TourStep[] = [
  {
    selector: ".cub-meter",
    title: "Usage Bar",
    body: "This bar tracks your Claude plan usage for the current 5-hour window. It fills and turns orange as you approach the limit.",
  },
  {
    selector: ".cub-usage-tooltip",
    title: "Usage Details Panel",
    body: "This panel shows your 5-hour pace, weekly usage, and Design-model spend — hover the bar to open it anytime.",
    forceShowBar: true,
  },
  {
    selector: ".cub-usage-link",
    title: "Settings Shortcut",
    body: "Click this arrow to jump straight to your extension settings page, where you can customize everything.",
    forceShowBar: true,
  },
  {
    selector: "#claude-user-message-rail",
    title: "Message Navigator",
    body: "These dots on the right edge let you jump between messages in a long conversation with one click.",
  },
  {
    selector: ".cub-cache-timer",
    title: "Cache Timer",
    body: "After Claude responds, this shows how long your prompt cache stays warm — saving tokens on follow-up messages.",
  },
  {
    selector: null,
    title: "Your Settings",
    body: "In Settings, toggle the bar and ring, switch metrics, show percentage labels, adjust pace display, and replay this tour anytime.",
  },
];

const PAD = 8;
const CARD_WIDTH = 264;
const CARD_HEIGHT_APPROX = 160;

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function getTargetRect(selector: string | null): TargetRect | null {
  if (!selector) return null;
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

interface CardPosition {
  top: number;
  left: number;
  arrowSide: "top" | "bottom" | "none";
  arrowLeft: number;
}

function computeCardPos(rect: TargetRect | null): CardPosition {
  if (!rect) {
    return {
      top: Math.max(8, (window.innerHeight - CARD_HEIGHT_APPROX) / 2),
      left: Math.max(8, (window.innerWidth - CARD_WIDTH) / 2),
      arrowSide: "none",
      arrowLeft: CARD_WIDTH / 2,
    };
  }

  const spaceAbove = rect.top - PAD;
  const spaceBelow = window.innerHeight - rect.top - rect.height - PAD;
  const preferAbove = spaceAbove >= CARD_HEIGHT_APPROX || spaceAbove >= spaceBelow;

  let top: number;
  let arrowSide: "top" | "bottom";
  if (preferAbove) {
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
  ) {
    return false;
  }
  if (
    el.classList.contains("light") ||
    el.getAttribute("data-theme") === "light" ||
    el.getAttribute("data-color-scheme") === "light"
  ) {
    return true;
  }
  return !window.matchMedia("(prefers-color-scheme: dark)").matches;
};

interface OnboardingTourProps {
  onComplete: () => void;
}

export const OnboardingTour = ({ onComplete }: OnboardingTourProps) => {
  const [step, setStep] = useState(0);
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [light, setLight] = useState(isLightTheme);

  const current = STEPS[step];
  const totalSteps = STEPS.length;
  const isLast = step === totalSteps - 1;

  const measureTarget = useCallback(() => {
    setTargetRect(getTargetRect(current.selector));
  }, [current.selector]);

  useEffect(() => {
    if (current.forceShowBar) {
      document.body.classList.add("cub-tour-bar-open");
    } else {
      document.body.classList.remove("cub-tour-bar-open");
    }
    // Delay measurement to let CSS transitions settle after forceShowBar class is applied
    const t = window.setTimeout(measureTarget, current.forceShowBar ? 160 : 0);
    return () => window.clearTimeout(t);
  }, [step, current.forceShowBar, measureTarget]);

  useEffect(() => {
    window.addEventListener("resize", measureTarget);
    return () => window.removeEventListener("resize", measureTarget);
  }, [measureTarget]);

  useEffect(() => {
    const obs = new MutationObserver(() => setLight(isLightTheme()));
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "data-color-scheme"],
    });
    return () => obs.disconnect();
  }, []);

  const dismiss = useCallback(() => {
    document.body.classList.remove("cub-tour-bar-open");
    onComplete();
  }, [onComplete]);

  const next = () => {
    if (step < totalSteps - 1) {
      setStep((s) => s + 1);
    } else {
      dismiss();
    }
  };

  const cardPos = computeCardPos(targetRect);
  const hasTarget = targetRect !== null;

  return (
    <div className={`cub-tour-root${light ? " cub-tour-light" : ""}`}>
      <div
        className="cub-tour-backdrop"
        style={{ background: hasTarget ? "transparent" : "rgba(0,0,0,0.5)" }}
      />
      {hasTarget && targetRect && (
        <div
          className="cub-tour-spotlight"
          style={{
            top: targetRect.top - PAD,
            left: targetRect.left - PAD,
            width: targetRect.width + PAD * 2,
            height: targetRect.height + PAD * 2,
          }}
        />
      )}
      <div
        className="cub-tour-card"
        style={{ top: cardPos.top, left: cardPos.left, width: CARD_WIDTH }}
        role="dialog"
        aria-label={`Feature tour step ${step + 1} of ${totalSteps}: ${current.title}`}
      >
        {cardPos.arrowSide === "bottom" && (
          <div className="cub-tour-arrow cub-tour-arrow--bottom" style={{ left: cardPos.arrowLeft }} />
        )}
        <div className="cub-tour-step-count">{step + 1} of {totalSteps}</div>
        <div className="cub-tour-title">{current.title}</div>
        <p className="cub-tour-body">{current.body}</p>
        <div className="cub-tour-buttons">
          <button className="cub-tour-btn-skip" type="button" onClick={dismiss}>
            Skip
          </button>
          <button className="cub-tour-btn-next" type="button" onClick={next}>
            {isLast ? "Done" : "Next →"}
          </button>
        </div>
        {cardPos.arrowSide === "top" && (
          <div className="cub-tour-arrow cub-tour-arrow--top" style={{ left: cardPos.arrowLeft }} />
        )}
      </div>
    </div>
  );
};
