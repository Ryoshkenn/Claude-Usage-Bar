import { describe, expect, it } from "vitest";
import type { UsageLogEntry } from "../shared/types";
import {
  CONSERVATIVE_MESSAGE_COST_FACTOR,
  DEFAULT_OPUS_PERCENT_PER_MESSAGE,
  computeMessagesLeft,
  computeModelAwareSessionProjection,
  computeSessionMessagesLeft,
  estimateMessagesPerHour,
  getContextLimitTokens,
  getEffectiveModelWeight,
  getImageTierForModel,
  getModelWeight,
  getThinkingMultiplier,
  learnOpusEquivCostPerMessage,
  learnSegmentCostPerMessage,
  normalizeModelFamily,
  normalizeThinkingLevel,
  SEGMENT_COST_SMOOTHING,
  shrinkTowardPrior,
} from "../shared/modelUsage";

const RESET_AT = Date.now() + 3 * 60 * 60_000;

const makeEntry = (
  capturedAt: number,
  sessionUsedPercent: number,
  cumulativeMessageCount?: number,
  modelWeight?: number,
  sessionResetsAt = RESET_AT,
  extra: Partial<UsageLogEntry> = {},
): UsageLogEntry => ({
  capturedAt,
  sessionUsedPercent,
  cumulativeMessageCount,
  modelWeight,
  sessionResetsAt,
  ...extra,
});

describe("normalizeModelFamily / getModelWeight", () => {
  it("maps model labels to families and weights", () => {
    expect(normalizeModelFamily("Fable 5")).toBe("fable");
    expect(normalizeModelFamily("Opus 4.8")).toBe("opus");
    expect(normalizeModelFamily("Sonnet 4.6")).toBe("sonnet");
    expect(normalizeModelFamily("Claude Haiku 4.5")).toBe("haiku");
    // Fable costs 2x Opus per token, so it yields half the messages per budget.
    expect(getModelWeight("Fable 5")).toBe(0.5);
    expect(getModelWeight("Opus 4.8")).toBe(1);
    expect(getModelWeight("Sonnet 4.6")).toBe(2.5);
    expect(getModelWeight("Haiku 4.5")).toBe(10);
  });

  it("prices a Fable message at twice an Opus message before thinking", () => {
    // Effective weight = base weight / thinking multiplier. With thinking off the
    // multiplier is 1, so Fable's per-message cost is 1/0.5 = 2x Opus's 1/1 = 1.
    expect(getEffectiveModelWeight("Fable 5", "off")).toBe(0.5);
    expect(getEffectiveModelWeight("Opus 4.8", "off")).toBe(1);
  });

  it("falls back to Opus (1) for unknown or missing labels", () => {
    expect(normalizeModelFamily(undefined)).toBeNull();
    expect(normalizeModelFamily("Gemini")).toBeNull();
    expect(getModelWeight(undefined)).toBe(1);
    expect(getModelWeight("Gemini")).toBe(1);
  });
});

describe("getContextLimitTokens", () => {
  it("gives 1M to Fable 5.1+, Opus 5+, Sonnet 5+", () => {
    expect(getContextLimitTokens("Fable 5.1")).toBe(1_000_000);
    expect(getContextLimitTokens("Opus 5")).toBe(1_000_000);
    expect(getContextLimitTokens("Sonnet 5")).toBe(1_000_000);
  });

  it("gives 500K to Opus 4.6–4.8 and Sonnet 4.6", () => {
    expect(getContextLimitTokens("Opus 4.8")).toBe(500_000);
    expect(getContextLimitTokens("Opus 4.8 Max")).toBe(500_000);
    expect(getContextLimitTokens("Opus 4.7")).toBe(500_000);
    expect(getContextLimitTokens("Opus 4.6")).toBe(500_000);
    expect(getContextLimitTokens("Sonnet 4.6")).toBe(500_000);
  });

  it("falls back to 200K for anything else, including Fable 5.0", () => {
    expect(getContextLimitTokens("Fable 5")).toBe(200_000);
    expect(getContextLimitTokens("Haiku 4.5")).toBe(200_000);
    expect(getContextLimitTokens("Sonnet 4.5")).toBe(200_000);
    expect(getContextLimitTokens("Opus 4.5")).toBe(200_000);
    expect(getContextLimitTokens("Gemini")).toBe(200_000);
    expect(getContextLimitTokens(undefined)).toBe(200_000);
  });

  it("falls back to 200K for unlisted future 4.x versions (safe direction)", () => {
    // Sonnet 4.7 / Opus 4.9 aren't in the article — 200K overstates fullness
    // rather than understating it.
    expect(getContextLimitTokens("Sonnet 4.7")).toBe(200_000);
    expect(getContextLimitTokens("Opus 4.9")).toBe(200_000);
  });

  it("anchors the version to the family name, ignoring stray numbers", () => {
    expect(getContextLimitTokens("Opus 4.8 Max")).toBe(500_000);
    expect(getContextLimitTokens("Claude Opus 4.8")).toBe(500_000);
    expect(getContextLimitTokens("Claude Fable 5.1")).toBe(1_000_000);
  });

  it("parses hyphenated API model ids", () => {
    expect(getContextLimitTokens("claude-opus-5")).toBe(1_000_000);
    expect(getContextLimitTokens("claude-haiku-4-5-20251001")).toBe(200_000);
  });
});

