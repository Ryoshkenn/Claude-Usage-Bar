import type { DailyModelUsage } from "./types";

// One rendered column of the popup chart: a date (daily view) or month (monthly
// view) with per-model counts and their total.
export interface ChartBar {
  key: string; // stable identity (date key or "year-month")
  label: string; // short x-axis label
  opus: number;
  sonnet: number;
  haiku: number;
  unknown: number;
  total: number;
}

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const localDateKey = (date: Date): string => date.toLocaleDateString("en-CA");

const entryTotal = (e: DailyModelUsage): number => e.opus + e.sonnet + e.haiku + e.unknown;

const emptyBar = (key: string, label: string): ChartBar => ({
  key,
  label,
  opus: 0,
  sonnet: 0,
  haiku: 0,
  unknown: 0,
  total: 0,
});

type BucketCounts = { opus: number; sonnet: number; haiku: number; unknown: number };

const barFrom = (key: string, label: string, parts: BucketCounts): ChartBar => ({
  key,
  label,
  ...parts,
  total: parts.opus + parts.sonnet + parts.haiku + parts.unknown,
});

// Last `days` calendar days ending today, oldest first, with gaps filled as
// zero bars so the chart keeps a steady width while history is sparse.
export const buildDailySeries = (
  history: DailyModelUsage[],
  days = 14,
  now: Date = new Date(),
): ChartBar[] => {
  const byDate = new Map(history.map((e) => [e.date, e]));
  const bars: ChartBar[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const key = localDateKey(d);
    const label = `${d.getMonth() + 1}/${d.getDate()}`;
    const e = byDate.get(key);
    bars.push(
      e
        ? barFrom(key, label, {
            opus: e.opus,
            sonnet: e.sonnet,
            haiku: e.haiku,
            unknown: e.unknown,
          })
        : emptyBar(key, label),
    );
  }
  return bars;
};

// Last `months` calendar months ending this month, oldest first, each summing
// every recorded day in that month.
export const buildMonthlySeries = (
  history: DailyModelUsage[],
  months = 6,
  now: Date = new Date(),
): ChartBar[] => {
  const sums = new Map<string, BucketCounts>();
  for (const e of history) {
    const d = new Date(`${e.date}T00:00:00`);
    if (Number.isNaN(d.getTime())) {
      continue;
    }
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const s = sums.get(key) ?? { opus: 0, sonnet: 0, haiku: 0, unknown: 0 };
    s.opus += e.opus;
    s.sonnet += e.sonnet;
    s.haiku += e.haiku;
    s.unknown += e.unknown;
    sums.set(key, s);
  }

  const bars: ChartBar[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const label = MONTH_LABELS[d.getMonth()];
    const s = sums.get(key);
    bars.push(s ? barFrom(key, label, s) : emptyBar(key, label));
  }
  return bars;
};

export interface UsageSummary {
  total: number;
  perDayAverage: number;
  busiest: ChartBar | null;
}

export const summarizeSeries = (bars: ChartBar[]): UsageSummary => {
  const total = bars.reduce((sum, b) => sum + b.total, 0);
  const busiest = bars.reduce<ChartBar | null>(
    (best, b) => (best === null || b.total > best.total ? b : best),
    null,
  );
  return {
    total,
    perDayAverage: bars.length ? Math.round(total / bars.length) : 0,
    busiest: busiest && busiest.total > 0 ? busiest : null,
  };
};

export interface ModelSplit {
  opus: number;
  sonnet: number;
  haiku: number;
  unknown: number;
  total: number;
}

export const modelSplit = (bars: ChartBar[]): ModelSplit => {
  const s = bars.reduce(
    (acc, b) => ({
      opus: acc.opus + b.opus,
      sonnet: acc.sonnet + b.sonnet,
      haiku: acc.haiku + b.haiku,
      unknown: acc.unknown + b.unknown,
    }),
    { opus: 0, sonnet: 0, haiku: 0, unknown: 0 },
  );
  return { ...s, total: s.opus + s.sonnet + s.haiku + s.unknown };
};

export const splitPercent = (split: ModelSplit, key: keyof Omit<ModelSplit, "total">): number =>
  split.total ? Math.round((split[key] / split.total) * 100) : 0;

export const allTimeTotal = (history: DailyModelUsage[]): number =>
  history.reduce((sum, e) => sum + entryTotal(e), 0);

// Consecutive active days ending today (today counts as soon as it has a
// message). Returns 0 when today has no messages yet.
export const activeDayStreak = (history: DailyModelUsage[], now: Date = new Date()): number => {
  const activeDays = new Set(history.filter((e) => entryTotal(e) > 0).map((e) => e.date));
  let streak = 0;
  const cursor = new Date(now);
  while (activeDays.has(localDateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
};
