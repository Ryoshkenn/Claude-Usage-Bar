import type { CSSProperties } from "react";
import type { ChatUsage, RealUsageSnapshot, Settings } from "../shared/types";

interface ContentAppProps {
  settings: Settings;
  chatUsage: ChatUsage;
  realUsageSnapshot?: RealUsageSnapshot;
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

export const ContentApp = ({ settings, chatUsage, realUsageSnapshot }: ContentAppProps) => {
  if (!settings.showOverlay) {
    return null;
  }

  const percentage = getRealUsagePercentage(realUsageSnapshot);
  const percentageDisplay = typeof percentage === "number" ? `${percentage}%` : "—";
  const meterWidth = typeof percentage === "number" ? percentage : 0;
  const contextFillPercentage = getContextFillPercentage(chatUsage);
  const totalTokensUsed = chatUsage.estimatedTokens;
  const contextLengthTokens = chatUsage.currentContextTokens;
  const weeklyAllModelsPercentage = realUsageSnapshot?.weeklyAllModelsPercentageUsed;
  const claudeDesignPercentage = realUsageSnapshot?.claudeDesignPercentageUsed;
  const weeklyAllModelsResetText = realUsageSnapshot?.weeklyAllModelsResetText;
  const claudeDesignResetText = realUsageSnapshot?.claudeDesignResetText;
  const routinesText = realUsageSnapshot?.routinesText;

  return (
    <aside className="cub-root" aria-label={`Claude usage ${percentageDisplay}`}>
      <div className="cub-meter" aria-label={`5-hour usage ${percentageDisplay}`} role="button" tabIndex={0}>
        <span
          className="cub-meter-fill"
          style={{
            width: `${meterWidth}%`,
          }}
        />
        <span className="cub-usage-tooltip" role="tooltip">
          <span className="cub-usage-title">
            <span>Plan usage</span>
            <a className="cub-usage-link" href={USAGE_PAGE_URL} aria-label="Open Claude usage page">
              →
            </a>
          </span>
          <span className="cub-usage-row">
            <span>5-hour limit</span>
            <span>
              {typeof percentage === "number" ? `${percentage}%` : "Usage unavailable"}
              {realUsageSnapshot?.resetText ? ` · ${realUsageSnapshot.resetText}` : " · reset unknown"}
            </span>
          </span>
          <span className="cub-usage-track">
            <span style={{ width: `${meterWidth}%` }} />
          </span>
          <span className="cub-usage-row">
            <span>Weekly · all models</span>
            <span>
              {typeof weeklyAllModelsPercentage === "number"
                ? `${weeklyAllModelsPercentage}%${weeklyAllModelsResetText ? ` · ${weeklyAllModelsResetText}` : ""}`
                : "—"}
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
      <span
        className="cub-token-ring"
        aria-label={`Context window ${contextFillPercentage}% full`}
        style={{
          "--cub-token-percentage": `${contextFillPercentage}%`,
        } as CSSProperties}
      >
        <span className="cub-token-tooltip" role="tooltip">
          <span>Context &amp; token usage:</span>
          <span>{contextFillPercentage}% of context window used</span>
          <span>
            {formatCompactNumber(contextLengthTokens ?? totalTokensUsed)} / {formatCompactNumber(TOKEN_CONTEXT_LIMIT)} context length
          </span>
          <span>
            {formatCompactNumber(totalTokensUsed)} total tokens used
          </span>
        </span>
      </span>
    </aside>
  );
};
