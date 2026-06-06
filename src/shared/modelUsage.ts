import type { ThinkingLevel, UsageLogEntry, UsageProjection } from "./types";
import { projectUsageDepletion, trimForecastEntries } from "./usageProjection";

// Usage weight per model family, expressed as "messages obtainable per unit of
// 5-hour budget, relative to Opus". Opus is the baseline (1). Derived from
// per-message cost ratios: Opus costs 2.5× Sonnet, Haiku costs 0.25× Sonnet, so
// in cost terms Opus=2.5, Sonnet=1, Haiku=0.25; weight is the inverse normalized
// to Opus → Sonnet ~2.5×, Haiku ~10× more messages. Budget cost of one message is
// opusCost / weight.
export const MODEL_USAGE_WEIGHTS = {
  opus: 1,
  sonnet: 2.5,
  haiku: 10,
} as const;

export type ModelFamily = keyof typeof MODEL_USAGE_WEIGHTS;

// Fallback Opus-equivalent budget cost (in %) of a single message, used only
// during the warmup period before enough per-message samples have accumulated.
// Rough by design — it just keeps the estimate sane for brand-new users. This is
// a *no-thinking* Opus message; the thinking multiplier scales it back up (e.g. a
// high-thinking message lands around 0.7 × 4.75 ≈ 3.3%).
export const DEFAULT_OPUS_PERCENT_PER_MESSAGE = 0.7;

// Equivalent count of "prior observations" the multiplier-based estimate is worth
// when blending it with directly-observed per-segment cost (see resolveCostPerMessage).
// A segment's real data reaches ~50% influence at this many intervals, ~80% at 4×.
// Higher → trust the hardcoded model/thinking priors longer; lower → let a handful
// of real samples reshape the estimate sooner.
export const SEGMENT_COST_SMOOTHING = 4;

// Conservative bias on the messages-left estimate. We deliberately price every
// message higher than the raw (learned or fallback) cost so the count
// under-promises rather than over-promises — running out later than predicted is
// a much better failure than the reverse. Applied once, in computeMessagesLeft,
// so it scales every model and thinking level uniformly (warmup and learned
// alike). 2 → the estimate shows ~half the raw message count; lower it toward 1
// for a looser estimate.
export const CONSERVATIVE_MESSAGE_COST_FACTOR = 2;

const RESET_TOLERANCE_MS = 60_000;

// Mirror the family detection in claudeDom.ts (labels look like "Opus 4.8",
// "Sonnet 4.6", "Haiku 4.5"). Unknown / missing labels return null.
export const normalizeModelFamily = (label?: string): ModelFamily | null => {
  if (!label) {
    return null;
  }
  const lower = label.toLowerCase();
  if (lower.includes("opus")) return "opus";
  if (lower.includes("sonnet")) return "sonnet";
  if (lower.includes("haiku")) return "haiku";
  return null;
};

// Weight of the given model label. Unknown models fall back to Opus (1), the
// conservative choice — it never over-promises how many messages remain.
export const getModelWeight = (label?: string): number => {
  const family = normalizeModelFamily(label);
  return family ? MODEL_USAGE_WEIGHTS[family] : MODEL_USAGE_WEIGHTS.opus;
};

// 1-based rank of each selectable thinking level. Drives the multiplier below.
// (Sonnet stops at "high"; Opus exposes all five — but the rank is shared so
// every model family is tied to the same scale.)
const THINKING_LEVEL_RANK: Record<Exclude<ThinkingLevel, "off">, number> = {
  low: 1,
  medium: 2,
  high: 3,
  extra: 4,
  max: 5,
};

// Map a raw thinking-control label to a level. Returns "off" for missing/unknown
// text so a detection miss degrades to "thinking off" rather than over-charging.
export const normalizeThinkingLevel = (label?: string): ThinkingLevel => {
  if (!label) {
    return "off";
  }
  const lower = label.toLowerCase();
  if (/\b(off|none|disabled)\b/.test(lower)) return "off";
  if (lower.includes("extra")) return "extra";
  if (lower.includes("max")) return "max";
  if (lower.includes("high")) return "high";
  if (lower.includes("medium") || lower.includes("med")) return "medium";
  if (lower.includes("low")) return "low";
  return "off";
};

