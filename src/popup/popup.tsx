import { useEffect, useState } from "react";
import { MESSAGE_TYPES } from "../shared/constants";
import { getStorage, resetUsage } from "../shared/storage";
import type { ApiUsageResponse, StorageShape } from "../shared/types";

const formatPercentage = (value?: number): string => (typeof value === "number" ? `${value}%` : "—");

export const Popup = () => {
  const [state, setState] = useState<StorageShape | null>(null);
  const [apiStatus, setApiStatus] = useState<"idle" | "loading" | "error">("idle");
  const [apiError, setApiError] = useState<string | null>(null);

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

  useEffect(() => {
    void getStorage().then((storage) => {
      setState(storage);
      refreshApiUsage();
    });

    const handleStorageChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "local") {
        return;
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
  );
};
