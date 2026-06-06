import type { UsageLogEntry, UsageProjection, WeeklyProjectionOptions, WeeklyUsageMetrics } from "./types";

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

  const elapsedHours = elapsedMs / 3_600_000;
  const drainRatePerHour = elapsedHours > 0 ? sessionUsedPercent / elapsedHours : 0;

  if (drainRatePerHour <= 0) {
    return { status: "lasting_to_reset", label: "Lasts until reset" };
  }

  return projectUsageDepletion(sessionUsedPercent, sessionResetsAt, drainRatePerHour, now);
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

  if (etaMs > sessionResetsAt) {
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
const WEEK_MS = WEEKLY_WINDOW_MS;
const MIN_WEEKLY_READY_SAMPLES = 6;
const SMART_WEEKLY_MIN_ACTIVE_HOURS = 50;

const dayKey = (timestamp: number): string => String(new Date(timestamp).getDay());
const hourKey = (timestamp: number): string => String(new Date(timestamp).getHours());
const slotKey = (timestamp: number): string => {
  const date = new Date(timestamp);
  return `${date.getDay()}:${date.getHours()}`;
};
const dateKey = (timestamp: number): string => new Date(timestamp).toLocaleDateString("en-CA");

const incrementBucket = (bucket: Record<string, number>, key: string): void => {
  bucket[key] = (bucket[key] ?? 0) + 1;
};

export const buildWeeklyUsageMetrics = (history: UsageLogEntry[], now = Date.now()): WeeklyUsageMetrics => {
  const weeklyEntries = history
    .filter((entry) => typeof entry.weeklyUsedPercent === "number" && typeof entry.weeklyResetsAt === "number")
    .sort((a, b) => a.capturedAt - b.capturedAt);

  if (weeklyEntries.length === 0) {
    return {
      startedAt: now,
      lastUpdatedAt: now,
      sampleCount: 0,
      activeDayBuckets: {},
      activeHourBuckets: {},
      activeSlotBuckets: {},
      averageActiveHoursPerDay: 0,
      confidence: "learning",
    };
  }

  const activeDayBuckets: Record<string, number> = {};
  const activeHourBuckets: Record<string, number> = {};
  const activeSlotBuckets: Record<string, number> = {};
  const activeHoursByDate = new Map<string, Set<string>>();

  for (let index = 0; index < weeklyEntries.length - 1; index++) {
    const prev = weeklyEntries[index];
    const curr = weeklyEntries[index + 1];
    const sameReset =
      typeof prev.weeklyResetsAt === "number" &&
      typeof curr.weeklyResetsAt === "number" &&
      Math.abs(prev.weeklyResetsAt - curr.weeklyResetsAt) <= RESET_TOLERANCE_MS;
    const deltaPercent = (curr.weeklyUsedPercent ?? 0) - (prev.weeklyUsedPercent ?? 0);

    if (!sameReset || deltaPercent <= 0) {
      continue;
    }

    const day = dayKey(curr.capturedAt);
    const hour = hourKey(curr.capturedAt);
    incrementBucket(activeDayBuckets, day);
    incrementBucket(activeHourBuckets, hour);
    incrementBucket(activeSlotBuckets, slotKey(curr.capturedAt));

    const date = dateKey(curr.capturedAt);
    const activeHours = activeHoursByDate.get(date) ?? new Set<string>();
    activeHours.add(hour);
    activeHoursByDate.set(date, activeHours);
  }

  const activeDayCount = activeHoursByDate.size;
  const totalActiveHours = [...activeHoursByDate.values()].reduce((total, hours) => total + hours.size, 0);
  const startedAt = weeklyEntries[0].capturedAt;
  const lastUpdatedAt = weeklyEntries[weeklyEntries.length - 1].capturedAt;
  const confidence =
    weeklyEntries.length >= MIN_WEEKLY_READY_SAMPLES && lastUpdatedAt - startedAt >= WEEK_MS
      ? "ready"
      : "learning";

  return {
    startedAt,
    lastUpdatedAt,
    sampleCount: weeklyEntries.length,
    activeDayBuckets,
    activeHourBuckets,
    activeSlotBuckets,
    averageActiveHoursPerDay: activeDayCount > 0 ? totalActiveHours / activeDayCount : 0,
    confidence,
  };
};

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

const countScheduledHours = (
  start: number,
  end: number,
  workDays: number[],
  activeHoursPerDay: number,
  startHour = 0,
): number => {
  if (end <= start || activeHoursPerDay <= 0 || workDays.length === 0) {
    return 0;
  }

  const workDaySet = new Set(workDays);
  let cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  let hours = 0;

  while (cursor.getTime() < end) {
    const nextDay = new Date(cursor);
    nextDay.setDate(cursor.getDate() + 1);

    if (workDaySet.has(cursor.getDay())) {
      const activeStart = new Date(cursor);
      activeStart.setHours(Math.max(0, Math.min(23, Math.floor(startHour))), 0, 0, 0);
      const activeEnd = new Date(activeStart);
      activeEnd.setTime(activeStart.getTime() + Math.min(24, Math.max(0, activeHoursPerDay)) * 3_600_000);
      const overlapStart = Math.max(start, activeStart.getTime());
      const overlapEnd = Math.min(end, activeEnd.getTime(), nextDay.getTime());
      if (overlapEnd > overlapStart) {
        hours += (overlapEnd - overlapStart) / 3_600_000;
      }
    }

    cursor = nextDay;
  }

  return hours;
};

const getLearnedSlotSet = (metrics?: WeeklyUsageMetrics): Set<string> | null => {
  const buckets = metrics?.activeSlotBuckets ?? {};
  const slots = Object.entries(buckets)
    .filter(([, count]) => count > 0)
    .map(([slot]) => slot);
  return slots.length > 0 ? new Set(slots) : null;
};

const countLearnedSlotHours = (start: number, end: number, activeSlots: Set<string>): number => {
  if (end <= start || activeSlots.size === 0) {
    return 0;
  }

  let cursor = new Date(start);
  cursor.setMinutes(0, 0, 0);
  let hours = 0;

  while (cursor.getTime() < end) {
    const nextHour = cursor.getTime() + 3_600_000;
    const key = `${cursor.getDay()}:${cursor.getHours()}`;
    if (activeSlots.has(key)) {
      const overlapStart = Math.max(start, cursor.getTime());
      const overlapEnd = Math.min(end, nextHour);
      if (overlapEnd > overlapStart) {
        hours += (overlapEnd - overlapStart) / 3_600_000;
      }
    }
    cursor = new Date(nextHour);
  }

  return hours;
};

const projectManualCalendarEta = (
  start: number,
  end: number,
  activeHoursNeeded: number,
  workDays: number[],
  activeHoursPerDay: number,
  startHour: number,
): number | null => {
  if (activeHoursNeeded <= 0) {
    return start;
  }

  const workDaySet = new Set(workDays);
  let remaining = activeHoursNeeded;
  let cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);

  while (cursor.getTime() < end) {
    const nextDay = new Date(cursor);
    nextDay.setDate(cursor.getDate() + 1);

    if (workDaySet.has(cursor.getDay())) {
      const activeStart = new Date(cursor);
      activeStart.setHours(Math.max(0, Math.min(23, Math.floor(startHour))), 0, 0, 0);
      const activeEnd = new Date(activeStart);
      activeEnd.setTime(activeStart.getTime() + Math.min(24, Math.max(0, activeHoursPerDay)) * 3_600_000);

      const segmentStart = Math.max(start, activeStart.getTime());
      const segmentEnd = Math.min(end, activeEnd.getTime(), nextDay.getTime());
      if (segmentEnd > segmentStart) {
        const segmentHours = (segmentEnd - segmentStart) / 3_600_000;
        if (remaining <= segmentHours) {
          return segmentStart + remaining * 3_600_000;
        }
        remaining -= segmentHours;
      }
    }

    cursor = nextDay;
  }

  return null;
};

