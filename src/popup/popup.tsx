import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MESSAGE_TYPES, STORAGE_KEYS } from "../shared/constants";
import { getStorage, resetUsage } from "../shared/storage";
import type { ApiUsageResponse, StorageShape } from "../shared/types";
import "./popup.css";

const STORE_URL =
  "https://chromewebstore.google.com/detail/claude-usage-bar/eiddfcnlmiebkbnaopcgambdbnlangai";
const REVIEW_PROMPT_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const REVIEW_PROMPT_DISMISS_MS = 30 * 24 * 60 * 60 * 1000;
const REVIEW_PROMPT_MIN_USAGE_SAMPLES = 100;

const formatPercentage = (value?: number): string => (typeof value === "number" ? `${value}%` : "—");

export const Popup = () => {
  const [state, setState] = useState<StorageShape | null>(null);
  const [apiStatus, setApiStatus] = useState<"idle" | "loading" | "error">("idle");
  const [apiError, setApiError] = useState<string | null>(null);
  const [showReviewBanner, setShowReviewBanner] = useState(false);

  const refreshApiUsage = (force = false) => {
    setApiStatus("loading");
    setApiError(null);
    chrome.runtime.sendMessage({ type: MESSAGE_TYPES.fetchApiUsage, force }, async (response?: ApiUsageResponse) => {
      if (chrome.runtime.lastError) {
        setApiStatus("error");
        setApiError(chrome.runtime.lastError.message ?? "Unable to contact extension background worker");
        return;
      }

      if (!response?.ok) {
        setApiStatus("error");
        setApiError(response?.error ?? "Unable to load Claude usage");
        return;
      }

      setApiStatus("idle");
      setState(await getStorage());
    });
  };

  const dismissReviewBanner = () => {
    setShowReviewBanner(false);
    void chrome.storage.local.set({ [STORAGE_KEYS.reviewBannerDismissedAt]: Date.now() });
  };

  useEffect(() => {
    void getStorage().then(async (storage) => {
      setState(storage);
      const reviewData = await chrome.storage.local.get([
        STORAGE_KEYS.reviewBannerDismissedAt,
        STORAGE_KEYS.installedAt,
        STORAGE_KEYS.detectedTheme,
      ]);
      const dismissedAt = reviewData[STORAGE_KEYS.reviewBannerDismissedAt] as number | undefined;
      const installedAt = reviewData[STORAGE_KEYS.installedAt] as number | undefined;
      const detectedTheme = reviewData[STORAGE_KEYS.detectedTheme];
      const firstUseAt = installedAt ?? storage.usageHistory?.[0]?.capturedAt;
      const recentlyDismissed = Boolean(dismissedAt && Date.now() - dismissedAt < REVIEW_PROMPT_DISMISS_MS);
      const hasEnoughUsage = Boolean(storage.usageHistory && storage.usageHistory.length >= REVIEW_PROMPT_MIN_USAGE_SAMPLES);
      const oldEnough = Boolean(firstUseAt && Date.now() - firstUseAt >= REVIEW_PROMPT_MIN_AGE_MS);

      document.body.classList.toggle("cub-popup-light", detectedTheme === "light");
      setShowReviewBanner(!recentlyDismissed && hasEnoughUsage && oldEnough);
      refreshApiUsage();
    });

    const handleStorageChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "local") {
        return;
      }

      if (changes[STORAGE_KEYS.detectedTheme]) {
        document.body.classList.toggle("cub-popup-light", changes[STORAGE_KEYS.detectedTheme].newValue === "light");
      }

      setState((current) =>
        current
          ? {
              ...current,
              realUsageSnapshot: (changes.realUsageSnapshot?.newValue ?? current.realUsageSnapshot) as StorageShape["realUsageSnapshot"],
            }
          : current,
      );
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  const resetLocalUsage = async () => {
    await resetUsage();
    setState(await getStorage());
  };

  return (
    <>
      {showReviewBanner && (
        <div className="review-banner">
          <span className="review-banner-text">
            Enjoying it?{" "}
            <a href={STORE_URL} target="_blank" rel="noopener noreferrer">
              Rate on Chrome Store ↗
            </a>
          </span>
          <button type="button" className="review-banner-dismiss" onClick={dismissReviewBanner}>
            ✕
          </button>
        </div>
      )}
      <main className="popup">
      <header>
        <h1>Claude Usage Bar</h1>
        <p>
          {apiStatus === "loading"
            ? "Refreshing Claude usage"
            : apiError ?? (state?.realUsageSnapshot ? "Claude API usage loaded" : "Usage not loaded yet")}
        </p>
      </header>

      <section className="metric-grid" aria-label="Usage summary">
        <div>
          <span>Today</span>
          <strong>{state?.dailyUsage.messagesUsed ?? 0}</strong>
        </div>
        <div>
          <span>Chat tokens</span>
          <strong>
            {state?.chatUsage.isRefreshingContext ? "Loading..." : (state?.chatUsage.currentContextTokens ?? state?.chatUsage.estimatedTokens ?? 0).toLocaleString()}
          </strong>
        </div>
        <div>
          <span>5-hour</span>
          <strong>{formatPercentage(state?.realUsageSnapshot?.percentageUsed)}</strong>
        </div>
        <div>
          <span>Weekly</span>
          <strong>{formatPercentage(state?.realUsageSnapshot?.weeklyAllModelsPercentageUsed)}</strong>
        </div>
      </section>

      <a
        className="settings-link"
        href="https://claude.ai/settings/usage-bar"
        target="_blank"
        rel="noopener noreferrer"
      >
        Customize overlay →
      </a>

      <button type="button" className="reset" onClick={() => void resetLocalUsage()}>
        Reset local usage
      </button>

      <button type="button" className="reset" onClick={() => refreshApiUsage(true)}>
        Refresh Claude usage
      </button>
    </main>
    </>
  );
};

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(<Popup />);
}
