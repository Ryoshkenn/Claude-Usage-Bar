// Localization helper. Catalogs live in src/locales/<lang>.json (Chrome message
// format: { key: { message } }) and are bundled at build time, so lookups are
// synchronous and work in every context.
//
// The active language comes from the `language` setting (default "en"), NOT the
// browser locale — we deliberately do not use chrome.i18n, which is locked to the
// browser UI language and offers no runtime override. Call setLanguage() once the
// settings load; until then everything renders in English.
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
import hi from "../locales/hi.json";

type Catalog = Record<string, { message: string }>;

const CATALOGS: Record<string, Catalog> = { en, es, fr, de, it, pt_BR, ja, ko, zh_CN, hi };

// Shown in the settings dropdown; labels are autonyms so users recognize their own.
export const SUPPORTED_LANGUAGES: { value: string; label: string }[] = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "it", label: "Italiano" },
  { value: "pt_BR", label: "Português (Brasil)" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
  { value: "zh_CN", label: "中文 (简体)" },
  { value: "hi", label: "हिन्दी" },
];

let current = "en";

export function setLanguage(lang: string | undefined): void {
  current = lang && CATALOGS[lang] ? lang : "en";
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