// Cost multiplier applied on top of a model's base weight when thinking is on.
// This is a *prior* only: it seeds the estimate before per-segment samples exist,
// after which resolveCostPerMessage blends it toward what messages at each
// (model, thinking) level have actually cost — so a wrong multiplier self-corrects.
//   thinkMult = 1 + 1.25 * rank   (low=1 … max=5 → 2.25, 3.5, 4.75, 6.0, 7.25)
// Thinking off → 1.0, so on/off is a smooth step (no cliff) and each level is
// clearly separated, keeping the resulting messages-left estimate monotonic in
// the thinking level. Higher levels burn disproportionately more reasoning
// tokens, so the per-level slope is steep. Haiku has no levels, so any "on" state
// is a flat 3.5 (medium-equivalent on this scale). Unknown families are treated
// like Opus (the conservative, costlier path).
export const getThinkingMultiplier = (
  family: ModelFamily | null,
  level: ThinkingLevel,
): number => {
  if (level === "off") {
    return 1;
  }
  if (family === "haiku") {
    return 3.5;
  }
  return 1 + 1.25 * THINKING_LEVEL_RANK[level];
};

// Effective per-message weight = base model weight ÷ thinking multiplier. Higher
// thinking → lower effective weight → higher cost → fewer messages. This is the
// value stored in history and used for prediction, so learning stays clean.
export const getEffectiveModelWeight = (label?: string, thinkingLevel: ThinkingLevel = "off"): number =>
  getModelWeight(label) / getThinkingMultiplier(normalizeModelFamily(label), thinkingLevel);

const getMatchingSessionHistory = (history: UsageLogEntry[], resetAt: number): UsageLogEntry[] =>
  history.filter(
    (e) =>
      typeof e.sessionUsedPercent === "number" &&
      typeof e.sessionResetsAt === "number" &&
      Math.abs(e.sessionResetsAt - resetAt) <= RESET_TOLERANCE_MS,
  );

// Learn the Opus-equivalent budget cost (%) of a single message from history.
// Each usable interval contributes observedCost = deltaPercent / deltaMessages,
// normalized to Opus-equivalent by multiplying by the active model's weight
// (cheaper models consume less, so their observed cost is scaled back up).
// Intervals missing message-count or model data — and those crossing a window or
// day boundary (non-positive deltas) — are skipped. Returns null when nothing usable.
export const learnOpusEquivCostPerMessage = (
  history: UsageLogEntry[],
  sessionResetsAt: number,
): number | null => {
  const entries = trimForecastEntries(
    getMatchingSessionHistory(history, sessionResetsAt)
      .filter(
        (e) => typeof e.cumulativeMessageCount === "number" && typeof e.modelWeight === "number",
      )
      .sort((a, b) => a.capturedAt - b.capturedAt),
  );

  if (entries.length < 2) {
    return null;
  }

  let weightedSum = 0;
  let totalWeight = 0;

  for (let i = 0; i < entries.length - 1; i++) {
    const prev = entries[i];
    const curr = entries[i + 1];
    const deltaPercent = (curr.sessionUsedPercent ?? 0) - (prev.sessionUsedPercent ?? 0);
    const deltaMessages = (curr.cumulativeMessageCount ?? 0) - (prev.cumulativeMessageCount ?? 0);
    const modelWeight = curr.modelWeight ?? 1;

    if (deltaPercent <= 0 || deltaMessages <= 0 || modelWeight <= 0) {
      continue;
    }

    const opusEquivCost = (deltaPercent / deltaMessages) * modelWeight;
    const recency = i + 1;
    weightedSum += opusEquivCost * recency;
    totalWeight += recency;
  }

  return totalWeight > 0 ? weightedSum / totalWeight : null;
};

