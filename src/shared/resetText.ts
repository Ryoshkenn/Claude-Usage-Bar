import { t } from "./i18n";

// "resets in 3h 12m", in the active language, from a limit's reset timestamp.
// The snapshot's stored resetText is formatted in English when the worker parses
// the usage API (formatTimeUntil in claudeUsageApi.ts, same thresholds), so it's
// only the fallback for snapshots that carry no timestamp.
export const formatResetsIn = (
  resetAt: number | undefined,
  fallback: string | undefined,
  now: number = Date.now(),
): string | undefined => {
  if (typeof resetAt !== "number" || !Number.isFinite(resetAt)) {
    return fallback;
  }
  const minutes = Math.ceil(Math.max(0, resetAt - now) / 60_000);
  if (minutes < 60) {
    return t("resetsInM", "resets in $1m", minutes);
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) {
    return remainingMinutes > 0
      ? t("resetsInHM", "resets in $1h $2m", [hours, remainingMinutes])
      : t("resetsInH", "resets in $1h", hours);
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0
    ? t("resetsInDH", "resets in $1d $2h", [days, remainingHours])
    : t("resetsInD", "resets in $1d", days);
};
