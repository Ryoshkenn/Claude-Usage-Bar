import type { RealUsageSnapshot, UsageMetadata } from "./types";

type JsonObject = Record<string, unknown>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const compactMetadata = (metadata: UsageMetadata): UsageMetadata =>
  Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined)) as UsageMetadata;

const keyText = (path: string[]): string => path.join(" ").replace(/[_-]+/g, " ").toLowerCase();

// Claude returns run-budget counts as strings (e.g. used: "0", limit: "5"),
// so coerce numeric-looking strings as well as plain numbers.
const coerceCount = (value: unknown): number | undefined => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

// The routines "run-budget" endpoint (GET /v1/code/routines/run-budget) returns
// the count object directly, e.g. { limit: "5", used: "0", unified_billing_enabled }.
// Counts arrive as strings, and the limit varies by plan, so both come from the
// payload — never hardcoded.
export const parseRunBudgetText = (payload: unknown): string | undefined => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const object = payload as JsonObject;
  const used = coerceCount(object.used ?? object.current ?? object.count);
  const limit = coerceCount(object.limit ?? object.max ?? object.total ?? object.allowed);
  return typeof used === "number" && typeof limit === "number" ? `${used} / ${limit}` : undefined;
};

const normalizePercentage = (value: number): number | undefined => {
  if (!Number.isFinite(value) || value < 0) {
    return undefined;
  }

  const percentage = value <= 1 ? value * 100 : value;
  return Math.min(100, Math.max(0, Math.round(percentage)));
};

