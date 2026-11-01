import { useEffect, useRef } from "react";
import { t } from "../shared/i18n";
import type { Settings } from "../shared/types";
import { useLightTheme } from "./OnboardingTour";
import { ThreadViewPreview } from "./tourPreviews";

// A one-time card telling people who already had Usage Bar that the thread view
// is here, with the tour's preview of it. New installs meet it in the tour
// instead, which marks this as seen.

export type ThreadIntroAction = "show" | "mark-seen" | "none";

// "show" for someone who had finished (or skipped) the tour before the thread
// view existed and hasn't been shown this; "mark-seen" if they already turned
// the view on themselves. A tab in the background waits until it's looked at,
// so the card is seen where it's shown.
export const threadIntroAction = (
  settings: Pick<Settings, "hasSeenTour" | "seenThreadViewIntro" | "threadSidebar">,
  visible: boolean,
): ThreadIntroAction => {
  if (!settings.hasSeenTour || settings.seenThreadViewIntro) return "none";
  if (settings.threadSidebar) return "mark-seen";
  return visible ? "show" : "none";
};

interface ThreadViewIntroProps {
  // true: turn the view on; false: no thanks; undefined: closed with Escape.
  onClose: (useIt?: boolean) => void;
}

export const ThreadViewIntro = ({ onClose }: ThreadViewIntroProps) => {
  const light = useLightTheme();
  const acceptRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    acceptRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Ours to handle while the card is up; Claude would act on it too.
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  return (
    <div className={`cub-tour-root${light ? " cub-tour-light" : ""}`}>
      <div className="cub-tour-backdrop" style={{ background: "rgba(0,0,0,0.52)" }} />
      <div
        className="cub-tour-card cub-tour-card--choice cub-tour-card--centered"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cub-thread-intro-title"
      >
        <div className="cub-tour-step-count">{t("introNew", "New in Usage Bar")}</div>
        <div className="cub-tour-title" id="cub-thread-intro-title">
          {t("introThreadTitle", "The thread view is here")}
        </div>
        <p className="cub-tour-body">
          {t(
            "introThreadBody",
            "Your sidebar as cards: threads that need you come first, then finished work, then work still running, and the rest fold under Settled. It works in Code too, and you can turn it on or off any time in Settings under Usage Bar.",
          )}
        </p>
        <ThreadViewPreview />
        <p className="cub-tour-question">{t("tourThreadAsk", "Use the thread view?")}</p>
        <div className="cub-tour-buttons cub-tour-buttons--end">
          <div className="cub-tour-nav">
            <button className="cub-tour-btn-decline" type="button" onClick={() => onClose(false)}>
              {t("tourNoThanks", "No thanks")}
            </button>
            <button className="cub-tour-btn-next" type="button" ref={acceptRef} onClick={() => onClose(true)}>
              {t("tourUseThis", "Use this")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
