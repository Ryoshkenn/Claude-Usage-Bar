import { Fragment, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import type {
  ChatUsage,
  MetricTarget,
  PaceSurplusFormat,
  RealUsageSnapshot,
  Settings,
  UsageLogEntry,
  UsageProjection,
  WeeklyUsageMetrics,
} from "../shared/types";
import { STORAGE_KEYS } from "../shared/constants";
import { t } from "../shared/i18n";

const STORE_URL =
  "https://chromewebstore.google.com/detail/claude-usage-bar/eiddfcnlmiebkbnaopcgambdbnlangai";
import {
  computeSessionProjection,
  computeWeeklyProjection,
  formatEta,
} from "../shared/usageProjection";
import {
  computeModelAwareSessionProjection,
  computeSessionMessagesLeft,
  getContextLimitTokens,
  normalizeModelFamily,
} from "../shared/modelUsage";
import { PromptClipboard } from "./PromptClipboard";
import { ContextBreakdownPanel } from "./ContextBreakdownPanel";
import { openUsageBarSettings } from "./settingsPage";

interface ContentAppProps {
  settings: Settings;
  chatUsage: ChatUsage;
  realUsageSnapshot?: RealUsageSnapshot;
  usageHistory?: UsageLogEntry[];
  weeklyUsageMetrics?: WeeklyUsageMetrics;
  // Fired on hover of the bar / context wheel so the host can request fresh data.
  onHoverBar?: () => void;
  onHoverWheel?: () => void;
}

const clampPercentage = (value: number): number => Math.min(100, Math.max(0, Math.round(value)));

const getRealUsagePercentage = (realUsageSnapshot?: RealUsageSnapshot): number | null => {
  if (typeof realUsageSnapshot?.percentageUsed === "number") {
    return clampPercentage(realUsageSnapshot.percentageUsed);
  }

  if (
    typeof realUsageSnapshot?.usedMessages === "number" &&
    typeof realUsageSnapshot.totalMessages === "number" &&
    realUsageSnapshot.totalMessages > 0
  ) {
    return clampPercentage((realUsageSnapshot.usedMessages / realUsageSnapshot.totalMessages) * 100);
  }

  if (
    typeof realUsageSnapshot?.remainingMessages === "number" &&
    typeof realUsageSnapshot.totalMessages === "number" &&
    realUsageSnapshot.totalMessages > 0
  ) {
    return clampPercentage(
      ((realUsageSnapshot.totalMessages - realUsageSnapshot.remainingMessages) / realUsageSnapshot.totalMessages) * 100,
    );
  }

  return null;
};

// The percent shows how full the model's context window is (context length vs
// the model-specific limit from getContextLimitTokens). Total tokens used
// (compounded across all inferences) can exceed the window size.
const getContextFillPercentage = (chatUsage: ChatUsage, contextLimit: number): number => {
  const tokens = chatUsage.currentContextTokens ?? chatUsage.estimatedTokens;
  if (!(tokens > 0) || !(contextLimit > 0)) {
    return 0;
  }
  return clampPercentage((tokens / contextLimit) * 100);
};

// The Fable weekly-scoped limit, when the plan exposes one. Matched by model
// family so it survives label variations ("Fable 5", "Fable", etc.).
const getFableWeeklyPercentage = (
  realUsageSnapshot: RealUsageSnapshot | undefined,
): number | null => {
  const scoped = realUsageSnapshot?.weeklyScopedLimits?.find(
    (limit) => normalizeModelFamily(limit.modelLabel) === "fable",
  );
  return typeof scoped?.percentageUsed === "number"
    ? clampPercentage(scoped.percentageUsed)
    : null;
};

const getMetricPercentage = (
  metric: MetricTarget,
  realUsageSnapshot: RealUsageSnapshot | undefined,
  chatUsage: ChatUsage,
  contextLimit: number,
): number | null => {
  switch (metric) {
    case "session":
      return getRealUsagePercentage(realUsageSnapshot);
    case "weekly":
      return typeof realUsageSnapshot?.weeklyAllModelsPercentageUsed === "number"
        ? clampPercentage(realUsageSnapshot.weeklyAllModelsPercentageUsed)
        : null;
    case "weekly_fable":
      return getFableWeeklyPercentage(realUsageSnapshot);
    case "context":
      return getContextFillPercentage(chatUsage, contextLimit);
  }
};

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheTimerProps {
  cacheExpiresAt?: number;
  fallbackStartedAt?: number | null;
}

export const CacheTimer = ({ cacheExpiresAt, fallbackStartedAt = null }: CacheTimerProps) => {
  const [now, setNow] = useState(Date.now());
  const [hovered, setHovered] = useState(false);
  const activeExpiresAt =
    typeof cacheExpiresAt === "number"
      ? cacheExpiresAt
      : typeof fallbackStartedAt === "number"
        ? fallbackStartedAt + CACHE_TTL_MS
        : null;

  useEffect(() => {
    if (activeExpiresAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [activeExpiresAt]);

  if (activeExpiresAt === null) {
    return (
      <span
        className="cub-cache-timer"
        data-unknown="true"
        role="status"
        aria-label={t("cacheTimingUnavailable", "Prompt cache timing unavailable")}
      >
        <span className="cub-cache-timer-trigger">
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
            <path d="M5 22h14" />
            <path d="M5 2h14" />
            <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" />
            <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />
          </svg>
          <span className="cub-cache-timer-text">{t("cacheUnknown", "cache unknown")}</span>
        </span>
      </span>
    );
  }

  const remaining = Math.max(0, activeExpiresAt - now);
  const expired = remaining === 0;
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  const display = `${minutes}:${seconds.toString().padStart(2, "0")}`;
  const warning = !expired && remaining < 60_000;

  return (
    <span
      className="cub-cache-timer"
      data-expired={String(expired)}
      data-warning={String(warning)}
      role="timer"
      aria-label={
        expired
          ? t("cacheExpired", "Prompt cache expired")
          : t("cacheExpiresIn", "Prompt cache expires in $1", display)
      }
    >
      <span
        className="cub-cache-timer-trigger"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
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
          <path d="M5 22h14" />
          <path d="M5 2h14" />
          <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" />
          <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />
        </svg>
        <span className="cub-cache-timer-text">{expired ? t("expiredShort", "expired") : display}</span>
      </span>
      <span
        className={`cub-cache-timer-tooltip${hovered ? " cub-cache-timer-tooltip--visible" : ""}`}
        role="tooltip"
      >
        {expired
          ? t("cacheHasExpired", "Prompt cache has expired")
          : t("cacheExpiresIn", "Prompt cache expires in $1", display)}
        <br />
        {t("cacheSavings", "Cached tokens save ~90% input cost")}
      </span>
    </span>
  );
};

interface PaceSummary {
  text: string;
  kind: "good" | "bad";
}

// Weekly "Percentage at reset": always the projected percent, whatever the
// projection's status. Reaching 100% means running out before reset, so only
// staying under it counts as good.
const buildPercentAtResetSummary = (
  projection: UsageProjection | null,
  usedPercent: number | undefined,
): PaceSummary | null => {
  if (!projection || projection.status === "insufficient_data" || typeof usedPercent !== "number") {
    return null;
  }
  const projected = Math.round(
    Math.max(usedPercent, projection.projectedPercentAtReset ?? (projection.status === "projected_empty" ? 100 : usedPercent)),
  );
  return {
    text: t("pacePctAtReset", "$1% at reset", projected),
    kind: projected < 100 ? "good" : "bad",
  };
};

const buildPaceSummary = (
  projection: UsageProjection | null,
  usedPercent: number | undefined,
  resetsAt: number | undefined,
  format: PaceSurplusFormat,
  now: number,
): PaceSummary | null => {
  if (!projection) return null;

  if (projection.status === "lasting_to_reset") {
    if (
      format === "percent" &&
      typeof projection.drainRatePerHour === "number" &&
      projection.drainRatePerHour > 0 &&
      typeof usedPercent === "number" &&
      typeof resetsAt === "number"
    ) {
      const projectedPercent =
        typeof projection.projectedPercentAtReset === "number"
          ? Math.round(projection.projectedPercentAtReset)
          : (() => {
              const hoursUntilReset = Math.max(0, (resetsAt - now) / 3_600_000);
              return Math.min(
                100,
                Math.max(0, Math.round(usedPercent + projection.drainRatePerHour * hoursUntilReset)),
              );
            })();
      return { text: t("pacePctAtReset", "$1% at reset", projectedPercent), kind: "good" };
    }

    if (format === "time" && typeof projection.etaMs === "number" && typeof resetsAt === "number") {
      const surplusMs = projection.etaMs - resetsAt;
      if (surplusMs > 60_000) {
        return { text: t("pacePastReset", "+$1 past reset", formatEta(surplusMs, 0)), kind: "good" };
      }
    }

    return { text: t("lastsToReset", "lasts to reset"), kind: "good" };
  }

  if (projection.status === "projected_empty" && typeof projection.etaMs === "number") {
    if (typeof projection.activeHoursUntilEmpty === "number") {
      return {
        text: t("paceActiveLeft", "~$1h active left", Math.ceil(projection.activeHoursUntilEmpty)),
        kind: "bad",
      };
    }

    if (projection.calendarEta === true) {
      const date = new Date(projection.etaMs);
      const dateLabel = date.toLocaleString(undefined, {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      });
      return { text: t("paceEmptyDate", "empty $1", dateLabel), kind: "bad" };
    }

    if (format === "percent" && typeof usedPercent === "number") {
      const projectedPercent =
        typeof projection.projectedPercentAtReset === "number"
          ? Math.round(projection.projectedPercentAtReset)
          : 100;
      return {
        text: t("pacePctAtReset", "$1% at reset", Math.max(usedPercent, projectedPercent)),
        kind: "bad",
      };
    }

    return { text: t("paceEmptyIn", "empty in $1", formatEta(projection.etaMs, now)), kind: "bad" };
  }

  return null;
};

const buildMessagesSummary = (messagesLeft: number | null): PaceSummary | null => {
  if (typeof messagesLeft !== "number") {
    return null;
  }
  return {
    text:
      messagesLeft === 1
        ? t("paceMsgLeft", "~$1 msg left", messagesLeft)
        : t("paceMsgsLeft", "~$1 msgs left", messagesLeft),
    kind: messagesLeft <= 5 ? "bad" : "good",
  };
};

const ringMetricLabel = (metric: string): string | undefined => {
  switch (metric) {
    case "session":
      return t("ringSession", "5-hour session");
    case "weekly":
      return t("ringWeekly", "Weekly · all models");
    case "weekly_fable":
      return t("ringWeeklyFable", "Weekly · Fable");
    case "context":
      return t("ringContext", "Context window");
    default:
      return undefined;
  }
};

export const ContentApp = ({
  settings,
  chatUsage,
  realUsageSnapshot,
  usageHistory,
  weeklyUsageMetrics,
  onHoverBar,
  onHoverWheel,
}: ContentAppProps) => {
  const [showReviewBanner, setShowReviewBanner] = useState(false);
  const [isBreakdownOpen, setIsBreakdownOpen] = useState(false);
  // Hovering the percent opens the breakdown panel; the close is delayed so the
  // pointer can cross the gap between the label and the floating panel.
  const breakdownCloseTimer = useRef<number | null>(null);

  const openBreakdown = () => {
    if (breakdownCloseTimer.current !== null) {
      window.clearTimeout(breakdownCloseTimer.current);
      breakdownCloseTimer.current = null;
    }
    setIsBreakdownOpen(true);
  };

  const scheduleBreakdownClose = () => {
    if (breakdownCloseTimer.current !== null) {
      window.clearTimeout(breakdownCloseTimer.current);
    }
    breakdownCloseTimer.current = window.setTimeout(() => {
      breakdownCloseTimer.current = null;
      setIsBreakdownOpen(false);
    }, 150);
  };

  useEffect(
    () => () => {
      if (breakdownCloseTimer.current !== null) {
        window.clearTimeout(breakdownCloseTimer.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      return;
    }

    void chrome.storage.local
      .get([STORAGE_KEYS.reviewBannerDismissedAt, STORAGE_KEYS.installedAt])
      .then((data) => {
        const dismissedAt = data[STORAGE_KEYS.reviewBannerDismissedAt] as number | undefined;
        const installedAt = data[STORAGE_KEYS.installedAt] as number | undefined;

        if (dismissedAt && Date.now() - dismissedAt < 30 * 24 * 60 * 60 * 1000) return;
        if (!usageHistory || usageHistory.length < 100) return;

        const firstUseAt = installedAt ?? usageHistory[0]?.capturedAt;
        if (!firstUseAt || Date.now() - firstUseAt < 7 * 24 * 60 * 60 * 1000) return;

        setShowReviewBanner(true);
      });
  }, [usageHistory]);

  const dismissReviewBanner = (e: MouseEvent) => {
    e.stopPropagation();
    setShowReviewBanner(false);
    void chrome.storage.local.set({ [STORAGE_KEYS.reviewBannerDismissedAt]: Date.now() });
  };

  if (!settings.showOverlay) {
    return null;
  }

  const barMetric = settings.barMetric ?? "session";
  const ringTarget = settings.ringTarget ?? "context";
  const showBar = settings.showBar !== false;
  const showBarLabel = settings.showBarLabel === true;
  const showWheel = settings.showWheel !== false;
  const contextDisplay = settings.contextDisplay ?? "ring";
  const showPace = settings.showPace !== false;
  const showClipboard = settings.showClipboard !== false;

  // Model-aware window: Opus 5 / Sonnet 5 / Fable 5.1 get 1M, Opus 4.6–4.8 and
  // Sonnet 4.6 get 500K, everything else (and unknown models) 200K. The label
  // is detected live from the composer, so switching models resizes the scale.
  const contextLimit = getContextLimitTokens(realUsageSnapshot?.modelLabel);

  const barPercentage = getMetricPercentage(barMetric, realUsageSnapshot, chatUsage, contextLimit);
  const barWidth = typeof barPercentage === "number" ? barPercentage : 0;
  const barDisplay = typeof barPercentage === "number" ? `${barPercentage}%` : "—";

  const ringPercentage =
    ringTarget === "hidden" ? 0 : (getMetricPercentage(ringTarget, realUsageSnapshot, chatUsage, contextLimit) ?? 0);

  const isRefreshingContext = Boolean(chatUsage.isRefreshingContext);
  const contextLengthTokens = chatUsage.currentContextTokens ?? chatUsage.estimatedTokens;
  const contextFillPercentage = getContextFillPercentage(chatUsage, contextLimit);
  const contextBreakdown = chatUsage.contextBreakdown;
  // The breakdown panel is the only context view. Before the first count lands
  // (fresh chat, first fetch in flight) it opens with just the headline total.
  // A recount (after every send, on navigation, on hover) keeps showing the
  // last breakdown.
  const canOpenBreakdown = ringTarget === "context";

  useEffect(() => {
    if (!canOpenBreakdown) {
      setIsBreakdownOpen(false);
    }
  }, [canOpenBreakdown]);

  const weeklyAllModelsPercentage = realUsageSnapshot?.weeklyAllModelsPercentageUsed;
  const weeklyAllModelsResetText = realUsageSnapshot?.weeklyAllModelsResetText;
  // Per-model weekly limits (e.g. Sonnet/Opus on Max plans). Empty on plans that
  // don't expose them, so the rows simply don't render.
  const weeklyScopedLimits = realUsageSnapshot?.weeklyScopedLimits ?? [];
  const sessionPercentage = getRealUsagePercentage(realUsageSnapshot);
  const sessionHasNotStarted =
    sessionPercentage === 0 && typeof realUsageSnapshot?.sessionResetsAt !== "number";
  const sessionResetText = sessionHasNotStarted
    ? t("sessionNotUsedYet", "not used yet")
    : realUsageSnapshot?.resetText ?? t("resetUnknown", "reset unknown");

  // Prefer the model-aware projection (so switching to a cheaper model lengthens
  // the estimate); fall back to the blended drain-rate projection until enough
  // per-message samples exist.
  const sessionProjection =
    typeof sessionPercentage === "number" && typeof realUsageSnapshot?.sessionResetsAt === "number"
      ? computeModelAwareSessionProjection(
          usageHistory ?? [],
          sessionPercentage,
          realUsageSnapshot.sessionResetsAt,
          realUsageSnapshot.modelLabel,
          realUsageSnapshot.thinkingLevel,
        ) ?? computeSessionProjection(usageHistory ?? [], sessionPercentage, realUsageSnapshot.sessionResetsAt)
      : null;

  const sessionMessagesLeft =
    typeof sessionPercentage === "number" && typeof realUsageSnapshot?.sessionResetsAt === "number"
      ? computeSessionMessagesLeft(
          usageHistory ?? [],
          sessionPercentage,
          realUsageSnapshot.sessionResetsAt,
          realUsageSnapshot.modelLabel,
          realUsageSnapshot.thinkingLevel,
        )
      : null;

  const weeklyProjection =
    typeof weeklyAllModelsPercentage === "number" &&
    typeof realUsageSnapshot?.weeklyAllModelsResetsAt === "number"
      ? computeWeeklyProjection(
          usageHistory ?? [],
          weeklyAllModelsPercentage,
          realUsageSnapshot.weeklyAllModelsResetsAt,
          Date.now(),
          {
            mode: settings.weeklyMetricsEnabled === false ? "manual" : "smart",
            display: settings.weeklyEstimateDisplay ?? "active_hours",
            metrics: settings.weeklyMetricsEnabled === false ? undefined : weeklyUsageMetrics,
            manualWorkDays: settings.weeklyManualWorkDays ?? [1, 2, 3, 4, 5],
            manualActiveHoursPerDay: settings.weeklyManualActiveHoursPerDay ?? 10,
            manualStartHour: settings.weeklyManualStartHour ?? 9,
          },
        )
      : null;

  const paceFormat: PaceSurplusFormat = settings.paceSurplusFormat ?? "percent";
  const nowMs = Date.now();
  const sessionPaceSummary =
    paceFormat === "messages"
      ? buildMessagesSummary(sessionMessagesLeft)
      : buildPaceSummary(
          sessionProjection,
          sessionPercentage ?? undefined,
          realUsageSnapshot?.sessionResetsAt,
          paceFormat,
          nowMs,
        );
  // "Messages left" is a 5-hour, single-model concept; the weekly row (all models)
  // keeps showing percentage-at-reset in that mode.
  const weeklyPaceSummary =
    settings.weeklyEstimateDisplay === "percent_at_reset"
      ? buildPercentAtResetSummary(weeklyProjection, weeklyAllModelsPercentage)
      : buildPaceSummary(
          weeklyProjection,
          weeklyAllModelsPercentage,
          realUsageSnapshot?.weeklyAllModelsResetsAt,
          paceFormat === "messages" ? "percent" : paceFormat,
          nowMs,
        );
  const showWeeklyLearningNotice =
    settings.weeklyMetricsEnabled !== false &&
    weeklyUsageMetrics?.confidence !== "ready";

  const ringTooltip = (() => {
    if (ringTarget === "hidden") return null;
    // Context uses the breakdown panel instead of a tooltip.
    if (ringTarget === "context") return null;
    return (
      <>
        <span>{ringMetricLabel(ringTarget)}:</span>
        <span>{ringPercentage}%</span>
      </>
    );
  })();

  return (
    <aside className="cub-root" aria-label={t("ariaClaudeUsage", "Claude usage $1", barDisplay)}>
      {showBar && (
        <div className="cub-bar-cell">
          {showBarLabel && (
            <span className="cub-bar-label" aria-hidden="true">{barDisplay}</span>
          )}
          <div
            className="cub-meter"
            aria-label={`${ringMetricLabel(barMetric) ?? t("usage", "Usage")} ${barDisplay}`}
            role="button"
            tabIndex={0}
            onMouseEnter={onHoverBar}
          >
          <span className="cub-meter-hover" />
          <span className="cub-meter-fill" style={{ width: `${barWidth}%` }} />
          <span className="cub-usage-tooltip" role="tooltip">
            {showReviewBanner && (
              <span className="cub-review-banner">
                <span className="cub-review-banner-text">
                  {t("reviewEnjoying", "Enjoying Claude Usage Bar?")}{" "}
                  <a href={STORE_URL} target="_blank" rel="noopener noreferrer">
                    {t("reviewRate", "Rate on Chrome Store ↗")}
                  </a>
                </span>
                <button type="button" className="cub-review-banner-dismiss" onClick={dismissReviewBanner}>
                  ✕
                </button>
              </span>
            )}
            <span className="cub-usage-title">
              <span>{t("planUsage", "Plan usage")}</span>
              <button
                className="cub-usage-link"
                type="button"
                aria-label={t("openSettings", "Open extension settings")}
                onClick={() => {
                  void openUsageBarSettings();
                }}
              >
                →
              </button>
            </span>
            <span className="cub-usage-row cub-usage-row--stacked">
              <span className="cub-usage-row-label">
                <span className="cub-usage-row-title">{t("fiveHourLimit", "5-hour limit")}</span>
                <span className="cub-usage-row-sub">
                  {sessionResetText}
                </span>
              </span>
              <span className="cub-usage-row-value">
                <span className="cub-usage-row-pct">
                  {typeof sessionPercentage === "number" ? `${sessionPercentage}%` : "—"}
                </span>
                {showPace && sessionPaceSummary && (
                  <span className="cub-usage-row-pace" data-kind={sessionPaceSummary.kind}>
                    {sessionPaceSummary.text}
                  </span>
                )}
              </span>
            </span>
            <span className="cub-usage-track">
              <span style={{ width: `${sessionPercentage ?? 0}%` }} />
            </span>
            <span className="cub-usage-row cub-usage-row--stacked">
              <span className="cub-usage-row-label">
                <span className="cub-usage-row-title">
                  {t("ringWeekly", "Weekly · all models")}
                  {showWeeklyLearningNotice && (
                    <span
                      className="cub-weekly-learning"
                      aria-label={t("weeklyLearningAria", "Weekly usage estimate is still learning")}
                      role="img"
                    >
                      i
                      <span className="cub-weekly-learning-tooltip" role="tooltip">
                        {t(
                          "weeklyLearningTooltip",
                          "Weekly estimates may be inaccurate during the first week while Usage Bar learns your pattern.",
                        )}
                      </span>
                    </span>
                  )}
                </span>
                <span className="cub-usage-row-sub">{weeklyAllModelsResetText ?? "—"}</span>
              </span>
              <span className="cub-usage-row-value">
                <span className="cub-usage-row-pct">
                  {typeof weeklyAllModelsPercentage === "number"
                    ? `${weeklyAllModelsPercentage}%`
                    : "—"}
                </span>
                {showPace && weeklyPaceSummary && (
                  <span className="cub-usage-row-pace" data-kind={weeklyPaceSummary.kind}>
                    {weeklyPaceSummary.text}
                  </span>
                )}
              </span>
            </span>
            <span className="cub-usage-track">
              <span style={{ width: `${weeklyAllModelsPercentage ?? 0}%` }} />
            </span>
            {weeklyScopedLimits.map((scoped) => (
              <Fragment key={scoped.modelLabel}>
                <span className="cub-usage-row cub-usage-row--stacked">
                  <span className="cub-usage-row-label">
                    <span className="cub-usage-row-title">{t("weeklyScoped", "Weekly · $1", scoped.modelLabel)}</span>
                  </span>
                  <span className="cub-usage-row-value">
                    <span className="cub-usage-row-pct">{scoped.percentageUsed}%</span>
                  </span>
                </span>
                <span className="cub-usage-track">
                  <span style={{ width: `${scoped.percentageUsed}%` }} />
                </span>
              </Fragment>
            ))}
          </span>
          </div>
        </div>
      )}
      {showWheel && ringTarget !== "hidden" && (
        <span
          className="cub-wheel-wrap"
          data-breakdown-open={String(isBreakdownOpen)}
          onMouseEnter={() => {
            onHoverWheel?.();
            if (canOpenBreakdown) openBreakdown();
          }}
          onMouseLeave={canOpenBreakdown ? scheduleBreakdownClose : undefined}
        >
          <button
            type="button"
            className="cub-ctx-percent"
            aria-label={
              ringTarget === "context"
                ? isRefreshingContext
                  ? t("ctxCalcLoading", "Context calculation loading")
                  : t("ctxWindowFull", "Context window $1% full", contextFillPercentage)
                : `${ringMetricLabel(ringTarget)} ${ringPercentage}%`
            }
            aria-expanded={canOpenBreakdown ? isBreakdownOpen : undefined}
            aria-haspopup={canOpenBreakdown ? "dialog" : undefined}
            data-clickable={String(canOpenBreakdown)}
            data-loading={String(ringTarget === "context" && isRefreshingContext)}
            data-display={contextDisplay}
            onClick={canOpenBreakdown ? () => setIsBreakdownOpen((open) => !open) : undefined}
          >
            {contextDisplay === "ring" ? (
              <span
                className="cub-token-ring"
                aria-hidden="true"
                style={{ "--cub-token-percentage": `${ringPercentage}%` } as CSSProperties}
              />
            ) : (
              `${ringPercentage}%`
            )}
            {ringTooltip && (
              <span className="cub-token-tooltip" role="tooltip">
                {ringTooltip}
              </span>
            )}
          </button>
          {canOpenBreakdown && isBreakdownOpen && (
            <ContextBreakdownPanel
              breakdown={contextBreakdown}
              totalTokens={contextLengthTokens}
              contextLimit={contextLimit}
              isRefreshing={isRefreshingContext}
              lengthIsEstimate={chatUsage.lengthIsEstimate}
              onClose={() => setIsBreakdownOpen(false)}
            />
          )}
        </span>
      )}
      {showClipboard && <PromptClipboard />}
    </aside>
  );
};
