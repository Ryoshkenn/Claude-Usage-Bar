import { MESSAGE_TYPES, STORAGE_KEYS } from "./constants";

// The thread view's shared state: per-thread working / done marks
// (chrome.storage.session, STORAGE_KEYS.threadActivity) and where each thread
// sits (chrome.storage.local, STORAGE_KEYS.threadPlaces). Every claude.ai tab
// reads both, but only the background worker writes them. chrome.storage has no
// transactions, so two tabs each reading, merging and writing could both read the
// same snapshot and the second write would drop the first tab's change. Tabs send
// their changes to the worker instead (MESSAGE_TYPES.threadActivityPatch /
// threadPlacesPatch / threadPlacesForget), and it applies them one at a time.
// Both stores hold row keys and timestamps only.

export interface ThreadActivity {
  workingSince?: number;
  awaitingSince?: number;
  doneAt?: number;
}

export interface ThreadPlaces {
  since?: number;
  open: Record<string, number>;
  settled: Record<string, number>;
}

// Row key → entry to store, or null to remove it.
export type ActivityPatch = Record<string, ThreadActivity | null>;

export const ROW_KEY_PATTERN = /^[a-z-]+:[\w-]{1,80}$/;
// Done marks that were never opened, and working marks never seen to finish
// (the tab closed mid-task), stop counting after this long.
export const DONE_TTL_MS = 24 * 60 * 60_000;
export const WORKING_TTL_MS = 12 * 60 * 60_000;
// Open and hand-settled threads kept in storage, newest first. Only bounds the
// store; the list itself has no cap.
export const MAX_PLACES = 1_000;

export const sanitizeActivity = (value: unknown, now = Date.now()): Record<string, ThreadActivity> => {
  const out: Record<string, ThreadActivity> = {};
  if (!value || typeof value !== "object") return out;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!ROW_KEY_PATTERN.test(key) || !raw || typeof raw !== "object") continue;
    const { workingSince, awaitingSince, doneAt } = raw as ThreadActivity;
    const entry: ThreadActivity = {};
    if (typeof workingSince === "number" && now - workingSince < WORKING_TTL_MS) {
      entry.workingSince = workingSince;
      if (typeof awaitingSince === "number" && awaitingSince >= workingSince) entry.awaitingSince = awaitingSince;
    }
    if (typeof doneAt === "number" && now - doneAt < DONE_TTL_MS) entry.doneAt = doneAt;
    if (entry.workingSince || entry.doneAt) out[key] = entry;
  }
  return out;
};

// Applies a tab's per-key changes on top of what's stored; other keys stay.
export const applyActivityPatch = (stored: unknown, patch: unknown, now = Date.now()): Record<string, ThreadActivity> => {
  const merged: Record<string, unknown> = { ...sanitizeActivity(stored, now) };
  if (patch && typeof patch === "object") {
    for (const [key, entry] of Object.entries(patch as Record<string, unknown>)) {
      if (!ROW_KEY_PATTERN.test(key)) continue;
      if (entry === null) delete merged[key];
      else merged[key] = entry;
    }
  }
  return sanitizeActivity(merged, now);
};

const sanitizeKeyTimes = (value: unknown): [string, number][] =>
  value && typeof value === "object"
    ? Object.entries(value as Record<string, unknown>).filter(
        (entry): entry is [string, number] =>
          ROW_KEY_PATTERN.test(entry[0]) && typeof entry[1] === "number" && Number.isFinite(entry[1]),
      )
    : [];

// A key in both maps keeps whichever happened last; a hand-settle from before
// the view started is already covered by its baseline.
export const sanitizePlaces = (value: unknown): ThreadPlaces => {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const since = typeof raw.since === "number" && Number.isFinite(raw.since) ? raw.since : undefined;
  const open = sanitizeKeyTimes(raw.open);
  const settledEntries = sanitizeKeyTimes(raw.settled).filter(([, at]) => since === undefined || at > since);
  const openAt = new Map(open);
  const settledAt = new Map(settledEntries);
  const keep = (entries: [string, number][], other: Map<string, number>) =>
    Object.fromEntries(
      entries
        .filter(([key, at]) => (other.get(key) ?? Number.NEGATIVE_INFINITY) < at)
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_PLACES),
    );
  return { since, open: keep(open, settledAt), settled: keep(settledEntries, openAt) };
};

// Newest time per key across two key → time maps.
const latestTimes = (a: Record<string, number>, b: Record<string, number>): Record<string, number> => {
  const out = { ...a };
  for (const [key, at] of Object.entries(b)) {
    if (!((out[key] ?? Number.NEGATIVE_INFINITY) >= at)) out[key] = at;
  }
  return out;
};

// A tab's places merged into what's stored, newest time per key (sanitizePlaces
// then settles a key found in both maps the same way). The stored baseline wins:
// it's when the view was first turned on.
export const mergePlaces = (stored: unknown, incoming: unknown): ThreadPlaces => {
  const current = sanitizePlaces(stored);
  const next = sanitizePlaces(incoming);
  return sanitizePlaces({
    since: current.since ?? next.since,
    open: latestTimes(current.open, next.open),
    settled: latestTimes(current.settled, next.settled),
  });
};

export interface ThreadStoreWriter {
  patchActivity: (patch: unknown) => Promise<void>;
  patchPlaces: (places: unknown) => Promise<void>;
  forgetPlaces: () => Promise<void>;
}

// One queue for every write, so each read-merge-write finishes before the next
// starts. A places patch is dropped once the view is off, so a tab's late write
// can't bring back places that turning the view off just removed.
export const createThreadStoreWriter = ({
  session,
  local,
  viewEnabled,
}: {
  session: chrome.storage.StorageArea | undefined;
  local: chrome.storage.StorageArea;
  viewEnabled: () => Promise<boolean>;
}): ThreadStoreWriter => {
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = (task: () => Promise<void>): Promise<void> => {
    const run = queue.then(task);
    queue = run.catch(() => undefined);
    return run;
  };
  return {
    patchActivity: (patch) =>
      enqueue(async () => {
        if (!session) throw new Error("session storage unavailable");
        const data = await session.get(STORAGE_KEYS.threadActivity);
        await session.set({ [STORAGE_KEYS.threadActivity]: applyActivityPatch(data[STORAGE_KEYS.threadActivity], patch) });
      }),
    patchPlaces: (places) =>
      enqueue(async () => {
        if (!(await viewEnabled())) return;
        const data = await local.get(STORAGE_KEYS.threadPlaces);
        await local.set({ [STORAGE_KEYS.threadPlaces]: mergePlaces(data[STORAGE_KEYS.threadPlaces], places) });
      }),
    forgetPlaces: () => enqueue(() => local.remove(STORAGE_KEYS.threadPlaces)),
  };
};

// The worker's side of the messages. Null for anything that isn't one of them.
export const handleThreadStoreMessage = (
  writer: ThreadStoreWriter,
  message: unknown,
): Promise<{ ok: boolean }> | null => {
  const data = message as { type?: unknown; patch?: unknown; places?: unknown } | undefined;
  const run =
    data?.type === MESSAGE_TYPES.threadActivityPatch
      ? writer.patchActivity(data.patch)
      : data?.type === MESSAGE_TYPES.threadPlacesPatch
        ? writer.patchPlaces(data.places)
        : data?.type === MESSAGE_TYPES.threadPlacesForget
          ? writer.forgetPlaces()
          : null;
  return run?.then(
    () => ({ ok: true }),
    () => ({ ok: false }),
  ) ?? null;
};
