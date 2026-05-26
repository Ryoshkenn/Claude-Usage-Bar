import { useEffect, useState, type CSSProperties } from "react";
import type {
  ChatUsage,
  MetricTarget,
  PaceSurplusFormat,
  RealUsageSnapshot,
  Settings,
  UsageLogEntry,
  UsageProjection,
} from "../shared/types";
import {
  computeSessionProjection,
  computeWeeklyProjection,
  formatEta,
} from "../shared/usageProjection";

interface ContentAppProps {
  settings: Settings;
  chatUsage: ChatUsage;
  realUsageSnapshot?: RealUsageSnapshot;
  usageHistory?: UsageLogEntry[];
}

const TOKEN_CONTEXT_LIMIT = 200_000;
const USAGE_PAGE_URL = "/settings/usage";

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

const formatCompactNumber = (value: number): string => {
  if (value >= 1_000_000) {
    return `${Math.round(value / 100_000) / 10}M`;
  }

  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}k`;
  }

  return String(value);
};

// The ring fill shows how full the context window is (context length vs 200k limit).
// Total tokens used (compounded across all inferences) can exceed the window size.
const getContextFillPercentage = (chatUsage: ChatUsage): number =>
  clampPercentage(((chatUsage.currentContextTokens ?? chatUsage.estimatedTokens) / TOKEN_CONTEXT_LIMIT) * 100);

const getMetricPercentage = (
  metric: MetricTarget,
  realUsageSnapshot: RealUsageSnapshot | undefined,
  chatUsage: ChatUsage,
): number | null => {
  switch (metric) {
    case "session":
      return getRealUsagePercentage(realUsageSnapshot);
    case "weekly":
      return typeof realUsageSnapshot?.weeklyAllModelsPercentageUsed === "number"
        ? clampPercentage(realUsageSnapshot.weeklyAllModelsPercentageUsed)
        : null;
    case "context":
      return getContextFillPercentage(chatUsage);
    case "design":
      return typeof realUsageSnapshot?.claudeDesignPercentageUsed === "number"
        ? clampPercentage(realUsageSnapshot.claudeDesignPercentageUsed)
        : null;
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
      <span className="cub-cache-timer" data-unknown="true" role="status" aria-label="Prompt cache timing unavailable">
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
          <span className="cub-cache-timer-text">cache unknown</span>
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
      aria-label={expired ? "Prompt cache expired" : `Prompt cache expires in ${display}`}
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
        <span className="cub-cache-timer-text">{expired ? "expired" : display}</span>
      </span>
      <span
        className={`cub-cache-timer-tooltip${hovered ? " cub-cache-timer-tooltip--visible" : ""}`}
        role="tooltip"
      >
        {expired ? "Prompt cache has expired" : `Prompt cache expires in ${display}`}
        <br />
        Cached tokens save ~90% input cost
      </span>
    </span>
  );
};

interface PaceSummary {
  text: string;
  kind: "good" | "bad";
}

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
      const hoursUntilReset = Math.max(0, (resetsAt - now) / 3_600_000);
      const projectedPercent = Math.min(
        100,
        Math.max(0, Math.round(usedPercent + projection.drainRatePerHour * hoursUntilReset)),
      );
      return { text: `${projectedPercent}% at reset`, kind: "good" };
    }

    if (format === "time" && typeof projection.etaMs === "number" && typeof resetsAt === "number") {
      const surplusMs = projection.etaMs - resetsAt;
      if (surplusMs > 60_000) {
        return { text: `+${formatEta(surplusMs, 0)} past reset`, kind: "good" };
      }
    }

    return { text: "lasts to reset", kind: "good" };
  }

  if (projection.status === "projected_empty" && typeof projection.etaMs === "number") {
    return { text: `empty in ${formatEta(projection.etaMs, now)}`, kind: "bad" };
  }

  return null;
};

const RING_METRIC_LABEL: Record<string, string> = {
  session: "5-hour session",
  weekly: "Weekly · all models",
  context: "Context window",
  design: "Claude Design",
};

export const ContentApp = ({ settings, chatUsage, realUsageSnapshot, usageHistory }: ContentAppProps) => {
  if (!settings.showOverlay) {
    return null;
  }

  const barMetric = settings.barMetric ?? "session";
  const ringTarget = settings.ringTarget ?? "context";
  const showBar = settings.showBar !== false;
  const showBarLabel = settings.showBarLabel === true;
  const showWheel = settings.showWheel !== false;
  const showWheelLabel = settings.showWheelLabel === true;
  const showPace = settings.showPace !== false;

  const barPercentage = getMetricPercentage(barMetric, realUsageSnapshot, chatUsage);
  const barWidth = typeof barPercentage === "number" ? barPercentage : 0;
  const barDisplay = typeof barPercentage === "number" ? `${barPercentage}%` : "—";

  const ringPercentage =
    ringTarget === "hidden" ? 0 : (getMetricPercentage(ringTarget, realUsageSnapshot, chatUsage) ?? 0);

  const isRefreshingContext = Boolean(chatUsage.isRefreshingContext);
  const totalTokensUsed = chatUsage.estimatedTokens;
  const contextLengthTokens = chatUsage.currentContextTokens ?? chatUsage.estimatedTokens;
  const contextFillPercentage = getContextFillPercentage(chatUsage);

  const weeklyAllModelsPercentage = realUsageSnapshot?.weeklyAllModelsPercentageUsed;
  const claudeDesignPercentage = realUsageSnapshot?.claudeDesignPercentageUsed;
  const weeklyAllModelsResetText = realUsageSnapshot?.weeklyAllModelsResetText;
  const claudeDesignResetText = realUsageSnapshot?.claudeDesignResetText;
  const routinesText = realUsageSnapshot?.routinesText;
  const sessionPercentage = getRealUsagePercentage(realUsageSnapshot);

  const sessionProjection =
    typeof sessionPercentage === "number" && typeof realUsageSnapshot?.sessionResetsAt === "number"
      ? computeSessionProjection(usageHistory ?? [], sessionPercentage, realUsageSnapshot.sessionResetsAt)
      : null;

  const weeklyProjection =
    typeof weeklyAllModelsPercentage === "number" &&
    typeof realUsageSnapshot?.weeklyAllModelsResetsAt === "number"
      ? computeWeeklyProjection(
          usageHistory ?? [],
          weeklyAllModelsPercentage,
          realUsageSnapshot.weeklyAllModelsResetsAt,
        )
      : null;

  const paceFormat: PaceSurplusFormat = settings.paceSurplusFormat ?? "percent";
  const nowMs = Date.now();
  const sessionPaceSummary = buildPaceSummary(
    sessionProjection,
    sessionPercentage ?? undefined,
    realUsageSnapshot?.sessionResetsAt,
    paceFormat,
    nowMs,
  );
  const weeklyPaceSummary = buildPaceSummary(
    weeklyProjection,
    weeklyAllModelsPercentage,
    realUsageSnapshot?.weeklyAllModelsResetsAt,
    paceFormat,
    nowMs,
  );

  const ringTooltip = (() => {
    if (ringTarget === "hidden") return null;
    if (ringTarget === "context") {
      return isRefreshingContext ? (
        <>
          <span>Calculating context usage...</span>
          <span>Loading exact token count</span>
          <span>Spinner means the worker is recounting this chat.</span>
        </>
      ) : (
        <>
          <span>Context &amp; token usage:</span>
          <span>{contextFillPercentage}% of context window used</span>
          <span>
            {formatCompactNumber(contextLengthTokens)} / {formatCompactNumber(TOKEN_CONTEXT_LIMIT)} context length
          </span>
          <span>{formatCompactNumber(totalTokensUsed)} current context</span>
        </>
      );
    }
    return (
      <>
        <span>{RING_METRIC_LABEL[ringTarget]}:</span>
        <span>{ringPercentage}%</span>
      </>
    );
  })();

  return (
    <aside className="cub-root" aria-label={`Claude usage ${barDisplay}`}>
      {showBar && (
        <div className="cub-bar-cell">
          {showBarLabel && (
            <span className="cub-bar-label" aria-hidden="true">{barDisplay}</span>
          )}
          <div className="cub-meter" aria-label={`${RING_METRIC_LABEL[barMetric] ?? "Usage"} ${barDisplay}`} role="button" tabIndex={0}>
          <span className="cub-meter-fill" style={{ width: `${barWidth}%` }} />
          <span className="cub-usage-tooltip" role="tooltip">
            <span className="cub-usage-title">
              <span>Plan usage</span>
              <a className="cub-usage-link" href={USAGE_PAGE_URL} aria-label="Open Claude usage page">
                →
              </a>
            </span>
            <span className="cub-usage-row cub-usage-row--stacked">
              <span className="cub-usage-row-label">
                <span className="cub-usage-row-title">5-hour limit</span>
                <span className="cub-usage-row-sub">
                  {realUsageSnapshot?.resetText ?? "reset unknown"}
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
                <span className="cub-usage-row-title">Weekly · all models</span>
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
            <span className="cub-usage-row">
              <span>Weekly · Claude Design</span>
              <span>
                {typeof claudeDesignPercentage === "number"
                  ? `${claudeDesignPercentage}%${claudeDesignResetText ? ` · ${claudeDesignResetText}` : ""}`
                  : "—"}
              </span>
            </span>
            <span className="cub-usage-track">
              <span style={{ width: `${claudeDesignPercentage ?? 0}%` }} />
            </span>
            <span className="cub-usage-row">
              <span>Routines</span>
              <span>{routinesText ?? "—"}</span>
            </span>
            <span className="cub-usage-track">
              <span style={{ width: "0%" }} />
            </span>
          </span>
          </div>
        </div>
      )}
      {showWheel && ringTarget !== "hidden" && (
        <span className="cub-wheel-wrap">
          {showWheelLabel && (
            <span className="cub-wheel-label" aria-hidden="true">{ringPercentage}%</span>
          )}
          <span
            className="cub-token-ring"
            aria-label={
              ringTarget === "context"
                ? isRefreshingContext
                  ? "Context calculation loading"
                  : `Context window ${contextFillPercentage}% full`
                : `${RING_METRIC_LABEL[ringTarget]} ${ringPercentage}%`
            }
            data-loading={String(ringTarget === "context" && isRefreshingContext)}
            style={{ "--cub-token-percentage": `${ringPercentage}%` } as CSSProperties}
          >
            <span className="cub-token-tooltip" role="tooltip">
              {ringTooltip}
            </span>
          </span>
        </span>
      )}
    </aside>
  );
};
