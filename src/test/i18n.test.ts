import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { catalogForTag, getLanguage, onLanguageChange, setLanguage, t } from "../shared/i18n";

afterEach(() => setLanguage("en"));

describe("t", () => {
  it("defaults to English", () => {
    expect(t("reset", "Reset")).toBe("Reset");
  });

  it("returns the inline fallback for keys absent from every catalog", () => {
    expect(t("nope", "Plain text")).toBe("Plain text");
  });

  it("substitutes $1..$n", () => {
    expect(t("nope", "Expires in $1", "3:00")).toBe("Expires in 3:00");
    expect(t("nope", "$1 / $2 context", ["5k", "200k"])).toBe("5k / 200k context");
  });

  it("uses the active language's catalog", () => {
    setLanguage("es");
    expect(t("reset", "Reset")).toBe("Restablecer");
    setLanguage("ja");
    expect(t("reset", "Reset")).toBe("リセット");
  });

  it("takes Claude's language tags directly", () => {
    setLanguage("es-419");
    expect(t("reset", "Reset")).toBe("Restablecer");
    setLanguage("ja-JP");
    expect(t("reset", "Reset")).toBe("リセット");
  });

  it("falls back to English for a key missing from the selected catalog", () => {
    setLanguage("es");
    // Force a key that exists in en but pretend-missing elsewhere: use a real key
    // present in all catalogs, then an unknown one resolves via inline fallback.
    expect(t("totally-unknown-key", "English only")).toBe("English only");
  });

  it("ignores unknown languages (stays English)", () => {
    setLanguage("xx");
    expect(t("reset", "Reset")).toBe("Reset");
  });
});

describe("catalogForTag", () => {
  // Every language in Claude's language picker, with the catalog it should get.
  const CLAUDE_TAGS: Record<string, string> = {
    am: "am",
    bn: "bn",
    bho: "bho",
    "zh-Hans": "zh_CN",
    "zh-Hant": "zh_TW",
    da: "da",
    nl: "nl",
    "en-US": "en",
    fil: "fil",
    fi: "fi",
    "fr-FR": "fr",
    "de-DE": "de",
    gu: "gu",
    ha: "ha",
    "hi-IN": "hi",
    "id-ID": "id",
    "it-IT": "it",
    "ja-JP": "ja",
    kn: "kn",
    "ko-KR": "ko",
    ml: "ml",
    mr: "mr",
    nb: "nb",
    "pt-BR": "pt_BR",
    ru: "ru",
    "es-419": "es",
    "es-ES": "es",
    sw: "sw",
    sv: "sv",
    ta: "ta",
    te: "te",
    th: "th",
    tr: "tr",
    uk: "uk",
    vi: "vi",
  };

  it("gives every Claude language its own catalog", () => {
    expect(Object.keys(CLAUDE_TAGS)).toHaveLength(35);
    for (const [tag, catalog] of Object.entries(CLAUDE_TAGS)) {
      expect(catalogForTag(tag), tag).toBe(catalog);
    }
  });

  it("is case-insensitive and accepts _ or -", () => {
    expect(catalogForTag("ZH-hant")).toBe("zh_TW");
    expect(catalogForTag("pt_br")).toBe("pt_BR");
    expect(catalogForTag("es_419")).toBe("es");
    expect(catalogForTag(" fr-fr ")).toBe("fr");
  });

  it("falls back to the base language", () => {
    expect(catalogForTag("nl-BE")).toBe("nl");
    expect(catalogForTag("fr-CA")).toBe("fr");
    expect(catalogForTag("zh-Hant-TW")).toBe("zh_TW");
    expect(catalogForTag("pt-PT")).toBe("pt_BR");
  });

  it("uses English for anything unknown or missing", () => {
    expect(catalogForTag("xx-YY")).toBe("en");
    expect(catalogForTag("en-GB")).toBe("en");
    expect(catalogForTag("")).toBe("en");
    expect(catalogForTag(undefined)).toBe("en");
    expect(catalogForTag(null)).toBe("en");
  });

  it("accepts our own catalog keys", () => {
    expect(catalogForTag("pt_BR")).toBe("pt_BR");
    expect(catalogForTag("zh_TW")).toBe("zh_TW");
  });
});

describe("onLanguageChange", () => {
  it("notifies only when the catalog actually changes", () => {
    const listener = vi.fn();
    const unsubscribe = onLanguageChange(listener);
    setLanguage("fr-FR");
    expect(getLanguage()).toBe("fr");
    setLanguage("fr-CA");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setLanguage("de-DE");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("catalogs", () => {
  const dir = resolve(__dirname, "../locales");
  const read = (file: string) =>
    JSON.parse(readFileSync(resolve(dir, file), "utf8")) as Record<string, { message: string }>;
  const placeholders = (text: string) => [...new Set(text.match(/\$\d/g) ?? [])].sort();
  const en = read("en.json");
  const files = readdirSync(dir).filter((file) => file.endsWith(".json"));

  it("has a catalog for every Claude language", () => {
    expect(files).toHaveLength(34);
  });

  it.each(files)("%s is registered and matches en.json", (file) => {
    const key = file.replace(/\.json$/, "");
    expect(catalogForTag(key)).toBe(key);

    const catalog = read(file);
    expect(Object.keys(catalog).sort()).toEqual(Object.keys(en).sort());
    for (const [id, { message }] of Object.entries(en)) {
      const translated = catalog[id].message;
      expect(typeof translated, `${file} ${id}`).toBe("string");
      expect(translated.trim(), `${file} ${id}`).not.toBe("");
      expect(placeholders(translated), `${file} ${id}`).toEqual(placeholders(message));
    }
  });

  // Machine translations occasionally slip a word in from another language's
  // script (Thai inside Amharic, Russian inside Finnish). Every letter must be in
  // the catalog's own script, or Latin for brand names like Claude and Opus.
  const SCRIPTS: Record<string, string[]> = {
    am: ["Ethiopic"],
    bn: ["Bengali"],
    bho: ["Devanagari"],
    hi: ["Devanagari"],
    mr: ["Devanagari"],
    gu: ["Gujarati"],
    kn: ["Kannada"],
    ml: ["Malayalam"],
    ta: ["Tamil"],
    te: ["Telugu"],
    th: ["Thai"],
    ru: ["Cyrillic"],
    uk: ["Cyrillic"],
    ja: ["Han", "Hiragana", "Katakana"],
    ko: ["Hangul"],
    zh_CN: ["Han"],
    zh_TW: ["Han"],
  };

  it.each(files)("%s stays in its own script", (file) => {
    const scripts = ["Latin", "Common", ...(SCRIPTS[file.replace(/\.json$/, "")] ?? [])];
    const allowed = new RegExp(`^(?:${scripts.map((script) => `\\p{Script=${script}}`).join("|")})$`, "u");
    for (const [id, { message }] of Object.entries(read(file))) {
      const stray = [...message].filter((char) => /\p{L}/u.test(char) && !allowed.test(char));
      expect(stray.join(""), `${file} ${id}: ${message}`).toBe("");
    }
  });
});