const projectLearnedCalendarEta = (
  start: number,
  end: number,
  activeHoursNeeded: number,
  activeSlots: Set<string>,
): number | null => {
  if (activeHoursNeeded <= 0) {
    return start;
  }

  let remaining = activeHoursNeeded;
  let cursor = new Date(start);
  cursor.setMinutes(0, 0, 0);

  while (cursor.getTime() < end) {
    const nextHour = cursor.getTime() + 3_600_000;
    const key = `${cursor.getDay()}:${cursor.getHours()}`;
    if (activeSlots.has(key)) {
      const segmentStart = Math.max(start, cursor.getTime());
      const segmentEnd = Math.min(end, nextHour);
      if (segmentEnd > segmentStart) {
        const segmentHours = (segmentEnd - segmentStart) / 3_600_000;
        if (remaining <= segmentHours) {
          return segmentStart + remaining * 3_600_000;
        }
        remaining -= segmentHours;
      }
    }
    cursor = new Date(nextHour);
  }

  return null;
};

const getSmartWeeklyActiveHourBudget = (options: WeeklyProjectionOptions): number => {
  const manualBudget = Math.max(0, options.manualWorkDays.length * options.manualActiveHoursPerDay);

  if (options.mode === "manual") {
    return manualBudget;
  }

  const learnedDays = Object.keys(options.metrics?.activeDayBuckets ?? {}).length;
  const learnedHoursPerDay = options.metrics?.averageActiveHoursPerDay ?? 0;
  const learnedBudget = learnedDays * learnedHoursPerDay;

  return Math.max(SMART_WEEKLY_MIN_ACTIVE_HOURS, learnedBudget);
};

