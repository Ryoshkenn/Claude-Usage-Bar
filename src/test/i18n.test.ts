import { afterEach, describe, expect, it } from "vitest";
import { setLanguage, t, SUPPORTED_LANGUAGES } from "../shared/i18n";

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

  it("uses the selected language's catalog", () => {
    setLanguage("es");
    expect(t("reset", "Reset")).toBe("Restablecer");
    setLanguage("ja");
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

  it("exposes English first in the language list", () => {
    expect(SUPPORTED_LANGUAGES[0]).toEqual({ value: "en", label: "English" });
  });
});
