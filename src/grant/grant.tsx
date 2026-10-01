// One-purpose extension page: obtain the optional all-sites host permission.
//
// It exists only because chrome.permissions.request() cannot be called from a
// content script and requires a user gesture on an extension page. The settings
// panel in claude.ai asks the background worker to open this window; the user
// clicks once, Chrome shows its own prompt, and the window closes itself.

import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MESSAGE_TYPES } from "../shared/constants";
import { getStorage, updateSettings } from "../shared/storage";
import { setLanguage, t } from "../shared/i18n";
import "./grant.css";

const ALL_SITES = { origins: ["*://*/*"] };

const Grant = () => {
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getStorage().then(({ settings }) => setLanguage(settings.language));
  }, []);

  const allow = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const granted = await chrome.permissions.request(ALL_SITES);
      if (!granted) {
        setDenied(true);
        return;
      }
      await updateSettings({ resetBannerScope: "everywhere" });
      chrome.runtime.sendMessage({ type: MESSAGE_TYPES.syncResetBanner }, () => {
        void chrome.runtime.lastError;
      });
      window.close();
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="cub-grant">
      <h1>{t("grantTitle", "Show reset alerts on any site")}</h1>
      <p>
        {t(
          "grantBody",
          "Chrome needs your permission before the extension can draw a banner outside claude.ai. It is only used to show the banner — no page content is ever read or sent anywhere.",
        )}
      </p>
      {denied && <p className="cub-grant-denied">{t("grantDenied", "Permission was not granted. Reset alerts stay on claude.ai only.")}</p>}
      <div className="cub-grant-actions">
        <button type="button" className="cub-grant-cancel" onClick={() => window.close()}>
          {t("grantCancel", "Cancel")}
        </button>
        <button type="button" className="cub-grant-allow" disabled={busy} onClick={() => void allow()}>
          {t("grantAllow", "Continue")}
        </button>
      </div>
    </main>
  );
};

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(<Grant />);
}