describe("getImageTierForModel", () => {
  it("gives the high-resolution tier to 4.7+ models", () => {
    expect(getImageTierForModel("Opus 5")).toBe("high");
    expect(getImageTierForModel("Sonnet 4.6")).toBe("standard");
    expect(getImageTierForModel("Opus 4.8")).toBe("high");
    expect(getImageTierForModel("Haiku 4.5")).toBe("standard");
    expect(getImageTierForModel("claude-opus-5")).toBe("high");
    expect(getImageTierForModel("claude-haiku-4-5-20251001")).toBe("standard");
  });

  it("resolves unknown labels high (safe direction: never understates)", () => {
    expect(getImageTierForModel(undefined)).toBe("high");
    expect(getImageTierForModel("Gemini")).toBe("high");
  });
});

describe("normalizeThinkingLevel", () => {
  it("maps control labels to levels and defaults to off", () => {
    expect(normalizeThinkingLevel("Thinking: High")).toBe("high");
    expect(normalizeThinkingLevel("Extended thinking · Max")).toBe("max");
    expect(normalizeThinkingLevel("thinking extra")).toBe("extra");
    expect(normalizeThinkingLevel("Medium")).toBe("medium");
    expect(normalizeThinkingLevel("thinking off")).toBe("off");
    expect(normalizeThinkingLevel(undefined)).toBe("off");
    expect(normalizeThinkingLevel("nonsense")).toBe("off");
  });
});

describe("getThinkingMultiplier", () => {
  it("applies 1 + 1.25*rank for Opus/Sonnet and a flat 3.5 for Haiku", () => {
    // Off is always 1x.
    expect(getThinkingMultiplier("opus", "off")).toBe(1);
    expect(getThinkingMultiplier("sonnet", "off")).toBe(1);
    expect(getThinkingMultiplier("haiku", "off")).toBe(1);
    // Sonnet: low 2.25, med 3.5, high 4.75 — clearly separated, no off→low cliff.
    expect(getThinkingMultiplier("sonnet", "low")).toBeCloseTo(2.25, 5);
    expect(getThinkingMultiplier("sonnet", "medium")).toBeCloseTo(3.5, 5);
    expect(getThinkingMultiplier("sonnet", "high")).toBeCloseTo(4.75, 5);
    // Opus extends to extra 6.0, max 7.25.
    expect(getThinkingMultiplier("opus", "extra")).toBeCloseTo(6.0, 5);
    expect(getThinkingMultiplier("opus", "max")).toBeCloseTo(7.25, 5);
    // Haiku has no levels: any on-state is the flat 3.5x base.
    expect(getThinkingMultiplier("haiku", "high")).toBe(3.5);
  });
});

describe("getEffectiveModelWeight", () => {
  it("divides the base weight by the thinking multiplier", () => {
    // Thinking off leaves the base weights untouched.
    expect(getEffectiveModelWeight("Opus 4.8", "off")).toBe(1);
    expect(getEffectiveModelWeight("Sonnet 4.6")).toBe(2.5);
    // Higher thinking shrinks the effective weight (costlier per message).
    expect(getEffectiveModelWeight("Opus 4.7", "high")).toBeCloseTo(1 / 4.75, 5);
    expect(getEffectiveModelWeight("Sonnet 4.6", "low")).toBeCloseTo(2.5 / 2.25, 5);
    expect(getEffectiveModelWeight("Haiku 4.5", "low")).toBeCloseTo(10 / 3.5, 5);
  });

  it("ties all Opus versions to the same scale", () => {
    expect(getEffectiveModelWeight("Opus 4.6", "max")).toBeCloseTo(getEffectiveModelWeight("Opus 4.8", "max"), 5);
  });
});

