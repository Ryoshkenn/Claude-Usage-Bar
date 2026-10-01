// Image token math, shared by the conversation-API path
// (claudeConversationContext) and the DOM fallback (usageEstimator) so both
// price attached images identically. Kept in its own module — NOT inside
// claudeConversationContext — because that module pulls in the 1.7MB tokenizer
// bundle, which must stay out of the content script.
//
// Formula from the Claude vision docs: one visual token per 28×28px patch,
// i.e. ceil(w/28) × ceil(h/28), after downscaling oversized images to the
// model's tier limits (standard: 1568px edge / 1568 tokens; high-resolution:
// 2576px edge / 4784 tokens). https://platform.claude.com/docs/en/build-with-claude/vision
export type ImageTier = "standard" | "high";

const PATCH_PX = 28;

const TIER_LIMITS: Record<ImageTier, { maxEdge: number; maxTokens: number }> = {
  standard: { maxEdge: 1568, maxTokens: 1568 },
  high: { maxEdge: 2576, maxTokens: 4784 },
};

export const countImageTokens = (width: number, height: number): number =>
  Math.ceil(width / PATCH_PX) * Math.ceil(height / PATCH_PX);

const fitsTier = (width: number, height: number, tier: ImageTier): boolean => {
  const { maxEdge, maxTokens } = TIER_LIMITS[tier];
  return (
    Math.ceil(width / PATCH_PX) * PATCH_PX <= maxEdge &&
    Math.ceil(height / PATCH_PX) * PATCH_PX <= maxEdge &&
    countImageTokens(width, height) <= maxTokens
  );
};

// Largest aspect-preserving size that fits the tier, per the docs' reference
// implementation (binary search along the long edge).
export const resizedImageSize = (width: number, height: number, tier: ImageTier): [number, number] => {
  if (fitsTier(width, height, tier)) {
    return [width, height];
  }
  if (height > width) {
    const [resizedH, resizedW] = resizedImageSize(height, width, tier);
    return [resizedW, resizedH];
  }

  const aspectRatio = width / height;
  let lo = 1;
  let hi = width;
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (fitsTier(mid, Math.max(Math.round(mid / aspectRatio), 1), tier)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return [lo, Math.max(Math.round(lo / aspectRatio), 1)];
};

export const estimateImageTokensByDims = (
  width: number,
  height: number,
  tier: ImageTier = "high",
): number => {
  if (!(width > 0 && height > 0)) {
    return 0;
  }
  const [resizedWidth, resizedHeight] = resizedImageSize(width, height, tier);
  return countImageTokens(resizedWidth, resizedHeight);
};
