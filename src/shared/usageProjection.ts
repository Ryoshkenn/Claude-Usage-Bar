import type { UsageLogEntry, UsageProjection } from "./types";

const FORECAST_WINDOW = 12;
const MIN_ENTRIES_FOR_WEIGHTED = 3;
const RESET_TOLERANCE_MS = 60_000;

export const getMatchingWindowHistory = (
  history: UsageLogEntry[],
  resetAt: number,
): UsageLogEntry[] =>
  history.filter(
    (e) =>
      typeof e.sessionUsedPercent === "number" &&
      typeof e.sessionResetsAt === "number" &&
      Math.abs(e.sessionResetsAt - resetAt) <= RESET_TOLERANCE_MS,
  );

export const trimForecastEntries = (entries: UsageLogEntry[], maxEntries = FORECAST_WINDOW): UsageLogEntry[] =>
  entries.slice(-maxEntries);

export const computeWeightedDrainRate = (entries: UsageLogEntry[]): number | null => {
  if (entries.length < 2) {
    return null;
  }

  const sorted = [...entries].sort((a, b) => a.capturedAt - b.capturedAt);
  let weightedSum = 0;
  let totalWeight = 0;
  const intervalCount = sorted.length - 1;

  for (let i = 0; i < intervalCount; i++) {
    const prev = sorted[i];
    const curr = sorted[i + 1];
    const deltaPercent = (curr.sessionUsedPercent ?? 0) - (prev.sessionUsedPercent ?? 0);
    const deltaHours = (curr.capturedAt - prev.capturedAt) / 3_600_000;

    if (deltaHours <= 0 || deltaPercent <= 0) {
      continue;
    }

    const rate = deltaPercent / deltaHours;
    const weight = i + 1;
    weightedSum += rate * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? weightedSum / totalWeight : null;
};

export const formatEta = (etaMs: number, now: number): string => {
  const remaining = Math.max(0, etaMs - now);
  const totalMinutes = Math.ceil(remaining / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  return `${minutes}m`;
};

export const computeFallbackPace = (
  sessionUsedPercent: number,
  sessionResetsAt: number,
  now: number,
): UsageProjection => {
  const windowDurationMs = 5 * 60 * 60_000;
  const timeUntilResetMs = Math.max(0, sessionResetsAt - now);
  const elapsedMs = windowDurationMs - timeUntilResetMs;

  if (elapsedMs <= 0) {
    return { status: "insufficient_data", label: "" };
  }

  const expectedPercent = (elapsedMs / windowDurationMs) * 100;
  const elapsedHours = elapsedMs / 3_600_000;
  const drainRatePerHour = elapsedHours > 0 ? sessionUsedPercent / elapsedHours : 0;

  if (sessionUsedPercent <= expectedPercent * 1.1) {
    if (drainRatePerHour > 0) {
      const remainingPercent = 100 - sessionUsedPercent;
      const etaHours = remainingPercent / drainRatePerHour;
      const etaMs = now + etaHours * 3_600_000;
      return {
        status: "lasting_to_reset",
        etaMs,
        drainRatePerHour,
        label: `Lasts ${formatEta(etaMs, now)}`,
      };
    }

    return { status: "lasting_to_reset", label: "Lasts until reset" };
  }

  return { status: "insufficient_data", label: "" };
};

export const projectUsageDepletion = (
  sessionUsedPercent: number,
  sessionResetsAt: number,
  drainRatePerHour: number,
  now: number,
): UsageProjection => {
  if (drainRatePerHour <= 0) {
    return { status: "insufficient_data", label: "" };
  }

  const remainingPercent = 100 - sessionUsedPercent;
  const etaHours = remainingPercent / drainRatePerHour;
  const etaMs = now + etaHours * 3_600_000;

  if (etaMs >= sessionResetsAt) {
    return {
      status: "lasting_to_reset",
      etaMs,
      drainRatePerHour,
      label: `Lasts ${formatEta(etaMs, now)}`,
    };
  }

  return {
    status: "projected_empty",
    etaMs,
    drainRatePerHour,
    label: `Projected empty in ${formatEta(etaMs, now)}`,
  };
};

export const computeSessionProjection = (
  history: UsageLogEntry[],
  sessionUsedPercent: number,
  sessionResetsAt: number,
  now = Date.now(),
): UsageProjection => {
  if (typeof sessionUsedPercent !== "number" || typeof sessionResetsAt !== "number") {
    return { status: "insufficient_data", label: "" };
  }

  if (sessionResetsAt <= now) {
    return { status: "insufficient_data", label: "" };
  }

  const matching = getMatchingWindowHistory(history, sessionResetsAt);
  const recent = trimForecastEntries(matching);

  if (recent.length < MIN_ENTRIES_FOR_WEIGHTED) {
    return computeFallbackPace(sessionUsedPercent, sessionResetsAt, now);
  }

  const rate = computeWeightedDrainRate(recent);
  if (rate === null) {
    return computeFallbackPace(sessionUsedPercent, sessionResetsAt, now);
  }

  return projectUsageDepletion(sessionUsedPercent, sessionResetsAt, rate, now);
};

const WEEKLY_WINDOW_MS = 7 * 24 * 60 * 60_000;

const getMatchingWeeklyHistory = (history: UsageLogEntry[], resetAt: number): UsageLogEntry[] =>
  history.filter(
    (e) =>
      typeof e.weeklyUsedPercent === "number" &&
      typeof e.weeklyResetsAt === "number" &&
      Math.abs(e.weeklyResetsAt - resetAt) <= RESET_TOLERANCE_MS,
  );

const computeWeeklyDrainRate = (entries: UsageLogEntry[]): number | null => {
  if (entries.length < 2) return null;
  const sorted = [...entries].sort((a, b) => a.capturedAt - b.capturedAt);
  let weightedSum = 0;
  let totalWeight = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const prev = sorted[i];
    const curr = sorted[i + 1];
    const deltaPercent = (curr.weeklyUsedPercent ?? 0) - (prev.weeklyUsedPercent ?? 0);
    const deltaHours = (curr.capturedAt - prev.capturedAt) / 3_600_000;
    if (deltaHours <= 0 || deltaPercent <= 0) continue;
    const weight = i + 1;
    weightedSum += (deltaPercent / deltaHours) * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? weightedSum / totalWeight : null;
};

const computeWeeklyFallbackPace = (
  usedPercent: number,
  resetsAt: number,
  now: number,
): UsageProjection => {
  const timeUntilResetMs = Math.max(0, resetsAt - now);
  const elapsedMs = WEEKLY_WINDOW_MS - timeUntilResetMs;
  if (elapsedMs <= 0) {
    return { status: "insufficient_data", label: "" };
  }
  const elapsedHours = elapsedMs / 3_600_000;
  const drainRatePerHour = elapsedHours > 0 ? usedPercent / elapsedHours : 0;
  if (drainRatePerHour <= 0) {
    return { status: "lasting_to_reset", label: "Lasts until reset" };
  }
  return projectUsageDepletion(usedPercent, resetsAt, drainRatePerHour, now);
};

export const computeWeeklyProjection = (
  history: UsageLogEntry[],
  weeklyUsedPercent: number,
  weeklyResetsAt: number,
  now = Date.now(),
): UsageProjection => {
  if (typeof weeklyUsedPercent !== "number" || typeof weeklyResetsAt !== "number") {
    return { status: "insufficient_data", label: "" };
  }
  if (weeklyResetsAt <= now) {
    return { status: "insufficient_data", label: "" };
  }

  const matching = getMatchingWeeklyHistory(history, weeklyResetsAt);
  const recent = trimForecastEntries(matching);

  if (recent.length < MIN_ENTRIES_FOR_WEIGHTED) {
    return computeWeeklyFallbackPace(weeklyUsedPercent, weeklyResetsAt, now);
  }

  const rate = computeWeeklyDrainRate(recent);
  if (rate === null) {
    return computeWeeklyFallbackPace(weeklyUsedPercent, weeklyResetsAt, now);
  }

  return projectUsageDepletion(weeklyUsedPercent, weeklyResetsAt, rate, now);
};