export const formatTimeUntil = (timestamp: number, now: number): string => {
  const diff = Math.max(0, timestamp - now);
  const minutes = Math.ceil(diff / 60_000);

  if (minutes < 60) {
    return `resets in ${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) {
    return remainingMinutes > 0 ? `resets in ${hours}h ${remainingMinutes}m` : `resets in ${hours}h`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `resets in ${days}d ${remainingHours}h` : `resets in ${days}d`;
};

export const parseResetMetadata = (value: unknown, now: number): { resetText?: string; resetAtMs?: number } => {
  if (typeof value !== "string" && typeof value !== "number") {
    return {};
  }

  const timestamp = typeof value === "number" ? value : new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp > 0
    ? { resetText: formatTimeUntil(timestamp, now), resetAtMs: timestamp }
    : {};
};

const parseLimitObject = (value: unknown, now: number): { percentage?: number; resetText?: string; resetAtMs?: number } | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const object = value as JsonObject;
  const utilization =
    object.utilization ??
    object.percent_used ??
    object.percentage_used ??
    object.percentageUsed ??
    object.used_ratio ??
    object.usage;
  const reset = object.resets_at ?? object.resetsAt ?? object.reset_at ?? object.resetAt;

  return {
    percentage: typeof utilization === "number" ? normalizePercentage(utilization) : undefined,
    ...parseResetMetadata(reset, now),
  };
};

const applyLimit = (
  output: UsageMetadata,
  value: unknown,
  now: number,
  percentageKey: keyof Pick<
    UsageMetadata,
    "percentageUsed" | "weeklyAllModelsPercentageUsed"
  >,
  resetKey?: keyof Pick<UsageMetadata, "resetText" | "weeklyAllModelsResetText">,
  resetAtMsKey?: keyof Pick<UsageMetadata, "sessionResetsAt" | "weeklyAllModelsResetsAt">,
) => {
  const limit = parseLimitObject(value, now);
  if (!limit) {
    return;
  }

  if (typeof limit.percentage === "number") {
    output[percentageKey] = limit.percentage as never;
  }

  if (resetKey && limit.resetText) {
    output[resetKey] = limit.resetText as never;
  }

  if (resetAtMsKey && typeof limit.resetAtMs === "number") {
    output[resetAtMsKey] = limit.resetAtMs as never;
  }
};

const normalizeKnownClaudeUsageSchema = (payload: unknown, now: number): UsageMetadata => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }

  const object = payload as JsonObject;
  const output: UsageMetadata = {};

  applyLimit(output, object.five_hour, now, "percentageUsed", "resetText", "sessionResetsAt");
  applyLimit(output, object.seven_day, now, "weeklyAllModelsPercentageUsed", "weeklyAllModelsResetText", "weeklyAllModelsResetsAt");

  // Claude's /usage payload exposes routine (automation) usage under "run-budget".
  // Keep the older guesses as fallbacks in case the schema shifts again. The limit
  // comes straight from the payload — never hardcoded, since higher plans allow more.
  const routines =
    object["run-budget"] ??
    object.run_budget ??
    object.runBudget ??
    object.routines ??
    object.routine_usage ??
    object.routineUsage;
  if (routines && typeof routines === "object" && !Array.isArray(routines)) {
    const routineObject = routines as JsonObject;
    const used = coerceCount(routineObject.used ?? routineObject.current ?? routineObject.count);
    const limit = coerceCount(
      routineObject.limit ?? routineObject.max ?? routineObject.total ?? routineObject.allowed,
    );

    if (typeof used === "number" && typeof limit === "number") {
      output.routinesText = `${used} / ${limit}`;
    }
  }

  return compactMetadata(output);
};

const coerceUsageText = (text: string): Partial<UsageMetadata> => {
  const percentageMatch = text.match(/(\d{1,3})\s*%\s*used/i);
  const routinesMatch = text.match(/\b(\d+)\s*\/\s*(\d+)\b/);

  return {
    percentageUsed: percentageMatch ? normalizePercentage(Number(percentageMatch[1])) : undefined,
    routinesText: routinesMatch ? `${routinesMatch[1]} / ${routinesMatch[2]}` : undefined,
  };
};

export const extractOrganizationId = (payload: unknown): string | null => {
  const visit = (value: unknown, path: string[] = []): string | null => {
    if (!value || typeof value !== "object") {
      return null;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item, path);
        if (found) {
          return found;
        }
      }
      return null;
    }

    const object = value as JsonObject;
    const explicitId = object.uuid ?? object.id ?? object.organization_uuid ?? object.organizationId;
    if (typeof explicitId === "string" && uuidPattern.test(explicitId)) {
      return explicitId;
    }

    for (const [key, nested] of Object.entries(object)) {
      if (typeof nested === "string" && uuidPattern.test(nested) && /org|uuid|id/.test(key.toLowerCase())) {
        return nested;
      }

      const found = visit(nested, [...path, key]);
      if (found) {
        return found;
      }
    }

    return null;
  };

  return visit(payload);
};

const collectObjectUsage = (object: JsonObject, path: string[], output: UsageMetadata) => {
  const text = keyText(path);
  const entries = Object.entries(object);
  const numberEntries = entries.filter((entry): entry is [string, number] => typeof entry[1] === "number");

  for (const [key, value] of numberEntries) {
    const scopedText = `${text} ${key.replace(/[_-]+/g, " ").toLowerCase()}`;
    const percentage = normalizePercentage(value);

    if (percentage === undefined) {
      continue;
    }

    if (/(5|five).*hour|hour.*limit|five hour|5 hour/.test(scopedText) && /percent|percentage|usage|used/.test(scopedText)) {
      output.percentageUsed = percentage;
    } else if (/weekly/.test(scopedText) && /all.*models|all models/.test(scopedText)) {
      output.weeklyAllModelsPercentageUsed = percentage;
    }
  }

  // Routine (automation) usage lives under "run-budget" — keyText turns the
  // hyphen into a space, so match "run budget" as well as the older "routine".
  // Counts arrive as strings here too, so coerce all entries, not just numbers.
  if (/routine|run budget/.test(text)) {
    const findCount = (re: RegExp): number | undefined => {
      const entry = entries.find(([key]) => re.test(key.toLowerCase()));
      return entry ? coerceCount(entry[1]) : undefined;
    };
    const used = findCount(/used|current|count/);
    const limit = findCount(/limit|max|total|allowed/);

    if (typeof used === "number" && typeof limit === "number") {
      output.routinesText = `${used} / ${limit}`;
    }
  }
};

export const normalizeUsagePayload = (payload: unknown, now = Date.now()): RealUsageSnapshot | null => {
  const output: UsageMetadata = normalizeKnownClaudeUsageSchema(payload, now);

  const visit = (value: unknown, path: string[] = []) => {
    if (!value || typeof value !== "object" || path.length > 8) {
      if (typeof value === "string" && value.length <= 160) {
        const textUsage = coerceUsageText(value);
        const text = keyText(path);

        if (/weekly/.test(text) && /all.*models|all models/.test(text) && textUsage.percentageUsed !== undefined) {
          output.weeklyAllModelsPercentageUsed = textUsage.percentageUsed;
        } else if (/(5|five).*hour|hour.*limit|five hour|5 hour/.test(text) && textUsage.percentageUsed !== undefined) {
          output.percentageUsed = textUsage.percentageUsed;
        } else if (/routine/.test(text) && textUsage.routinesText !== undefined) {
          output.routinesText = textUsage.routinesText;
        }
      }
      return;
    }

    if (Array.isArray(value)) {
      value.slice(0, 50).forEach((item, index) => visit(item, [...path, String(index)]));
      return;
    }

    const object = value as JsonObject;
    collectObjectUsage(object, path, output);

    for (const [key, nested] of Object.entries(object)) {
      visit(nested, [...path, key]);
    }
  };

  visit(payload);

  const metadata = compactMetadata(output);
  return Object.keys(metadata).length > 0
    ? {
        source: "real",
        capturedAt: now,
        ...metadata,
      }
    : null;
};
