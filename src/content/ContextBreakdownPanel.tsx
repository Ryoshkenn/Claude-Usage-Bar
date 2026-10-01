import { useEffect, useRef, type CSSProperties } from "react";
import type { ContextBreakdown, ContextCategory } from "../shared/types";
import { formatCompactNumber } from "../shared/formatNumber";
import { t } from "../shared/i18n";

interface ContextBreakdownPanelProps {
  breakdown: ContextBreakdown;
  contextLimit: number;
  lengthIsEstimate?: boolean;
  onClose: () => void;
}

// Row order is "biggest conceptual chunks first" rather than by size, so the
// panel doesn't reshuffle every time the conversation grows.
const ROW_ORDER: ContextCategory[] = [
  "userMessages",
  "assistantMessages",
  "thinking",
  "toolCalls",
  "toolResults",
  "attachments",
  "projectKnowledge",
  "overhead",
];

const CATEGORY_COLORS: Record<ContextCategory, string> = {
  userMessages: "rgb(204 124 94)",
  assistantMessages: "rgb(122 145 176)",
  thinking: "rgb(150 128 186)",
  toolCalls: "rgb(126 166 130)",
  toolResults: "rgb(196 168 106)",
  attachments: "rgb(178 122 148)",
  projectKnowledge: "rgb(110 158 162)",
  overhead: "rgb(128 126 118)",
};

const categoryLabel = (category: ContextCategory): string => {
  switch (category) {
    case "userMessages":
      return t("ctxBreakdownUser", "Your messages");
    case "assistantMessages":
      return t("ctxBreakdownAssistant", "Claude's replies");
    case "thinking":
      return t("ctxBreakdownThinking", "Extended thinking");
    case "toolCalls":
      return t("ctxBreakdownToolCalls", "Tool calls");
    case "toolResults":
      return t("ctxBreakdownToolResults", "Tool results");
    case "attachments":
      return t("ctxBreakdownAttachments", "Files & attachments");
    case "projectKnowledge":
      return t("ctxBreakdownProject", "Project knowledge");
    case "overhead":
      return t("ctxBreakdownOverhead", "System overhead");
    default:
      return category;
  }
};

const categoryCountLabel = (category: ContextCategory, count: number): string | null => {
  if (count <= 0) {
    return null;
  }

  switch (category) {
    case "userMessages":
    case "assistantMessages":
    case "overhead":
      return t("ctxBreakdownCountMessages", "$1 messages", String(count));
    case "thinking":
      return t("ctxBreakdownCountBlocks", "$1 blocks", String(count));
    case "toolCalls":
      return t("ctxBreakdownCountCalls", "$1 calls", String(count));
    case "toolResults":
      return t("ctxBreakdownCountResults", "$1 results", String(count));
    case "attachments":
      return t("ctxBreakdownCountFiles", "$1 files", String(count));
    default:
      return null;
  }
};

export const ContextBreakdownPanel = ({
  breakdown,
  contextLimit,
  lengthIsEstimate,
  onClose,
}: ContextBreakdownPanelProps) => {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      // The percent label itself toggles the panel, so ignore clicks that land on it.
      if (target && panelRef.current?.parentElement?.contains(target)) {
        return;
      }
      onClose();
    };

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("pointerdown", handlePointerDown, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [onClose]);

  const total = breakdown.totalTokens;
  const rows = ROW_ORDER.map((category) => ({
    category,
    ...breakdown.entries[category],
  })).filter((row) => row.tokens > 0);

  // Row % labels stay as shares of tokens USED; the STACK widths below are
  // shares of the full window so a small usage shows a mostly-empty bar.
  const shareOf = (tokens: number): number => (total > 0 ? (tokens / total) * 100 : 0);
  const windowShareOf = (tokens: number): number =>
    contextLimit > 0 ? (tokens / contextLimit) * 100 : 0;
  const remainderShare = contextLimit > 0 ? Math.max(0, 100 - (total / contextLimit) * 100) : 0;
  const windowPercentage = contextLimit > 0 ? Math.round((total / contextLimit) * 100) : 0;

  return (
    <div className="cub-ctx-panel" role="dialog" aria-label={t("ctxBreakdownTitle", "What's using the context window")} ref={panelRef}>
      <div className="cub-ctx-panel-head">
        <span className="cub-ctx-panel-title">{t("ctxBreakdownTitle", "What's using the context window")}</span>
        <span className="cub-ctx-panel-total">
          {t(
            "ctxBreakdownTotal",
            "$1 of $2 · $3%",
            [formatCompactNumber(total), formatCompactNumber(contextLimit), String(windowPercentage)],
          )}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="cub-ctx-panel-empty">{t("ctxBreakdownEmpty", "Nothing in the context window yet.")}</p>
      ) : (
        <>
          <div className="cub-ctx-stack" aria-hidden="true">
            {rows.map((row) => (
              <span
                key={row.category}
                className="cub-ctx-stack-seg"
                style={
                  {
                    "--cub-ctx-share": `${windowShareOf(row.tokens)}%`,
                    "--cub-ctx-color": CATEGORY_COLORS[row.category],
                  } as CSSProperties
                }
              />
            ))}
            {remainderShare > 0 && (
              <span
                className="cub-ctx-stack-seg"
                title={t("ctxBreakdownRemaining", "Remaining")}
                style={
                  {
                    "--cub-ctx-share": `${remainderShare}%`,
                    "--cub-ctx-color": "rgb(58 58 56)",
                  } as CSSProperties
                }
              />
            )}
          </div>

          <ul className="cub-ctx-rows">
            {rows.map((row) => {
              const countLabel = categoryCountLabel(row.category, row.count);
              return (
                <li className="cub-ctx-row" key={row.category}>
                  <span
                    className="cub-ctx-swatch"
                    style={{ "--cub-ctx-color": CATEGORY_COLORS[row.category] } as CSSProperties}
                    aria-hidden="true"
                  />
                  <span className="cub-ctx-row-label">
                    {categoryLabel(row.category)}
                    {countLabel && <span className="cub-ctx-row-count">{countLabel}</span>}
                  </span>
                  <span className="cub-ctx-row-tokens">{formatCompactNumber(row.tokens)}</span>
                  <span className="cub-ctx-row-share">{Math.round(shareOf(row.tokens))}%</span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <p className="cub-ctx-panel-note">
        {lengthIsEstimate
          ? t("ctxBreakdownNoteEstimate", "Estimated locally. Tool and search results make this approximate.")
          : t("ctxBreakdownNote", "Estimated locally from this conversation.")}
      </p>
    </div>
  );
};
