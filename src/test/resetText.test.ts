import { afterEach, describe, expect, it } from "vitest";
import { formatTimeUntil } from "../shared/claudeUsageApi";
import { setLanguage } from "../shared/i18n";
import { formatResetsIn } from "../shared/resetText";

const NOW = Date.UTC(2026, 9, 31, 12, 0, 0);
const MIN = 60_000;

afterEach(() => {
  setLanguage("en");
});

describe("formatResetsIn", () => {
  it("matches the worker's English text at every threshold", () => {
    for (const minutes of [0, 1, 59, 60, 61, 125, 23 * 60 + 59, 24 * 60, 24 * 60 + 60, 2 * 24 * 60 + 61]) {
      const resetAt = NOW + minutes * MIN;
      expect(formatResetsIn(resetAt, undefined, NOW)).toBe(formatTimeUntil(resetAt, NOW));
    }
  });

  it("follows the active language", () => {
    setLanguage("sv");
    expect(formatResetsIn(NOW + 192 * MIN, "resets in 3h 12m", NOW)).toBe("nollställs om 3 tim 12 min");
    setLanguage("ja-JP");
    expect(formatResetsIn(NOW + 49 * 60 * MIN, undefined, NOW)).toBe("2日1時間後にリセット");
  });

  it("falls back to the stored text without a timestamp", () => {
    setLanguage("sv");
    expect(formatResetsIn(undefined, "resets in 3h", NOW)).toBe("resets in 3h");
    expect(formatResetsIn(undefined, undefined, NOW)).toBeUndefined();
  });
});
