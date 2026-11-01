import { useEffect, useState } from "react";
import { t } from "../shared/i18n";
import { CacheTimer } from "./ContentApp";

// Mock-ups shown inside the onboarding tour's card, so a feature can be judged
// before it's switched on. They draw nothing from the page: titles and times
// are made up.

const CACHE_TTL_MS = 5 * 60_000;

const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

// A chat header with the real cache timer in it, counting down from five
// minutes and starting over, as it would after each reply.
export const CacheTimerPreview = () => {
  const [expiresAt, setExpiresAt] = useState(() => Date.now() + CACHE_TTL_MS - 1_000);
  useEffect(() => {
    const id = window.setInterval(() => {
      setExpiresAt((current) => (current - Date.now() < CACHE_TTL_MS - 30_000 ? Date.now() + CACHE_TTL_MS - 1_000 : current));
    }, 1_000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="cub-tour-preview cub-tour-cache-preview" aria-hidden="true">
      <div className="cub-tour-mock-header">
        <span className="cub-tour-mock-title">{t("tourMockThread2", "Weekly report draft")}</span>
        <CacheTimer cacheExpiresAt={expiresAt} />
        <span className="cub-tour-mock-spacer" />
        <span className="cub-tour-mock-pill" />
      </div>
      <div className="cub-tour-mock-chat">
        <span className="cub-tour-mock-bubble cub-tour-mock-bubble--user" />
        <span className="cub-tour-mock-line" />
        <span className="cub-tour-mock-line cub-tour-mock-line--short" />
      </div>
    </div>
  );
};

// One loop of the thread view's story: a thread is started, works, finishes,
// and is settled away. Each phase holds for its duration (ms).
type ThreadPhase = "idle" | "started" | "working" | "done" | "settled";
const THREAD_PHASES: [ThreadPhase, number][] = [
  ["idle", 1_400],
  ["started", 900],
  ["working", 2_600],
  ["done", 2_200],
  ["settled", 2_400],
];

const Spinner = () => (
  <svg className="cub-tour-thread-spinner" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" strokeDasharray="3.2 3.2" />
  </svg>
);

const Check = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="5 12.5 10 17 19 7.5" />
  </svg>
);

const ChatChip = () => (
  <span className="cub-tour-thread-chip">
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6a2.5 2.5 0 0 1-2.5 2.5H11l-4 3.5V15h0.5" />
    </svg>
  </span>
);

// Claude's sidebar beside the thread view, playing the same thread through
// both: in Claude's list it's one more row; in the thread view it's a card
// that shows it working, then done, and is settled out of the way.
export const ThreadViewPreview = () => {
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [workingFor, setWorkingFor] = useState(1);
  const phase = THREAD_PHASES[phaseIndex][0];

  useEffect(() => {
    const id = window.setTimeout(
      () => setPhaseIndex((index) => (index + 1) % THREAD_PHASES.length),
      THREAD_PHASES[phaseIndex][1],
    );
    return () => window.clearTimeout(id);
  }, [phaseIndex]);

  useEffect(() => {
    if (phase !== "started" && phase !== "working") {
      setWorkingFor(1);
      return;
    }
    const id = window.setInterval(() => setWorkingFor((seconds) => seconds + 1), 1_000);
    return () => window.clearInterval(id);
  }, [phase]);

  const fresh = t("tourMockThread1", "Fix the login bug");
  const others = [
    t("tourMockThread2", "Weekly report draft"),
    t("tourMockThread3", "Trip to Lisbon"),
    t("tourMockThread4", "Recipe ideas"),
    t("tourMockThread5", "Gift ideas"),
  ];
  const showFresh = phase !== "idle";
  const freshCard = phase === "started" || phase === "working" || phase === "done";
  const settledCount = others.length - 1 + (phase === "settled" ? 1 : 0);
  const steps: [ThreadPhase, string][] = [
    ["started", t("tourThreadStepStart", "Started")],
    ["working", t("threadStatusWorking", "Working")],
    ["done", t("threadStatusDone", "Done")],
    ["settled", t("threadSettle", "Settle")],
  ];
  const motion = prefersReducedMotion() ? " cub-tour-preview--still" : "";

  return (
    <div className={`cub-tour-preview cub-tour-thread-preview${motion}`} aria-hidden="true">
      <div className="cub-tour-thread-cols">
        <div className="cub-tour-thread-col">
          <div className="cub-tour-thread-heading">{t("tourThreadClaude", "Claude's sidebar")}</div>
          <div className="cub-tour-thread-list">
            <div className={`cub-tour-thread-row${showFresh ? " cub-tour-thread-row--in" : " cub-tour-thread-row--out"}`}>
              {fresh}
            </div>
            {others.map((title) => (
              <div className="cub-tour-thread-row cub-tour-thread-row--in" key={title}>
                {title}
              </div>
            ))}
          </div>
        </div>
        <div className="cub-tour-thread-col cub-tour-thread-col--ours">
          <div className="cub-tour-thread-heading">{t("tourThreadOurs", "Thread view")}</div>
          <div className="cub-tour-thread-list">
            <div
              className={`cub-tour-thread-card${freshCard ? " cub-tour-thread-card--in" : " cub-tour-thread-card--out"}`}
              data-state={phase}
            >
              <span className="cub-tour-thread-meta">
                <ChatChip />
                <span>{t("threadKindChat", "Chat")}</span>
                <span className="cub-tour-thread-when" data-state={phase === "done" ? "done" : "working"}>
                  {phase === "done" ? <Check /> : <Spinner />}
                  {phase === "done"
                    ? t("threadStatusDone", "Done")
                    : t("threadWorkingFor", "Working $1", t("threadAgoSeconds", "$1s", workingFor))}
                </span>
              </span>
              <span className="cub-tour-thread-title">{fresh}</span>
              {phase === "done" && (
                <span className="cub-tour-thread-settle">
                  <Check />
                  {t("threadSettle", "Settle")}
                </span>
              )}
            </div>
            <div className="cub-tour-thread-card cub-tour-thread-card--in">
              <span className="cub-tour-thread-meta">
                <ChatChip />
                <span>{t("threadKindChat", "Chat")}</span>
                <span className="cub-tour-thread-when">{t("threadAgoMinutes", "$1m", 12)}</span>
              </span>
              <span className="cub-tour-thread-title">{others[0]}</span>
            </div>
            <div className={`cub-tour-thread-settled${phase === "settled" ? " cub-tour-thread-settled--bump" : ""}`}>
              <span>{t("threadSettled", "Settled ($1)", settledCount)}</span>
              <span className="cub-tour-thread-rule" />
            </div>
          </div>
        </div>
      </div>
      <ol className="cub-tour-thread-steps">
        {steps.map(([id, label]) => (
          <li key={id} data-active={String(id === phase)}>
            {label}
          </li>
        ))}
      </ol>
    </div>
  );
};
