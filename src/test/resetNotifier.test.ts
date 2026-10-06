import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "../shared/constants";
import { DEFAULT_SETTINGS } from "../shared/storage";
import type { RealUsageSnapshot, Settings } from "../shared/types";

const store: Record<string, unknown> = {};
const executeScript = vi.fn(async (_options: { target: { tabId: number } }) => []);
const alarmsCreate = vi.fn(async (_name: string, _info: { when: number }) => undefined);
const alarmsClear = vi.fn(async (_name: string) => true);
// One claude.ai tab is always present so injection actually happens and
// executeScript becomes the observable for "did we announce".
const tabsQuery = vi.fn(
  async (_query: Record<string, unknown>) =>
    [{ id: 1, url: "https://claude.ai/new" }] as unknown as chrome.tabs.Tab[],
);

const settingsWith = (overrides: Partial<Settings> = {}): Settings => ({
  ...DEFAULT_SETTINGS,
  ...overrides,
});

const snapshot = (overrides: Partial<RealUsageSnapshot> = {}): RealUsageSnapshot =>
  ({
    source: "real",
    percentageUsed: 40,
    capturedAt: 1_000,
    ...overrides,
  }) as RealUsageSnapshot;

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  vi.clearAllMocks();
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const key of list) if (key in store) out[key] = store[key];
          return out;
        },
        set: async (items: Record<string, unknown>) => {
          Object.assign(store, items);
        },
        remove: async (key: string) => {
          delete store[key];
        },
      },
    },
    alarms: { create: alarmsCreate, clear: alarmsClear },
    scripting: { executeScript },
    tabs: { query: tabsQuery },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const load = async () => await import("../background/resetNotifier");

const copy = { title: "t", actionLabel: "a" };

describe("buildBannerCopy", () => {
  it("names the window that reset in the title", async () => {
    const { buildBannerCopy } = await load();
    const t = (_key: string, fallback: string) => fallback;

    expect(buildBannerCopy("session", t).title).toMatch(/5-hour/);
    expect(buildBannerCopy("weekly", t).title).toMatch(/weekly/);
  });

  it("passes the copy through to the injected banner", async () => {
    const { announceReset } = await load();

    await announceReset("weekly", 6_000, { title: "Weekly reset", actionLabel: "Open" }, settingsWith());

    const args = (executeScript.mock.calls[0]?.[0] as { args?: unknown }).args as string[];
    expect(args).toEqual(["Weekly reset", "Open", "https://claude.ai/new"]);
  });
});

describe("scheduleResetAlarms", () => {
  it("arms an alarm just after each known reset time", async () => {
    const { scheduleResetAlarms, SESSION_ALARM, WEEKLY_ALARM } = await load();
    const now = Date.now();

    await scheduleResetAlarms(
      snapshot({ sessionResetsAt: now + 3_600_000, weeklyAllModelsResetsAt: now + 86_400_000 }),
    );

    expect(alarmsCreate).toHaveBeenCalledTimes(2);
    const names = alarmsCreate.mock.calls.map((call) => call[0]);
    expect(names).toContain(SESSION_ALARM);
    expect(names).toContain(WEEKLY_ALARM);
    // Fires after the boundary, never before it.
    expect(alarmsCreate.mock.calls[0]?.[1].when).toBeGreaterThan(now + 3_600_000);
  });

  it("skips reset times already in the past", async () => {
    const { scheduleResetAlarms } = await load();

    await scheduleResetAlarms(snapshot({ sessionResetsAt: Date.now() - 5_000 }));

    expect(alarmsCreate).not.toHaveBeenCalled();
    expect(alarmsClear).toHaveBeenCalled();
  });
});