describe("learnOpusEquivCostPerMessage", () => {
  it("normalizes observed per-message cost by model weight", () => {
    const now = Date.now();
    // Opus: 4% over 2 messages => 2%/msg, Opus-equiv 2 * 1 = 2.
    // Sonnet: 4% over 5 messages => 0.8%/msg, Opus-equiv 0.8 * 2.5 = 2.
    const history = [
      makeEntry(now - 3000, 10, 0, 1),
      makeEntry(now - 2000, 14, 2, 1),
      makeEntry(now - 1000, 18, 7, 2.5),
    ];
    const cost = learnOpusEquivCostPerMessage(history, RESET_AT);
    expect(cost).not.toBeNull();
    expect(cost as number).toBeCloseTo(2, 5);
  });

  it("skips intervals lacking message count or model weight", () => {
    const now = Date.now();
    const history = [
      makeEntry(now - 3000, 10, undefined, undefined),
      makeEntry(now - 2000, 20, undefined, undefined),
    ];
    expect(learnOpusEquivCostPerMessage(history, RESET_AT)).toBeNull();
  });

  it("skips cross-day intervals (negative message delta)", () => {
    const now = Date.now();
    const history = [
      makeEntry(now - 3000, 10, 8, 1),
      makeEntry(now - 2000, 12, 1, 1), // counter reset at midnight -> negative delta, skipped
    ];
    expect(learnOpusEquivCostPerMessage(history, RESET_AT)).toBeNull();
  });

  it("ignores entries from a different reset window", () => {
    const now = Date.now();
    const history = [
      makeEntry(now - 3000, 10, 0, 1, RESET_AT + 200 * 60_000),
      makeEntry(now - 2000, 14, 2, 1, RESET_AT + 200 * 60_000),
    ];
    expect(learnOpusEquivCostPerMessage(history, RESET_AT)).toBeNull();
  });
});

describe("estimateMessagesPerHour", () => {
  it("computes recency-weighted cadence from message deltas", () => {
    const now = Date.now();
    const history = [
      makeEntry(now - 2 * 3_600_000, 10, 0, 1),
      makeEntry(now - 1 * 3_600_000, 14, 6, 1), // 6 messages in 1h
    ];
    expect(estimateMessagesPerHour(history, RESET_AT)).toBeCloseTo(6, 5);
  });

  it("returns null without usable message-count samples", () => {
    const now = Date.now();
    expect(estimateMessagesPerHour([makeEntry(now, 10)], RESET_AT)).toBeNull();
  });
});

describe("computeMessagesLeft", () => {
  it("scales inversely with per-message cost and directly with model weight", () => {
    // 50% remaining, 2.5% Opus cost/msg => 20 raw Opus messages; Sonnet (2.5x) => 50;
    // Haiku (10x) => 200, all then divided by the conservative cost factor.
    const k = CONSERVATIVE_MESSAGE_COST_FACTOR;
    expect(computeMessagesLeft({ remainingPercent: 50, modelWeight: 1, opusCostPerMessage: 2.5 })).toBe(20 / k);
    expect(computeMessagesLeft({ remainingPercent: 50, modelWeight: 2.5, opusCostPerMessage: 2.5 })).toBe(50 / k);
    expect(computeMessagesLeft({ remainingPercent: 50, modelWeight: 10, opusCostPerMessage: 2.5 })).toBe(200 / k);
  });

  it("applies the conservative bias (fewer messages than the raw estimate)", () => {
    const conservative = computeMessagesLeft({ remainingPercent: 50, modelWeight: 1, opusCostPerMessage: 2.5 });
    // Raw, un-biased count would be remaining / (cost / weight) = 50 / 2.5 = 20.
    expect(conservative).toBe(Math.round(20 / CONSERVATIVE_MESSAGE_COST_FACTOR));
    expect(conservative).toBeLessThan(20);
  });

  it("returns 0 for degenerate inputs", () => {
    expect(computeMessagesLeft({ remainingPercent: 0, modelWeight: 1, opusCostPerMessage: 2 })).toBe(0);
    expect(computeMessagesLeft({ remainingPercent: 50, modelWeight: 1, opusCostPerMessage: 0 })).toBe(0);
  });
});

