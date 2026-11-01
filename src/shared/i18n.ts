// Localization helper. Catalogs live in src/locales/<lang>.json (Chrome message
// format: { key: { message } }) and are bundled at build time, so lookups are
// synchronous and work in every context.
//
// The active language follows Claude's own UI language — there is no picker. The
// content script reads it from <html lang> on claude.ai (and watches it, since
// Claude can switch without a reload), then mirrors the tag to
// STORAGE_KEYS.claudeLanguage for the popup, grant page and worker, which can't
// see the page. We deliberately do not use chrome.i18n, which is locked to the
// browser UI language. Call setLanguage() with the tag once it's known; until then
// everything renders in English.
//
// Resolution order per key: active catalog -> English catalog -> inline fallback.
// So a key missing from a translation degrades to English, and the inline fallback
// at the call site keeps source readable and covers keys absent from every catalog.
import en from "../locales/en.json";
import es from "../locales/es.json";
import fr from "../locales/fr.json";
import de from "../locales/de.json";
import it from "../locales/it.json";
import pt_BR from "../locales/pt_BR.json";
import ja from "../locales/ja.json";
import ko from "../locales/ko.json";
import zh_CN from "../locales/zh_CN.json";
import zh_TW from "../locales/zh_TW.json";
import hi from "../locales/hi.json";
import am from "../locales/am.json";
import bn from "../locales/bn.json";
import bho from "../locales/bho.json";
import da from "../locales/da.json";
import nl from "../locales/nl.json";
import fil from "../locales/fil.json";
import fi from "../locales/fi.json";
import gu from "../locales/gu.json";
import ha from "../locales/ha.json";
import id from "../locales/id.json";
import kn from "../locales/kn.json";
import ml from "../locales/ml.json";
import mr from "../locales/mr.json";
import nb from "../locales/nb.json";
import ru from "../locales/ru.json";
import sw from "../locales/sw.json";
import sv from "../locales/sv.json";
import ta from "../locales/ta.json";
import te from "../locales/te.json";
import th from "../locales/th.json";
import tr from "../locales/tr.json";
import uk from "../locales/uk.json";
import vi from "../locales/vi.json";

type Catalog = Record<string, { message: string }>;

const CATALOGS: Record<string, Catalog> = {
  en, es, fr, de, it, pt_BR, ja, ko, zh_CN, zh_TW, hi, am, bn, bho, da, nl, fil,
  fi, gu, ha, id, kn, ml, mr, nb, ru, sw, sv, ta, te, th, tr, uk, vi,
};

// Claude's language tags (from its language picker) mapped to our catalog where
// the tag isn't simply a catalog name. Bare "zh" / "pt" / "no" get the one
// catalog we have for that language. Keys are lowercase with "-".
const TAG_TO_CATALOG: Record<string, string> = {
  "en-us": "en",
  "es-419": "es",
  "es-es": "es",
  "fr-fr": "fr",
  "de-de": "de",
  "it-it": "it",
  "pt-br": "pt_BR",
  "ja-jp": "ja",
  "ko-kr": "ko",
  "zh-hans": "zh_CN",
  "zh-hant": "zh_TW",
  "hi-in": "hi",
  "id-id": "id",
  zh: "zh_CN",
  pt: "pt_BR",
  no: "nb",
};

const CATALOG_BY_TAG: Record<string, string> = Object.fromEntries(
  Object.keys(CATALOGS).map((key) => [key.replace(/_/g, "-").toLowerCase(), key]),
);

// BCP-47 tag ("fr-FR", "zh-Hant", "nl_BE") -> catalog key. Case-insensitive; tries
// the explicit map, then an exact catalog match, dropping trailing subtags until
// something matches ("nl-BE" -> nl, "zh-Hant-TW" -> zh_TW), else English.
export function catalogForTag(tag: string | null | undefined): string {
  const parts = (tag ?? "").trim().replace(/_/g, "-").toLowerCase().split("-").filter(Boolean);
  for (let n = parts.length; n > 0; n--) {
    const candidate = parts.slice(0, n).join("-");
    const catalog = TAG_TO_CATALOG[candidate] ?? CATALOG_BY_TAG[candidate];
    if (catalog) return catalog;
  }
  return "en";
}

let current = "en";
const listeners = new Set<() => void>();

// Accepts a BCP-47 tag or a catalog key ("pt_BR"); anything unknown is English.
export function setLanguage(tag: string | null | undefined): void {
  const next = catalogForTag(tag);
  if (next === current) return;
  current = next;
  listeners.forEach((listener) => listener());
}

export const getLanguage = (): string => current;

// For UI that has to re-render when the language changes under it. Returns an
// unsubscribe function, so it plugs straight into useSyncExternalStore.
export function onLanguageChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

type Sub = string | number;

export function t(key: string, fallback: string, subs?: Sub | Sub[]): string {
  const arr =
    subs === undefined ? undefined : (Array.isArray(subs) ? subs : [subs]).map(String);
  const message = CATALOGS[current]?.[key]?.message ?? CATALOGS.en[key]?.message ?? fallback;
  return applySubs(message, arr);
}

// Positional placeholders ($1..$9), matching the catalog message format.
function applySubs(text: string, subs?: string[]): string {
  if (!subs) return text;
  return text.replace(/\$(\d)/g, (_, d) => subs[Number(d) - 1] ?? "");
}