const computeScheduleAwareWeeklyPace = (
  usedPercent: number,
  resetsAt: number,
  now: number,
  options: WeeklyProjectionOptions,
): UsageProjection | null => {
  const windowStart = resetsAt - WEEKLY_WINDOW_MS;
  const display = options.display ?? "active_hours";
  const learnedSlots = display === "calendar_time" && options.mode === "smart" ? getLearnedSlotSet(options.metrics) : null;
  const totalActiveHours =
    learnedSlots
      ? countLearnedSlotHours(windowStart, resetsAt, learnedSlots)
      : options.mode === "manual"
      ? countScheduledHours(
          windowStart,
          resetsAt,
          options.manualWorkDays,
          options.manualActiveHoursPerDay,
          options.manualStartHour ?? 9,
        )
      : getSmartWeeklyActiveHourBudget(options);
  const elapsedActiveHours =
    learnedSlots
      ? countLearnedSlotHours(windowStart, now, learnedSlots)
      : options.mode === "manual"
      ? countScheduledHours(
          windowStart,
          now,
          options.manualWorkDays,
          options.manualActiveHoursPerDay,
          options.manualStartHour ?? 9,
        )
      : totalActiveHours * Math.max(0, Math.min(1, (now - windowStart) / WEEKLY_WINDOW_MS));
  const remainingActiveHours = Math.max(0, totalActiveHours - elapsedActiveHours);

  if (elapsedActiveHours <= 0 || totalActiveHours <= 0) {
    return null;
  }

  const drainRatePerHour = usedPercent / elapsedActiveHours;
  if (drainRatePerHour <= 0) {
    return { status: "lasting_to_reset", label: "Lasts until reset" };
  }

  const activeHoursUntilEmpty = (100 - usedPercent) / drainRatePerHour;
  const projectedPercentAtReset = Math.min(100, usedPercent + drainRatePerHour * remainingActiveHours);

  if (activeHoursUntilEmpty > remainingActiveHours) {
    return {
      status: "lasting_to_reset",
      etaMs: resetsAt,
      drainRatePerHour,
      activeHoursUntilEmpty,
      projectedPercentAtReset,
      label: `Lasts ${formatEta(resetsAt, now)}`,
    };
  }

  if (display === "calendar_time" && (learnedSlots || options.mode === "manual")) {
    const etaMs = learnedSlots
      ? projectLearnedCalendarEta(now, resetsAt, activeHoursUntilEmpty, learnedSlots)
      : projectManualCalendarEta(
          now,
          resetsAt,
          activeHoursUntilEmpty,
          options.manualWorkDays,
          options.manualActiveHoursPerDay,
          options.manualStartHour ?? 9,
        );

    if (etaMs !== null) {
      return {
        status: "projected_empty",
        etaMs,
        drainRatePerHour,
        projectedPercentAtReset: 100,
        calendarEta: true,
        label: `Projected empty in ${formatEta(etaMs, now)}`,
      };
    }
  }

  return {
    status: "projected_empty",
    etaMs: now + activeHoursUntilEmpty * 3_600_000,
    drainRatePerHour,
    activeHoursUntilEmpty,
    projectedPercentAtReset: 100,
    label: `Projected empty after ${formatEta(activeHoursUntilEmpty * 3_600_000, 0)} active use`,
  };
};

export const computeWeeklyProjection = (
  history: UsageLogEntry[],
  weeklyUsedPercent: number,
  weeklyResetsAt: number,
  now = Date.now(),
  options?: WeeklyProjectionOptions,
): UsageProjection => {
  if (typeof weeklyUsedPercent !== "number" || typeof weeklyResetsAt !== "number") {
    return { status: "insufficient_data", label: "" };
  }
  if (weeklyResetsAt <= now) {
    return { status: "insufficient_data", label: "" };
  }

  const matching = getMatchingWeeklyHistory(history, weeklyResetsAt);
  const recent = trimForecastEntries(matching);
  const smartProjection = options
    ? computeScheduleAwareWeeklyPace(weeklyUsedPercent, weeklyResetsAt, now, options)
    : null;

  if (recent.length < MIN_ENTRIES_FOR_WEIGHTED) {
    return smartProjection ?? computeWeeklyFallbackPace(weeklyUsedPercent, weeklyResetsAt, now);
  }

  const rate = computeWeeklyDrainRate(recent);
  if (rate === null) {
    return smartProjection ?? computeWeeklyFallbackPace(weeklyUsedPercent, weeklyResetsAt, now);
  }

  if (smartProjection) {
    return smartProjection;
  }

  return projectUsageDepletion(weeklyUsedPercent, weeklyResetsAt, rate, now);
};