describe("computeSessionMessagesLeft", () => {
  it("uses the rough fallback cost when no samples exist yet", () => {
    // 20% used -> 80% remaining, Opus, biased by the conservative cost factor.
    const expected = Math.round(80 / (DEFAULT_OPUS_PERCENT_PER_MESSAGE * CONSERVATIVE_MESSAGE_COST_FACTOR));
    expect(computeSessionMessagesLeft([], 20, RESET_AT, "Opus 4.8")).toBe(expected);
  });

  it("returns null when the session percentage is unknown", () => {
    expect(computeSessionMessagesLeft([], Number.NaN, RESET_AT, "Opus 4.8")).toBeNull();
  });

  it("yields fewer messages as the thinking level rises", () => {
    const off = computeSessionMessagesLeft([], 20, RESET_AT, "Opus 4.8", "off") ?? 0;
    const low = computeSessionMessagesLeft([], 20, RESET_AT, "Opus 4.8", "low") ?? 0;
    const high = computeSessionMessagesLeft([], 20, RESET_AT, "Opus 4.8", "high") ?? 0;
    const max = computeSessionMessagesLeft([], 20, RESET_AT, "Opus 4.8", "max") ?? 0;
    // Strictly decreasing across every step — each level is clearly separated.
    expect(off).toBeGreaterThan(low);
    expect(low).toBeGreaterThan(high);
    expect(high).toBeGreaterThan(max);
    // Off is 2.25x the "low" count (low multiplier is 2.25) — a smooth step, no cliff.
    expect(off / Math.max(1, low)).toBeCloseTo(2.25, 1);
  });

  it("orders messages-left monotonically across models and thinking levels", () => {
    // messages ∝ effectiveWeight = baseWeight / thinkingMultiplier, so the whole
    // model × thinking space collapses to a single strictly-decreasing ranking.
    const at = (model: string, level: Parameters<typeof computeSessionMessagesLeft>[4]) =>
      computeSessionMessagesLeft([], 20, RESET_AT, model, level) ?? 0;
    // A cheap model with light thinking can still beat a costly model with none
    // (Sonnet-low ranks above Opus-off) — the ordering follows effective weight,
    // not model or thinking in isolation.
    const ranking = [
      at("Haiku 4.5", "off"),
      at("Sonnet 4.6", "off"),
      at("Sonnet 4.6", "low"),
      at("Opus 4.8", "off"),
      at("Sonnet 4.6", "high"),
      at("Opus 4.8", "low"),
      at("Opus 4.8", "max"),
    ];
    for (let i = 0; i < ranking.length - 1; i++) {
      expect(ranking[i]).toBeGreaterThan(ranking[i + 1]);
    }
  });
});

describe("learnSegmentCostPerMessage", () => {
  const base = Date.now();
  // Interleave Opus-low messages costing 2%/msg with Sonnet-high costing 1%/msg.
  // Each interval is attributed to the model + thinking of its ENDING entry.
  const seg = (i: number, used: number, label: string, level: "low" | "high") =>
    makeEntry(base + i * 60_000, used, i, getEffectiveModelWeight(label, level), RESET_AT, {
      modelLabel: label,
      thinkingLevel: level,
    });
  const history = [
    seg(0, 0, "Opus 4.8", "low"),
    seg(1, 2, "Opus 4.8", "low"), // +2% opus-low
    seg(2, 3, "Sonnet 4.6", "high"), // +1% sonnet-high
    seg(3, 5, "Opus 4.8", "low"), // +2% opus-low
    seg(4, 6, "Sonnet 4.6", "high"), // +1% sonnet-high
    seg(5, 8, "Opus 4.8", "low"), // +2% opus-low
  ];

  it("learns the directly observed cost for the matching segment only", () => {
    const opusLow = learnSegmentCostPerMessage(history, RESET_AT, "opus", "low");
    expect(opusLow?.cost).toBeCloseTo(2, 5);
    expect(opusLow?.count).toBe(3);

    const sonnetHigh = learnSegmentCostPerMessage(history, RESET_AT, "sonnet", "high");
    expect(sonnetHigh?.cost).toBeCloseTo(1, 5);
    expect(sonnetHigh?.count).toBe(2);
  });

  it("returns null when no interval matches the segment", () => {
    expect(learnSegmentCostPerMessage(history, RESET_AT, "haiku", "off")).toBeNull();
    // Opus exists, but never at 'max' in this history.
    expect(learnSegmentCostPerMessage(history, RESET_AT, "opus", "max")).toBeNull();
  });

  it("ignores older entries that lack model/thinking metadata", () => {
    const legacy = [makeEntry(base, 0, 0, 1), makeEntry(base + 1000, 4, 1, 1)];
    expect(learnSegmentCostPerMessage(legacy, RESET_AT, "opus", "off")).toBeNull();
  });
});