// Recency-weighted *directly observed* budget cost (%) of one message in a single
// (model family, thinking level) segment — no multiplier normalization, so it's
// the raw truth for that exact segment. Each interval is attributed to the model +
// thinking active when its messages were sent (the ending entry, mirroring how the
// global learner reads curr.modelWeight). Returns the cost plus the interval count
// (used to weight it against the prior). Null when no matching interval is usable;
// older entries lacking modelLabel/thinkingLevel never match and so are ignored.
export const learnSegmentCostPerMessage = (
  history: UsageLogEntry[],
  sessionResetsAt: number,
  family: ModelFamily | null,
  thinkingLevel: ThinkingLevel,
): { cost: number; count: number } | null => {
  const entries = trimForecastEntries(
    getMatchingSessionHistory(history, sessionResetsAt)
      .filter((e) => typeof e.cumulativeMessageCount === "number")
      .sort((a, b) => a.capturedAt - b.capturedAt),
  );

  if (entries.length < 2) {
    return null;
  }

  let weightedSum = 0;
  let totalWeight = 0;
  let count = 0;

  for (let i = 0; i < entries.length - 1; i++) {
    const prev = entries[i];
    const curr = entries[i + 1];
    if (normalizeModelFamily(curr.modelLabel) !== family) {
      continue;
    }
    if ((curr.thinkingLevel ?? "off") !== thinkingLevel) {
      continue;
    }

    const deltaPercent = (curr.sessionUsedPercent ?? 0) - (prev.sessionUsedPercent ?? 0);
    const deltaMessages = (curr.cumulativeMessageCount ?? 0) - (prev.cumulativeMessageCount ?? 0);
    if (deltaPercent <= 0 || deltaMessages <= 0) {
      continue;
    }

    const recency = i + 1;
    weightedSum += (deltaPercent / deltaMessages) * recency;
    totalWeight += recency;
    count += 1;
  }

  return totalWeight > 0 ? { cost: weightedSum / totalWeight, count } : null;
};

// Blend a directly-observed segment cost with the multiplier-derived prior,
// weighting the observation by how many intervals fed it: count→0 keeps the prior,
// large count converges to the observation. Standard shrinkage — a couple of noisy
// early samples can't yank the estimate, but a consistent signal eventually wins.
export const shrinkTowardPrior = (observed: number, prior: number, count: number): number =>
  (count * observed + SEGMENT_COST_SMOOTHING * prior) / (count + SEGMENT_COST_SMOOTHING);

// Per-message budget cost (%) for the current model + thinking segment. Starts from
// the multiplier-based prior (global learned Opus cost ÷ effective weight) and pulls
// it toward what messages in this exact segment have actually cost as those samples
// accumulate. So if Opus-low really burns 2%/msg, the estimate converges there even
// if the hardcoded thinking multiplier disagrees.
const resolveCostPerMessage = (
  history: UsageLogEntry[],
  sessionResetsAt: number,
  opusBaseline: number,
  modelLabel: string | undefined,
  thinkingLevel: ThinkingLevel,
): number => {
  const effectiveWeight = getEffectiveModelWeight(modelLabel, thinkingLevel);
  const prior = effectiveWeight > 0 ? opusBaseline / effectiveWeight : opusBaseline;
  const segment = learnSegmentCostPerMessage(
    history,
    sessionResetsAt,
    normalizeModelFamily(modelLabel),
    thinkingLevel,
  );
  return segment ? shrinkTowardPrior(segment.cost, prior, segment.count) : prior;
};

