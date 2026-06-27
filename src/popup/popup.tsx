import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { MESSAGE_TYPES, STORAGE_KEYS } from "../shared/constants";
import { getStorage, resetUsage } from "../shared/storage";
import {
  activeDayStreak,
  allTimeTotal,
  buildDailySeries,
  buildMonthlySeries,
  modelSplit,
  splitPercent,
  summarizeSeries,
  type ChartBar,
} from "../shared/usageChart";
import type { ApiUsageResponse, StorageShape } from "../shared/types";
import { setLanguage, t } from "../shared/i18n";
import "./popup.css";

const STORE_URL =
  "https://chromewebstore.google.com/detail/claude-usage-bar/eiddfcnlmiebkbnaopcgambdbnlangai";
const CLAUDE_TAB_URL = "https://claude.ai/new";
const REVIEW_PROMPT_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const REVIEW_PROMPT_DISMISS_MS = 30 * 24 * 60 * 60 * 1000;
const REVIEW_PROMPT_MIN_USAGE_SAMPLES = 100;

const formatPercentage = (value?: number): string =>
  typeof value === "number" ? `${value}%` : "—";

type ChartView = "daily" | "monthly";

const LIGHT_THEME_QUERY = "(prefers-color-scheme: light)";

const applyBrowserTheme = (query: MediaQueryList) => {
  document.body.classList.toggle("cub-popup-light", query.matches);
};

// Single upward flame (Lucide "flame"), tinted with the three model colors so
// the streak reads as "Opus-hot". Gradient runs haiku (tip) → sonnet → opus (base).
const FireIcon = () => (
  <svg className="cub-fire" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
    <defs>
      <linearGradient id="cubFireGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="var(--cub-haiku)" />
        <stop offset="0.55" stopColor="var(--cub-sonnet)" />
        <stop offset="1" stopColor="var(--cub-opus)" />
      </linearGradient>
    </defs>
    <path
      fill="url(#cubFireGrad)"
      d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"
    />
  </svg>
);

type SegmentKey = "opus" | "sonnet" | "haiku" | "unknown";

// Opus/Sonnet/Haiku are brand names (left untranslated). "Other" and its hint are
// localized at render time via segmentName()/segmentHint() so chrome.i18n is ready.
const SEGMENTS: Array<{ key: SegmentKey; cls: string; name: string }> = [
  { key: "opus", cls: "cub-opus", name: "Opus" },
  { key: "sonnet", cls: "cub-sonnet", name: "Sonnet" },
  { key: "haiku", cls: "cub-haiku", name: "Haiku" },
  { key: "unknown", cls: "cub-unknown", name: "Other" },
];

const segmentName = (s: { key: SegmentKey; name: string }): string =>
  s.key === "unknown" ? t("segOther", "Other") : s.name;

const segmentHint = (key: SegmentKey): string | undefined =>
  key === "unknown"
    ? t(
        "otherHint",
        "The model couldn't be determined for these messages. This can come from Claude Code and cowork.",
      )
    : undefined;

// Opus/Sonnet/Haiku always appear in the legend; Other only when present.
const ALWAYS_SHOWN: SegmentKey[] = ["opus", "sonnet", "haiku"];

const barTitle = (bar: ChartBar): string => {
  const parts = SEGMENTS.filter((s) => bar[s.key] > 0).map((s) => `${segmentName(s)} ${bar[s.key]}`);
  return `${bar.label}\n${parts.join(" · ") || t("noMessages", "No messages")} — ${t("total", "Total")} ${bar.total}`;
};

const UsageChart = ({ bars, view }: { bars: ChartBar[]; view: ChartView }) => {
  const max = Math.max(...bars.map((b) => b.total), 1);
  const xLabels =
    view === "monthly"
      ? bars.map((b, i) => ({ i, label: b.label }))
      : [0, Math.floor((bars.length - 1) / 2), bars.length - 1].map((i) => ({ i, label: bars[i].label }));

  return (
    <div className="cub-chart">
      <div className="cub-cols">
        {bars.map((bar, i) => (
          <div
            key={bar.key}
            className="cub-col"
            style={{ height: `${(bar.total / max) * 100}%`, "--i": i } as CSSProperties}
            title={barTitle(bar)}
          >
            {SEGMENTS.map((s) =>
              bar[s.key] > 0 ? (
                <span key={s.key} className={`cub-seg ${s.cls}`} style={{ flexGrow: bar[s.key] }} />
              ) : null,
            )}
          </div>
        ))}
      </div>
      <div className={`cub-xaxis ${view === "monthly" ? "cub-xaxis-spread" : ""}`}>
        {view === "monthly"
          ? xLabels.map((x) => <span key={x.i}>{x.label}</span>)
          : xLabels.map((x) => <span key={x.i}>{x.label}</span>)}
      </div>
    </div>
  );
};