describe("shrinkTowardPrior", () => {
  it("returns the prior with no observations and converges to the observation as count grows", () => {
    expect(shrinkTowardPrior(5, 2, 0)).toBe(2);
    // At the smoothing constant, the observation is weighted half.
    expect(shrinkTowardPrior(5, 1, SEGMENT_COST_SMOOTHING)).toBeCloseTo(3, 5);
    // More samples pull it closer to the observation.
    const few = shrinkTowardPrior(5, 1, 2);
    const many = shrinkTowardPrior(5, 1, 50);
    expect(many).toBeGreaterThan(few);
    // Heavily sampled: most of the way from the prior (1) to the observation (5).
    expect(many).toBeGreaterThan(4.5);
    expect(many).toBeLessThan(5);
  });
});

describe("computeSessionMessagesLeft — learned segment self-correction", () => {
  // Balanced history where the hardcoded thinking multiplier is wrong both ways:
  // Opus-max really costs only 2%/msg (multiplier overcharges it) and Opus-off
  // costs 1%/msg. Built so the two variants share an identical global baseline —
  // the only difference is whether per-segment metadata is present.
  const base = Date.now();
  const rows: Array<["off" | "max", number]> = [
    ["off", 0],
    ["max", 2],
    ["off", 3],
    ["max", 5],
    ["off", 6],
    ["max", 8],
    ["off", 9],
    ["max", 11],
    ["off", 12],
    ["max", 14],
    ["off", 15],
  ];
  const withSegments = rows.map(([level, used], i) =>
    makeEntry(base + i * 60_000, used, i, getEffectiveModelWeight("Opus 4.8", level), RESET_AT, {
      modelLabel: "Opus 4.8",
      thinkingLevel: level,
    }),
  );
  // Same numbers (so the global baseline is identical) but no segment metadata,
  // so learnSegmentCostPerMessage finds nothing and only the multiplier prior applies.
  const noSegments = rows.map(([level, used], i) =>
    makeEntry(base + i * 60_000, used, i, getEffectiveModelWeight("Opus 4.8", level)),
  );

  it("predicts MORE messages for a level the multiplier overcharges, once samples exist", () => {
    const corrected = computeSessionMessagesLeft(withSegments, 50, RESET_AT, "Opus 4.8", "max") ?? 0;
    const priorOnly = computeSessionMessagesLeft(noSegments, 50, RESET_AT, "Opus 4.8", "max") ?? 0;
    // Real Opus-max is cheaper than the 7.25× prior claims → more messages remain.
    expect(corrected).toBeGreaterThan(priorOnly);
  });

  it("predicts FEWER messages for a level the multiplier undercharges", () => {
    const corrected = computeSessionMessagesLeft(withSegments, 50, RESET_AT, "Opus 4.8", "off") ?? 0;
    const priorOnly = computeSessionMessagesLeft(noSegments, 50, RESET_AT, "Opus 4.8", "off") ?? 0;
    // Observed Opus-off cost exceeds the blended baseline → fewer messages remain.
    expect(corrected).toBeLessThan(priorOnly);
  });
});

describe("computeModelAwareSessionProjection", () => {
  it("returns null when there is not enough per-message data", () => {
    const now = Date.now();
    const result = computeModelAwareSessionProjection([makeEntry(now, 20)], 20, RESET_AT, "Opus 4.8", "off", now);
    expect(result).toBeNull();
  });

  it("projects from learned cadence and current model weight", () => {
    const now = Date.now();
    const history = [
      makeEntry(now - 2 * 3_600_000, 10, 0, 1),
      makeEntry(now - 1 * 3_600_000, 14, 6, 1),
    ];
    // Opus projection should drain faster than the same usage on Sonnet (10x cheaper),
    // so Sonnet must last at least as long.
    const opus = computeModelAwareSessionProjection(history, 14, RESET_AT, "Opus 4.8", "off", now);
    const sonnet = computeModelAwareSessionProjection(history, 14, RESET_AT, "Sonnet 4.6", "off", now);
    expect(opus).not.toBeNull();
    expect(sonnet).not.toBeNull();
    const opusEta = opus?.etaMs ?? 0;
    const sonnetEta = sonnet?.etaMs ?? 0;
    expect(sonnetEta).toBeGreaterThanOrEqual(opusEta);
  });
});