// Recency-weighted message cadence (messages/hour) from history. Model-independent
// — it measures how fast the user sends, not how costly each message is.
export const estimateMessagesPerHour = (
  history: UsageLogEntry[],
  sessionResetsAt: number,
): number | null => {
  const entries = trimForecastEntries(
    getMatchingSessionHistory(history, sessionResetsAt)
      .filter((e) => typeof e.cumulativeMessageCount === "number")
      .sort((a, b) => a.capturedAt - b.capturedAt),
  );

  if (entries.length < 2) {
    return null;
  }

  let weightedSum = 0;
  let totalWeight = 0;

  for (let i = 0; i < entries.length - 1; i++) {
    const prev = entries[i];
    const curr = entries[i + 1];
    const deltaMessages = (curr.cumulativeMessageCount ?? 0) - (prev.cumulativeMessageCount ?? 0);
    const deltaHours = (curr.capturedAt - prev.capturedAt) / 3_600_000;

    if (deltaMessages <= 0 || deltaHours <= 0) {
      continue;
    }

    const recency = i + 1;
    weightedSum += (deltaMessages / deltaHours) * recency;
    totalWeight += recency;
  }

  return totalWeight > 0 ? weightedSum / totalWeight : null;
};

export const computeMessagesLeft = (params: {
  remainingPercent: number;
  modelWeight: number;
  opusCostPerMessage: number;
}): number => {
  const { remainingPercent, modelWeight, opusCostPerMessage } = params;
  if (opusCostPerMessage <= 0 || modelWeight <= 0 || remainingPercent <= 0) {
    return 0;
  }
  const costPerMessage = (opusCostPerMessage * CONSERVATIVE_MESSAGE_COST_FACTOR) / modelWeight;
  return Math.max(0, Math.round(remainingPercent / costPerMessage));
};

// Estimated messages left in the current 5-hour window at the currently selected
// model. Uses the learned per-message cost when available, else a rough fallback,
// so it always returns a usable number once we know the session percentage.
export const computeSessionMessagesLeft = (
  history: UsageLogEntry[],
  sessionUsedPercent: number,
  sessionResetsAt: number,
  modelLabel?: string,
  thinkingLevel: ThinkingLevel = "off",
): number | null => {
  if (typeof sessionUsedPercent !== "number" || !Number.isFinite(sessionUsedPercent)) {
    return null;
  }

  const remainingPercent = Math.min(100, Math.max(0, 100 - sessionUsedPercent));
  const opusBaseline =
    learnOpusEquivCostPerMessage(history, sessionResetsAt) ?? DEFAULT_OPUS_PERCENT_PER_MESSAGE;
  // Resolve the per-message cost for *this* segment (multiplier prior, corrected by
  // observed samples), then feed it as the cost with a neutral weight of 1 so the
  // conservative bias in computeMessagesLeft still applies uniformly.
  const costPerMessage = resolveCostPerMessage(
    history,
    sessionResetsAt,
    opusBaseline,
    modelLabel,
    thinkingLevel,
  );

  return computeMessagesLeft({
    remainingPercent,
    modelWeight: 1,
    opusCostPerMessage: costPerMessage,
  });
};

// Model-aware session depletion projection. Reconstructs the projected drain rate
// from learned cadence (messages/hour) and per-message cost at the *currently*
// selected model, so switching to a cheaper model lengthens the projection.
// Returns null when there isn't enough data — callers fall back to the blended
// drain-rate projection in computeSessionProjection.
export const computeModelAwareSessionProjection = (
  history: UsageLogEntry[],
  sessionUsedPercent: number,
  sessionResetsAt: number,
  modelLabel?: string,
  thinkingLevel: ThinkingLevel = "off",
  now = Date.now(),
): UsageProjection | null => {
  if (typeof sessionUsedPercent !== "number" || typeof sessionResetsAt !== "number") {
    return null;
  }
  if (sessionResetsAt <= now) {
    return null;
  }

  const cadence = estimateMessagesPerHour(history, sessionResetsAt);
  const opusCostPerMessage = learnOpusEquivCostPerMessage(history, sessionResetsAt);

  if (cadence === null || opusCostPerMessage === null) {
    return null;
  }

  const costPerMessage = resolveCostPerMessage(
    history,
    sessionResetsAt,
    opusCostPerMessage,
    modelLabel,
    thinkingLevel,
  );
  const projectedDrainRatePerHour = cadence * costPerMessage;

  if (projectedDrainRatePerHour <= 0) {
    return null;
  }

  return projectUsageDepletion(sessionUsedPercent, sessionResetsAt, projectedDrainRatePerHour, now);
};