describe("announceReset", () => {
  it("injects the banner into the tabs open at reset time", async () => {
    const { announceReset } = await load();

    await announceReset("session", 5_000, copy, settingsWith());

    expect(executeScript).toHaveBeenCalledTimes(1);
  });

  it("persists nothing that could replay the banner on a later page load", async () => {
    const mod = await load();

    await mod.announceReset("session", 5_000, copy, settingsWith());

    // Only the dedupe list may be written. Anything else is a stored "pending
    // notice", which is exactly what made the banner reappear for hours.
    expect(Object.keys(store)).toEqual([STORAGE_KEYS.announcedResets]);
    // And there is no entry point for replaying it onto a freshly loaded tab.
    expect("bannerNewlyLoadedTab" in mod).toBe(false);
  });

  it("leaves the toolbar icon alone", async () => {
    const { announceReset } = await load();

    await announceReset("session", 5_000, copy, settingsWith());

    // chrome.action is absent from the stub entirely: touching the badge would throw.
    expect((globalThis as { chrome?: { action?: unknown } }).chrome?.action).toBeUndefined();
  });

  it("announces a given reset only once", async () => {
    const { announceReset } = await load();

    await announceReset("session", 5_000, copy, settingsWith());
    executeScript.mockClear();
    await announceReset("session", 5_000, copy, settingsWith());

    expect(executeScript).not.toHaveBeenCalled();
  });

  it("stays silent when banners are off", async () => {
    const { announceReset } = await load();

    await announceReset("session", 5_000, copy, settingsWith({ resetBannerScope: "off" }));

    expect(executeScript).not.toHaveBeenCalled();
  });

  it("announces both the 5-hour and weekly windows", async () => {
    const { announceReset } = await load();

    await announceReset("session", 5_000, copy, settingsWith());
    await announceReset("weekly", 6_000, copy, settingsWith());
    expect(executeScript).toHaveBeenCalledTimes(2);
  });

  it("force ignores the once-only dedupe", async () => {
    const { announceReset } = await load();

    await announceReset("session", 5_000, copy, settingsWith(), { force: true });
    expect(executeScript).toHaveBeenCalledTimes(1);

    // Same resetAt twice: the dedupe would normally swallow the second.
    await announceReset("session", 5_000, copy, settingsWith(), { force: true });
    expect(executeScript).toHaveBeenCalledTimes(2);
  });

  it("stays quiet when the closing window went unused", async () => {
    const { announceReset } = await load();

    await announceReset("session", 5_000, copy, settingsWith(), { usedPercentBeforeReset: 0 });

    expect(executeScript).not.toHaveBeenCalled();
  });

  it("announces once real usage was spent in the closing window", async () => {
    const { announceReset } = await load();

    await announceReset("session", 5_000, copy, settingsWith(), { usedPercentBeforeReset: 42 });

    expect(executeScript).toHaveBeenCalledTimes(1);
  });

  it("announces when prior usage is unknown rather than swallowing the rollover", async () => {
    const { announceReset } = await load();

    await announceReset("session", 5_000, copy, settingsWith(), {
      usedPercentBeforeReset: undefined,
    });

    expect(executeScript).toHaveBeenCalledTimes(1);
  });

  it("force shows the test banner even from an unused window", async () => {
    const { announceReset } = await load();

    await announceReset("session", 5_000, copy, settingsWith(), {
      force: true,
      usedPercentBeforeReset: 0,
    });

    expect(executeScript).toHaveBeenCalledTimes(1);
  });

  it("force still refuses to banner when the scope is off", async () => {
    const { announceReset } = await load();

    await announceReset("session", 5_000, copy, settingsWith({ resetBannerScope: "off" }), {
      force: true,
    });

    expect(executeScript).not.toHaveBeenCalled();
  });

  it("only queries claude.ai tabs unless the user granted all sites", async () => {
    const { announceReset } = await load();

    await announceReset("session", 5_000, copy, settingsWith({ resetBannerScope: "claude" }));
    expect(tabsQuery).toHaveBeenCalledWith({ url: "https://claude.ai/*" });

    await announceReset("weekly", 6_000, copy, settingsWith({ resetBannerScope: "everywhere" }));
    expect(tabsQuery).toHaveBeenLastCalledWith({});
  });
});

