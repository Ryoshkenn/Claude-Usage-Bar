import { describe, expect, it } from "vitest";
import { countImageTokens, estimateImageTokensByDims, resizedImageSize } from "../shared/imageTokens";

// Reference values from the Claude vision docs
// (https://platform.claude.com/docs/en/build-with-claude/vision).
describe("imageTokens", () => {
  it("counts one visual token per 28x28 patch", () => {
    expect(countImageTokens(200, 200)).toBe(8 * 8);
    expect(countImageTokens(1000, 1000)).toBe(36 * 36);
  });

  it("leaves fitting images unresized on both tiers", () => {
    // Live 952×1269 photo: 34×46 = 1564, under both tier caps.
    expect(estimateImageTokensByDims(952, 1269, "standard")).toBe(1564);
    expect(estimateImageTokensByDims(952, 1269, "high")).toBe(1564);
  });

  it("downscales an A4 scan to the documented size on the standard tier", () => {
    // Docs: 1075×1520 → 924×1307 → 33×47 = 1551 tokens.
    expect(resizedImageSize(1075, 1520, "standard")).toEqual([924, 1307]);
    expect(estimateImageTokensByDims(1075, 1520, "standard")).toBe(1551);
  });

  it("caps standard-tier estimates at the 1568-token budget", () => {
    expect(estimateImageTokensByDims(4032, 3024, "standard")).toBeLessThanOrEqual(1568);
    expect(estimateImageTokensByDims(4032, 3024, "standard")).toBeGreaterThan(0);
  });

  it("prices more on the high tier for images the standard tier would shrink", () => {
    const standard = estimateImageTokensByDims(4032, 3024, "standard");
    const high = estimateImageTokensByDims(4032, 3024, "high");
    expect(high).toBeGreaterThan(standard);
    expect(high).toBeLessThanOrEqual(4784);
  });

  it("defaults to the high tier and returns 0 for degenerate dims", () => {
    expect(estimateImageTokensByDims(952, 1269)).toBe(1564);
    expect(estimateImageTokensByDims(0, 100)).toBe(0);
  });
});