export const Popup = () => {
  const [state, setState] = useState<StorageShape | null>(null);
  const [apiStatus, setApiStatus] = useState<"idle" | "loading" | "error">("idle");
  const [apiError, setApiError] = useState<string | null>(null);
  const [showReviewBanner, setShowReviewBanner] = useState(false);
  const [view, setView] = useState<ChartView>("daily");

  const refreshApiUsage = (force = false) => {
    setApiStatus("loading");
    setApiError(null);
    chrome.runtime.sendMessage({ type: MESSAGE_TYPES.fetchApiUsage, force }, async (response?: ApiUsageResponse) => {
      if (chrome.runtime.lastError) {
        setApiStatus("error");
        setApiError(
          chrome.runtime.lastError.message ?? t("errNoWorker", "Unable to contact extension background worker"),
        );
        return;
      }

      if (!response?.ok) {
        setApiStatus("error");
        setApiError(response?.error ?? t("errLoadUsage", "Unable to load Claude usage"));
        return;
      }

      setApiStatus("idle");
      setState(await getStorage());
    });
  };

  // Open our settings panel the same way the in-bar "→" shortcut does: have the
  // content script run openUsageBarSettings(). Prefer the current claude.ai tab
  // (no new tab); otherwise open one and let it surface settings on load.
  const openSettings = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const onClaude = typeof tab?.url === "string" && tab.url.startsWith("https://claude.ai");
      if (tab?.id != null && onClaude) {
        try {
          await chrome.tabs.sendMessage(tab.id, { type: MESSAGE_TYPES.openSettings });
          window.close();
          return;
        } catch {
          // Content script not ready yet — reload and open settings once it is.
          await chrome.storage.local.set({ [STORAGE_KEYS.openSettingsOnLoad]: Date.now() });
          await chrome.tabs.reload(tab.id);
          window.close();
          return;
        }
      }
      await chrome.storage.local.set({ [STORAGE_KEYS.openSettingsOnLoad]: Date.now() });
      await chrome.tabs.create({ url: CLAUDE_TAB_URL });
      window.close();
    } catch {
      await chrome.tabs.create({ url: CLAUDE_TAB_URL });
    }
  };

  const dismissReviewBanner = () => {
    setShowReviewBanner(false);
    void chrome.storage.local.set({ [STORAGE_KEYS.reviewBannerDismissedAt]: Date.now() });
  };

  useEffect(() => {
    void getStorage().then(async (storage) => {
      setLanguage(storage.settings.language);
      setState(storage);
      const reviewData = await chrome.storage.local.get([
        STORAGE_KEYS.reviewBannerDismissedAt,
        STORAGE_KEYS.installedAt,
      ]);
      const dismissedAt = reviewData[STORAGE_KEYS.reviewBannerDismissedAt] as number | undefined;
      const installedAt = reviewData[STORAGE_KEYS.installedAt] as number | undefined;
      const firstUseAt = installedAt ?? storage.usageHistory?.[0]?.capturedAt;
      const recentlyDismissed = Boolean(dismissedAt && Date.now() - dismissedAt < REVIEW_PROMPT_DISMISS_MS);
      const hasEnoughUsage = Boolean(storage.usageHistory && storage.usageHistory.length >= REVIEW_PROMPT_MIN_USAGE_SAMPLES);
      const oldEnough = Boolean(firstUseAt && Date.now() - firstUseAt >= REVIEW_PROMPT_MIN_AGE_MS);

      setShowReviewBanner(!recentlyDismissed && hasEnoughUsage && oldEnough);
      refreshApiUsage();
    });

    const themeQuery = window.matchMedia(LIGHT_THEME_QUERY);
    const handleBrowserThemeChange = () => applyBrowserTheme(themeQuery);
    applyBrowserTheme(themeQuery);
    themeQuery.addEventListener("change", handleBrowserThemeChange);

    const handleStorageChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "local") {
        return;
      }

      setState((current) =>
        current
          ? {
              ...current,
              realUsageSnapshot: (changes.realUsageSnapshot?.newValue ?? current.realUsageSnapshot) as StorageShape["realUsageSnapshot"],
              dailyMessageHistory: (changes.dailyMessageHistory?.newValue ?? current.dailyMessageHistory) as StorageShape["dailyMessageHistory"],
            }
          : current,
      );
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => {
      themeQuery.removeEventListener("change", handleBrowserThemeChange);
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  const resetLocalUsage = async () => {
    await resetUsage();
    setState(await getStorage());
  };

  const history = useMemo(() => state?.dailyMessageHistory ?? [], [state?.dailyMessageHistory]);
  const bars = useMemo(
    () => (view === "daily" ? buildDailySeries(history, 14) : buildMonthlySeries(history, 6)),
    [history, view],
  );
  const summary = useMemo(() => summarizeSeries(bars), [bars]);
  const split = useMemo(() => modelSplit(bars), [bars]);
  const lifetime = useMemo(() => allTimeTotal(history), [history]);
  const streak = useMemo(() => activeDayStreak(history), [history]);

  const snapshot = state?.realUsageSnapshot;
  const hasData = lifetime > 0;

  return (
    <>
      {showReviewBanner && (
        <div className="cub-review">
          <span className="cub-review-text">
            {t("reviewEnjoyingShort", "Enjoying it?")}{" "}
            <a href={STORE_URL} target="_blank" rel="noopener noreferrer">
              {t("reviewRate", "Rate on Chrome Store ↗")}
            </a>
          </span>
          <button type="button" className="cub-review-dismiss" onClick={dismissReviewBanner}>
            ✕
          </button>
        </div>
      )}
      <main className="cub-popup">
        <h1 className="cub-sronly">Claude Usage Bar</h1>

        <header className="cub-hdr">
          <div className="cub-limits">
            <div className="cub-lim">
              <span className="cub-k">{t("fiveHour", "5-hour")}</span>
              <span className="cub-v">{formatPercentage(snapshot?.percentageUsed)}</span>
              <span className="cub-r">{snapshot?.resetText ?? "—"}</span>
            </div>
            <div className="cub-lim">
              <span className="cub-k">{t("weekly", "Weekly")}</span>
              <span className="cub-v">{formatPercentage(snapshot?.weeklyAllModelsPercentageUsed)}</span>
              <span className="cub-r">{snapshot?.weeklyAllModelsResetText ?? "—"}</span>
            </div>
          </div>
          <div className="cub-icons">
            <button
              type="button"
              className={`cub-iconbtn ${apiStatus === "loading" ? "cub-spinning" : ""}`}
              title={t("refreshAll", "Refresh all stats")}
              aria-label={t("refreshAll", "Refresh all stats")}
              onClick={() => refreshApiUsage(true)}
            >
              ⟳
            </button>
            <button
              type="button"
              className="cub-iconbtn"
              title={t("customizeOverlay", "Customize overlay")}
              aria-label={t("customizeOverlay", "Customize overlay")}
              onClick={() => void openSettings()}
            >
              ⚙
            </button>
          </div>
        </header>

        {apiError && <p className="cub-err">{apiError}</p>}

        <section className="cub-summary" aria-label={t("usageSummary", "Usage summary")}>
          <div className="cub-cell">
            <span className="cub-k">{t("total", "Total")}</span>
            <strong className="cub-num">{summary.total.toLocaleString()}</strong>
          </div>
          <div className="cub-cell">
            <span className="cub-k">{view === "monthly" ? t("avgPerMo", "Avg / mo") : t("avgPerDay", "Avg / day")}</span>
            <strong className="cub-num">{summary.perDayAverage.toLocaleString()}</strong>
          </div>
          <div className="cub-cell">
            <span className="cub-k">{t("busiest", "Busiest")}</span>
            <strong className="cub-num">
              {summary.busiest ? summary.busiest.total : 0}
              {summary.busiest ? <small> {summary.busiest.label}</small> : null}
            </strong>
          </div>
        </section>

        <div className="cub-row">
          <span className="cub-lbl">{t("messagesSent", "Messages sent")}</span>
          <div className="cub-seg-toggle" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={view === "daily"}
              className={view === "daily" ? "cub-active" : ""}
              onClick={() => setView("daily")}
            >
              {t("fourteenDays", "14 Days")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "monthly"}
              className={view === "monthly" ? "cub-active" : ""}
              onClick={() => setView("monthly")}
            >
              {t("monthly", "Monthly")}
            </button>
          </div>
        </div>

        {hasData ? (
          <>
            <UsageChart bars={bars} view={view} />
            <div className="cub-legend">
              {SEGMENTS.filter((s) => ALWAYS_SHOWN.includes(s.key) || split[s.key] > 0).map((s) => (
                <div
                  key={s.key}
                  className={`cub-legend-item ${segmentHint(s.key) ? "cub-has-hint" : ""}`}
                  title={segmentHint(s.key)}
                >
                  <span className={`cub-dot ${s.cls}`} />
                  {segmentName(s)} <span className="cub-pct">{splitPercent(split, s.key)}%</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="cub-empty">
            {t("collecting", "Collecting usage — your daily chart fills in as you chat on claude.ai.")}
          </div>
        )}

        <footer className="cub-foot">
          <span className="cub-streak">
            {t("allTime", "All-time")} <strong>{lifetime.toLocaleString()}</strong>
            <span className="cub-sep">|</span>
            <FireIcon /> {t("dayStreak", "$1-day streak", streak)}
          </span>
          <button type="button" className="cub-reset" onClick={() => void resetLocalUsage()}>
            {t("reset", "Reset")}
          </button>
        </footer>
      </main>
    </>
  );
};

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(<Popup />);
}
