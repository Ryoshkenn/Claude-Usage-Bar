import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MESSAGE_TYPES } from "../shared/constants";
import { DEFAULT_SETTINGS } from "../shared/storage";
import type { Settings } from "../shared/types";
import {
  announceThreadEvent,
  openThread,
  parseThreadEvent,
  resetThreadNotifierForTests,
  type ThreadEventDetails,
} from "../background/threadNotifier";

const executeScript = vi.fn(async (_options: { target: { tabId: number }; args?: unknown[] }) => []);
const tabsUpdate = vi.fn(async () => undefined);
const tabsCreate = vi.fn(async () => undefined);
const windowsUpdate = vi.fn(async () => undefined);
let tabs: Partial<chrome.tabs.Tab>[] = [];
const tabsQuery = vi.fn(async (query: { active?: boolean; url?: string }) =>
  tabs.filter((tab) => (query.active ? tab.active : true) && (!query.url || tab.url?.startsWith("https://claude.ai/"))),
);

const settingsWith = (overrides: Partial<Settings> = {}): Settings => ({
  ...DEFAULT_SETTINGS,
  threadSidebar: true,
  ...overrides,
});

const event = (overrides: Partial<ThreadEventDetails> = {}): ThreadEventDetails => ({
  event: "done",
  key: "chat:3224989d-2473-4ebb-a864-e6533bee0a17",
  title: "Redesign sidebar",
  path: "/chat/3224989d-2473-4ebb-a864-e6533bee0a17",
  ...overrides,
});

const translate = (_key: string, fallback: string) => fallback;
const bannedTabs = () => executeScript.mock.calls.map(([options]) => options.target.tabId);

beforeEach(() => {
  vi.clearAllMocks();
  resetThreadNotifierForTests();
  tabs = [
    { id: 1, active: true, windowId: 1, url: "https://example.com/article" },
    { id: 2, active: true, windowId: 2, url: "https://claude.ai/new" },
    { id: 3, active: false, windowId: 2, url: "https://claude.ai/chat/3224989d-2473-4ebb-a864-e6533bee0a17" },
  ];
  vi.stubGlobal("chrome", {
    scripting: { executeScript },
    tabs: { query: tabsQuery, update: tabsUpdate, create: tabsCreate },
    windows: { update: windowsUpdate },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseThreadEvent", () => {
  it("accepts a well-formed event and trims the title", () => {
    expect(
      parseThreadEvent({ event: "done", key: "cowork:cse_01JBfMdEAB5B", title: "  A   title  ", path: "/cowork/cse_01JBfMdEAB5B" }),
    ).toEqual({ event: "done", key: "cowork:cse_01JBfMdEAB5B", title: "A title", path: "/cowork/cse_01JBfMdEAB5B" });
  });

  it("rejects unknown events and odd keys, and drops paths that aren't Claude routes", () => {
    expect(parseThreadEvent({ event: "deleted", key: "chat:1" })).toBeNull();
    expect(parseThreadEvent({ event: "done", key: "<script>" })).toBeNull();
    expect(parseThreadEvent({ event: "done", key: "chat:1", path: "https://evil.example" })?.path).toBeNull();
  });
});

describe("announceThreadEvent", () => {
  it("banners the active tab wherever you are when allowed on any site", async () => {
    await announceThreadEvent(event(), settingsWith({ threadDoneAlerts: "everywhere" }), translate);
    expect(bannedTabs().sort()).toEqual([1, 2]);
    const args = executeScript.mock.calls[0][0].args!;
    expect(args).toContain("Claude finished");
    expect(args).toContain("Redesign sidebar");
    expect(args).toContain(MESSAGE_TYPES.openThread);
  });

  it("stays on claude.ai tabs for the claude scope", async () => {
    await announceThreadEvent(event(), settingsWith({ threadDoneAlerts: "claude" }), translate);
    expect(bannedTabs()).toEqual([2]);
  });

  it("skips a tab that is already showing the thread", async () => {
    tabs[1].url = "https://claude.ai/chat/3224989d-2473-4ebb-a864-e6533bee0a17";
    await announceThreadEvent(event(), settingsWith({ threadDoneAlerts: "everywhere" }), translate);
    expect(bannedTabs()).toEqual([1]);
  });

  it("announces each transition once, however many claude.ai tabs report it", async () => {
    const settings = settingsWith({ threadDoneAlerts: "claude" });
    await announceThreadEvent(event(), settings, translate, 1_000);
    await announceThreadEvent(event(), settings, translate, 2_000);
    await announceThreadEvent(event({ event: "awaiting" }), settings, translate, 3_000);
    expect(executeScript).toHaveBeenCalledTimes(2);
    await announceThreadEvent(event(), settings, translate, 200_000);
    expect(executeScript).toHaveBeenCalledTimes(3);
  });

  it("says nothing when alerts or the thread view are off", async () => {
    await announceThreadEvent(event(), settingsWith({ threadDoneAlerts: "off" }), translate);
    await announceThreadEvent(event(), settingsWith({ threadSidebar: false }), translate);
    expect(executeScript).not.toHaveBeenCalled();
  });
});

describe("openThread", () => {
  it("focuses the tab already on the thread", async () => {
    await openThread("/chat/3224989d-2473-4ebb-a864-e6533bee0a17");
    expect(tabsUpdate).toHaveBeenCalledWith(3, { active: true });
    expect(windowsUpdate).toHaveBeenCalledWith(2, { focused: true });
    expect(tabsCreate).not.toHaveBeenCalled();
  });

  it("opens the thread otherwise, and never anything but claude.ai", async () => {
    await openThread("/chat/other");
    expect(tabsCreate).toHaveBeenCalledWith({ url: "https://claude.ai/chat/other" });
    await openThread("//evil.example");
    expect(tabsCreate).toHaveBeenLastCalledWith({ url: "https://claude.ai/" });
  });
});
