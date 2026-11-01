import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MESSAGE_TYPES, STORAGE_KEYS } from "../shared/constants";
import {
  applyThreadSidebar,
  formatThreadAgo,
  handleThreadTimesMessage,
  initThreadSidebar,
  NAV_TOGGLE_ID,
  placeThreadRows,
  readRowStatus,
  resetThreadSidebarForTests,
  SETTLED_TOGGLE_ID,
  syncThreadSidebar,
  syncThreadSidebarTheme,
  threadDisplayOrder,
  threadKindOf,
  threadWhenText,
  TOP_ACTIONS_ID,
  TOP_ROW_ID,
  type ThreadRowInfo,
} from "../content/threadSidebar";

interface RowSpec {
  key: string;
  status?: string;
  unreadMark?: boolean;
  current?: boolean;
  icon?: boolean;
}

interface SidebarSpec {
  groups: { label: [string, string]; rows: RowSpec[] }[];
  pinned?: RowSpec[];
  pinnedProjects?: boolean;
  pinnedCollapsed?: boolean;
  scheduledDot?: boolean;
  claudeSearchBar?: boolean;
  // Oct 2026 markup: the New link itself is .shrink-0 and Search is a row
  // beside it (Ctrl+K) rather than a bar.
  searchRow?: boolean;
}

const idOf = (key: string): string => key.slice(key.indexOf(":") + 1);

// Mirrors the structure of claude.ai's sidebar rows (data-row-key wrapper →
// [data-row] → main button + trailing decoration + hover actions).
const rowHtml = ({ key, status, unreadMark, current, icon }: RowSpec): string => {
  const id = idOf(key);
  const href = key.startsWith("cowork:") ? `/cowork/${id}` : key.startsWith("project:") ? `/project/${id}` : `/chat/${id}`;
  return `
    <div data-row-key="${key}" class="relative df-drag-shiftable">
      <div><div id="base-${id}">
        <div data-row="" class="group hit-row">
          <a href="${href}" data-row-main-button=""${current ? ' aria-current="page"' : ""}>
            ${icon ? '<span class="df-leading-slot"><span data-cds="Icon"></span></span>' : ""}
            <span data-row-label="${icon ? "" : "iconless"}"><span class="dframe-fade-label"><span>Title ${id}</span></span></span>
          </a>
          ${status ? `<span data-row-decoration=""><span class="status-dot" data-kind="${status}"></span></span>` : ""}
          ${unreadMark ? "<span data-unread-mark></span>" : ""}
          <div><button type="button" aria-label="More options for ${id}"></button></div>
        </div>
      </div></div>
    </div>`;
};

const labelHtml = (key: string, name: string): string => `
  <div data-row-key="${key}" class="df-drag-shiftable">
    <div data-sidebar-group-label="">
      <button type="button" data-group-toggle="" aria-expanded="true"><span data-group-name="">${name}</span></button>
      <div><button type="button" data-cds-icon-only="" aria-label="Search" aria-keyshortcuts="Control+Shift+k"></button></div>
    </div>
  </div>`;

const pinnedHtml = ({ pinned = [], pinnedProjects, pinnedCollapsed }: SidebarSpec): string => `
  <div data-testid="sidebar-pinned" data-pinned-list="" class="flex flex-col gap-px">
    <div><div data-sidebar-group-label="">
      <button type="button" data-group-toggle="" aria-expanded="${pinnedCollapsed ? "false" : "true"}"><span data-group-name="">Pinned</span></button>
    </div></div>
    <div data-testid="sidebar-pinned-leading">
      ${
        pinnedProjects
          ? `<div data-row-key="section:home-projects"><div data-testid="sidebar-projects">${rowHtml({ key: "project:p1", icon: true })}${rowHtml({ key: "project:p2", icon: true })}</div></div>`
          : ""
      }
    </div>
    <div class="flex flex-col">${pinned.map(rowHtml).join("")}</div>
  </div>`;

// Wrappers above the lists are display:contents in claude.ai, which makes the
// scroll column the nearest real box holding both pinned and recents.
const mountSidebar = (spec: SidebarSpec) => {
  document.body.innerHTML = `
    <aside aria-label="Sidebar">
      <div data-testid="sidebar">
        ${
          spec.claudeSearchBar
            ? '<div id="search-host"><button type="button" aria-keyshortcuts="Control+Shift+k"><span>Search</span></button></div>'
            : ""
        }
        ${
          spec.searchRow
            ? '<div class="shrink-0" id="new-host"><div class="contents"><a href="/new" class="w-full shrink-0" data-row="" data-row-main-button="" aria-keyshortcuts="Control+Shift+o">New</a></div><button type="button" id="search-row" class="w-full shrink-0" data-row="" data-row-main-button="" data-row-nav="" aria-keyshortcuts="Control+k">Search</button></div>'
            : '<div class="shrink-0" id="new-host"><div class="contents"><a href="/new" data-row="" data-row-main-button="" aria-keyshortcuts="Control+Shift+o">New</a></div></div>'
        }
        <div class="dframe-nav-scroll" id="nav-scroll">
          <div data-testid="nav-pin-rows">
            <div data-row=""><a href="/cowork/projects" data-row-main-button="" data-nav-item="projects">Projects</a></div>
            <div data-row="">
              <a href="/scheduled-task" data-row-main-button="" data-nav-item="scheduled">Scheduled</a>
              ${spec.scheduledDot ? '<span data-row-decoration=""><span class="status-dot" data-kind="ready"></span></span>' : ""}
            </div>
            <div data-nav-end-spacer="true"></div>
          </div>
          <div class="dframe-recents-by-mode" data-mode="cowork" style="display: contents">
            <div data-kind="cowork" style="display: contents">
              <div data-first-paint-hold="released" style="display: contents">
                ${spec.pinned || spec.pinnedProjects ? pinnedHtml(spec) : ""}
                <div data-testid="sidebar-recents" data-recents-list="" class="df-recents-anchor">
                  <div class="group/section relative isolate flex flex-col gap-px">
                    ${spec.groups
                      .map(({ label, rows }) => `${labelHtml(...label)}<div class="contents">${rows.map(rowHtml).join("")}</div>`)
                      .join("")}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>`;
  return {
    sidebar: document.querySelector<HTMLElement>('[data-testid="sidebar"]')!,
    column: document.getElementById("nav-scroll")!,
    recents: document.querySelector<HTMLElement>('[data-testid="sidebar-recents"]')!,
    nav: document.querySelector<HTMLElement>('[data-testid="nav-pin-rows"]')!,
    newLink: document.querySelector<HTMLAnchorElement>('a[href="/new"]')!,
  };
};

const read = (rows: RowSpec[]): SidebarSpec => ({ groups: [{ label: ["label:unread-read", "Read"], rows }] });
const rowEl = (key: string): HTMLElement => document.querySelector<HTMLElement>(`[data-row-key="${key}"]`)!;
const placementOf = (key: string): string | null => rowEl(key).getAttribute("data-cub-thread");
const orderOf = (key: string): number => Number(rowEl(key).style.order);
const kindTextOf = (key: string): string | null | undefined => rowEl(key).querySelector(".cub-thread-kind")?.textContent;
const whenOf = (key: string): string | null | undefined => rowEl(key).querySelector(".cub-thread-when")?.textContent;
const isCard = (key: string): boolean => rowEl(key).querySelector("[data-row]")!.hasAttribute("data-cub-thread-card");
const settledToggle = (): HTMLButtonElement | null =>
  document.getElementById(SETTLED_TOGGLE_ID) as HTMLButtonElement | null;
const navToggle = (): HTMLButtonElement | null => document.getElementById(NAV_TOGGLE_ID) as HTMLButtonElement | null;
const flushObservers = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};
const postTimes = (items: { id: string; createdAt?: number; updatedAt?: number }[]): void =>
  handleThreadTimesMessage(new MessageEvent("message", { data: { type: MESSAGE_TYPES.threadTimes, items }, source: window }));
const stopWorking = (key: string): void => {
  rowEl(key).querySelector("[data-row-decoration]")?.remove();
};

// jsdom has no layout; give Claude's search bar the box a real one would have.
const layOutSearchBar = (): HTMLElement => {
  const button = document.querySelector<HTMLElement>("#search-host > button")!;
  button.getClientRects = () => [new DOMRect(0, 0, 260, 32)] as unknown as DOMRectList;
  button.getBoundingClientRect = () => new DOMRect(0, 0, 260, 32);
  document.querySelector("aside")!.getBoundingClientRect = () => new DOMRect(0, 0, 300, 900);
  return document.getElementById("search-host")!;
};

const ten = Array.from({ length: 10 }, (_, i) => ({ key: `chat:c${i}` }));
const NOW = new Date("2026-10-21T12:00:00Z").getTime();

beforeEach(() => {
  history.replaceState(null, "", "/new");
});

afterEach(() => {
  resetThreadSidebarForTests();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("placeThreadRows", () => {
  const row = (partial: Partial<ThreadRowInfo> = {}): ThreadRowInfo => ({
    label: false,
    status: null,
    current: false,
    ...partial,
  });

  it("settles everything without activity, and cards live and open threads with no cap", () => {
    const rows = [row(), row({ open: true }), row({ status: "working" }), row(), row({ open: true })];
    expect(placeThreadRows(rows)).toEqual(["settled", "open", "live", "settled", "open"]);
    const many = Array.from({ length: 40 }, () => row({ open: true }));
    expect(placeThreadRows(many).every((placement) => placement === "open")).toBe(true);
  });

  it("lifts the open thread out of a folded Settled section, not an open one", () => {
    const rows = [row({ current: true }), row()];
    expect(placeThreadRows(rows, true)).toEqual(["open", "settled"]);
    expect(placeThreadRows(rows, false)).toEqual(["settled", "settled"]);
    expect(placeThreadRows([row({ current: true, settled: true })], true)).toEqual(["settled"]);
  });

  it("keeps a thread settled by hand there, even while Claude marks it", () => {
    expect(placeThreadRows([row({ settled: true, status: "unread" })])).toEqual(["settled"]);
  });

  it("keeps only the first group label", () => {
    const rows = [row({ label: true }), row({ open: true }), row({ label: true }), row()];
    expect(placeThreadRows(rows)).toEqual(["label", "open", "label-hidden", "settled"]);
  });

  it("leads with pinned threads and hides pinned projects", () => {
    const rows = [row({ hidden: true }), row({ pinned: true }), row({ pinned: true, status: "working" }), row({ open: true }), row()];
    expect(placeThreadRows(rows)).toEqual(["hidden", "pinned", "pinned", "open", "settled"]);
  });
});

describe("threadDisplayOrder", () => {
  it("keeps Claude's order when nothing has a timestamp", () => {
    expect(threadDisplayOrder([{}, {}, {}], "edited")).toEqual([0, 1, 2]);
  });

  it("sorts by last activity, counting local activity, for newest edited", () => {
    const entries = [{ updatedAt: 300 }, { updatedAt: 200 }, { updatedAt: 100, activityAt: 900 }];
    expect(threadDisplayOrder(entries, "edited")).toEqual([2, 0, 1]);
  });

  it("sorts by creation for newest created", () => {
    const entries = [{ createdAt: 10, updatedAt: 300 }, { createdAt: 30, updatedAt: 200 }, { createdAt: 20 }];
    expect(threadDisplayOrder(entries, "created")).toEqual([1, 2, 0]);
  });

  it("keeps a row without a timestamp beside the row Claude put above it", () => {
    const entries = [{ updatedAt: 100 }, {}, { updatedAt: 500 }];
    expect(threadDisplayOrder(entries, "edited")).toEqual([2, 0, 1]);
  });
});

describe("row status and labels", () => {
  it("maps Claude's status dots onto thread states", () => {
    for (const [kind, expected] of [
      ["running", "working"],
      ["clay", "working"],
      ["awaiting", "awaiting"],
      ["error", "error"],
      ["ready", "done"],
      ["unread", "unread"],
    ] as const) {
      mountSidebar(read([{ key: "chat:a", status: kind }]));
      expect(readRowStatus(rowEl("chat:a"))).toBe(expected);
    }
  });

  it("reads the unread mark and prefers the state that needs the user", () => {
    mountSidebar(read([{ key: "chat:a", unreadMark: true }]));
    expect(readRowStatus(rowEl("chat:a"))).toBe("unread");
    rowEl("chat:a").insertAdjacentHTML("beforeend", '<span class="status-dot" data-kind="awaiting"></span>');
    expect(readRowStatus(rowEl("chat:a"))).toBe("awaiting");
  });

  it("names kinds from the row key", () => {
    expect(threadKindOf("chat:1")).toBe("chat");
    expect(threadKindOf("cowork:cse_1")).toBe("cowork");
    expect(threadKindOf("scheduled-task:trig_1")).toBe("routine");
    expect(threadKindOf("code:session_1")).toBe("code");
    expect(threadKindOf("mystery:1")).toBe("other");
  });

  it("formats ages and live states like T3", () => {
    expect(formatThreadAgo(31_000)).toBe("31s");
    expect(formatThreadAgo(12 * 60_000)).toBe("12m");
    expect(formatThreadAgo(17 * 3_600_000)).toBe("17h");
    expect(formatThreadAgo(3 * 86_400_000)).toBe("3d");
    expect(formatThreadAgo(15 * 86_400_000)).toBe("2w");
    expect(threadWhenText("working", { workingSince: NOW - 12 * 60_000 }, undefined, NOW)).toBe("Working 12m");
    expect(threadWhenText("awaiting", { awaitingSince: NOW - 31_000 }, undefined, NOW)).toBe("Waiting 31s");
    expect(threadWhenText("done", undefined, undefined, NOW)).toBe("Done");
    expect(threadWhenText(null, undefined, { updatedAt: NOW - 11 * 60_000 }, NOW)).toBe("11m");
    expect(threadWhenText(null, undefined, undefined, NOW)).toBe("");
  });
});

describe("thread sidebar DOM", () => {
  it("does nothing while the option is off", () => {
    const { column } = mountSidebar({ ...read(ten), pinned: [{ key: "chat:p" }], pinnedProjects: true });
    const before = document.body.innerHTML;
    syncThreadSidebar({ threadSidebar: false });
    expect(document.body.innerHTML).toBe(before);
    expect(column.hasAttribute("data-cub-threads")).toBe(false);
  });

  it("starts with everything settled under the Settled bar", () => {
    const { column, recents } = mountSidebar(read(ten));
    syncThreadSidebar({ threadSidebar: true });

    expect(column.getAttribute("data-cub-threads")).toBe("on");
    expect(column.getAttribute("data-cub-threads-settled")).toBe("closed");
    expect(recents.hasAttribute("data-cub-thread-flat")).toBe(true);
    expect(placementOf("label:unread-read")).toBe("label");
    expect(ten.every(({ key }) => placementOf(key) === "settled")).toBe(true);
    expect(ten.some(({ key }) => isCard(key))).toBe(false);
    expect(orderOf("chat:c0")).toBeGreaterThan(4_000);
    expect(orderOf("chat:c0")).toBeLessThan(orderOf("chat:c1"));
    expect(rowEl("chat:c0").querySelector(".cub-thread-meta")).toBeNull();
    expect(document.querySelector("[data-group-name]")!.getAttribute("data-cub-thread-label")).toBe("Threads");

    expect(settledToggle()?.parentElement).toBe(recents);
    expect(settledToggle()?.textContent).toBe("Settled (10)");
    settledToggle()!.click();
    expect(column.getAttribute("data-cub-threads-settled")).toBe("open");
    expect(settledToggle()!.getAttribute("aria-expanded")).toBe("true");
  });

  it("opens a thread as a card once it has activity, and keeps it there", async () => {
    mountSidebar(read(ten));
    syncThreadSidebar({ threadSidebar: true });

    rowEl("chat:c3").querySelector("[data-row]")!.insertAdjacentHTML(
      "beforeend",
      '<span data-row-decoration=""><span class="status-dot" data-kind="running"></span></span>',
    );
    await flushObservers();
    expect(placementOf("chat:c3")).toBe("live");
    expect(kindTextOf("chat:c3")).toBe("Chat");
    expect(rowEl("chat:c3").querySelector('.cub-thread-chip[data-kind="chat"]')).not.toBeNull();

    // Seen finished, it stays a card rather than settling again.
    history.replaceState(null, "", "/chat/c3");
    stopWorking("chat:c3");
    await flushObservers();
    history.replaceState(null, "", "/new");
    applyThreadSidebar();
    expect(placementOf("chat:c3")).toBe("open");
    expect(isCard("chat:c3")).toBe(true);
    expect(orderOf("chat:c3")).toBeLessThan(4_000);
    expect(settledToggle()?.textContent).toBe("Settled (9)");
  });

  it("opens every thread that changed after it started, with no cap", () => {
    const uuid = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
    const keys = Array.from({ length: 20 }, (_, n) => `chat:${uuid(n)}`);
    mountSidebar(read(keys.map((key) => ({ key }))));
    syncThreadSidebar({ threadSidebar: true });
    const later = Date.now() + 60_000;
    postTimes(keys.map((key, n) => ({ id: key.slice(5), updatedAt: later - n * 1_000 })));

    expect(keys.every((key) => placementOf(key) === "open" && isCard(key))).toBe(true);
    expect(settledToggle()).toBeNull();
  });

  it("puts a working thread on top with its status, separated from the open cards", async () => {
    history.replaceState(null, "", "/chat/b");
    mountSidebar(read([{ key: "chat:a", status: "running" }, { key: "chat:b", status: "running" }, ...ten]));
    syncThreadSidebar({ threadSidebar: true });
    stopWorking("chat:b");
    await flushObservers();
    history.replaceState(null, "", "/new");
    applyThreadSidebar();

    expect(placementOf("chat:a")).toBe("live");
    expect(placementOf("chat:b")).toBe("open");
    expect(orderOf("chat:a")).toBeLessThan(orderOf("chat:b"));
    expect(whenOf("chat:a")).toMatch(/^Working/);
    expect(rowEl("chat:a").querySelector('.cub-thread-when[data-state="working"]')).not.toBeNull();
    expect(rowEl("chat:b").hasAttribute("data-cub-thread-first")).toBe(true);
    expect(settledToggle()?.textContent).toBe("Settled (10)");
  });

  it("keeps the thread you're on in sight while Settled is folded", () => {
    history.replaceState(null, "", "/chat/c6");
    mountSidebar(read(ten));
    syncThreadSidebar({ threadSidebar: true });
    expect(placementOf("chat:c6")).toBe("open");
    expect(rowEl("chat:c6").querySelector("[data-row]")!.hasAttribute("data-cub-thread-current")).toBe(true);

    // Opened, Settled shows it where it is instead.
    settledToggle()!.click();
    expect(placementOf("chat:c6")).toBe("settled");
  });

  it("brings the settled rows into view when opened over a long list", () => {
    const { column } = mountSidebar(read(ten));
    column.style.overflowY = "auto";
    Object.defineProperty(column, "scrollHeight", { value: 2_000 });
    Object.defineProperty(column, "clientHeight", { value: 600 });
    column.getBoundingClientRect = () => new DOMRect(0, 100, 300, 600);
    const scrollBy = vi.fn();
    column.scrollBy = scrollBy as unknown as HTMLElement["scrollBy"];
    syncThreadSidebar({ threadSidebar: true });

    rowEl("chat:c0").getBoundingClientRect = () => new DOMRect(0, 900, 300, 32);
    settledToggle()!.click();
    expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ top: 900 - 100 - 2 }));

    // Already in view: nothing to do.
    settledToggle()!.click();
    rowEl("chat:c0").getBoundingClientRect = () => new DOMRect(0, 300, 300, 32);
    settledToggle()!.click();
    expect(scrollBy).toHaveBeenCalledTimes(1);
  });

  it("paints the Settled bar in the sidebar's own colour", () => {
    const { column } = mountSidebar(read(ten.slice(0, 3)));
    document.querySelector("aside")!.style.backgroundColor = "rgb(31, 30, 29)";
    column.style.backgroundColor = "rgba(255, 255, 255, 0.05)";
    syncThreadSidebar({ threadSidebar: true });
    expect(settledToggle()!.style.getPropertyValue("--cub-thread-bar-bg")).toBe(
      "linear-gradient(rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.05)), rgb(31, 30, 29)",
    );
  });

  it("treats rows in Claude's unread group as live", () => {
    mountSidebar({
      groups: [
        { label: ["label:unread-unread", "Unread"], rows: [{ key: "chat:u1" }] },
        { label: ["label:unread-read", "Read"], rows: ten.slice(0, 4) },
      ],
    });
    syncThreadSidebar({ threadSidebar: true });
    expect(placementOf("chat:u1")).toBe("live");
    expect(whenOf("chat:u1")).toBe("Unread");
    expect(placementOf("label:unread-read")).toBe("label-hidden");
  });

  it("leads with pinned threads, drops pinned projects and Claude's Pinned heading", () => {
    mountSidebar({
      ...read([{ key: "chat:w", status: "running" }, ...ten.slice(0, 5)]),
      pinned: [{ key: "chat:p1", icon: true }, { key: "cowork:cse_p2", icon: true, status: "awaiting" }],
      pinnedProjects: true,
    });
    syncThreadSidebar({ threadSidebar: true });

    expect(placementOf("chat:p1")).toBe("pinned");
    expect(placementOf("cowork:cse_p2")).toBe("pinned");
    expect(rowEl("chat:p1").querySelector(".cub-thread-pin")).not.toBeNull();
    expect(whenOf("cowork:cse_p2")).toMatch(/^Waiting/);
    expect(orderOf("cowork:cse_p2")).toBeLessThan(orderOf("chat:w"));
    expect(placementOf("section:home-projects")).toBe("hidden");
    expect(rowEl("project:p1").hasAttribute("data-cub-thread")).toBe(false);
    const pinnedLabel = document.querySelector('[data-testid="sidebar-pinned"] [data-sidebar-group-label]')!;
    expect(pinnedLabel.hasAttribute("data-cub-thread-hidden")).toBe(true);
    expect(placementOf("chat:w")).toBe("live");
    expect(rowEl("chat:w").hasAttribute("data-cub-thread-first")).toBe(true);
    expect(placementOf("chat:c0")).toBe("settled");
  });

  it("keeps a collapsed Pinned heading so the group can still be opened", () => {
    mountSidebar({ ...read(ten.slice(0, 3)), pinnedCollapsed: true, pinned: [] });
    syncThreadSidebar({ threadSidebar: true });
    const pinnedLabel = document.querySelector('[data-testid="sidebar-pinned"] [data-sidebar-group-label]')!;
    expect(pinnedLabel.hasAttribute("data-cub-thread-hidden")).toBe(false);
  });

  it("folds Claude's nav rows under one toggle and mirrors their status dot", () => {
    const { nav } = mountSidebar({ ...read(ten.slice(0, 3)), scheduledDot: true });
    syncThreadSidebar({ threadSidebar: true });

    expect(nav.getAttribute("data-cub-thread-nav")).toBe("closed");
    expect(nav.firstElementChild).toBe(navToggle());
    expect(navToggle()!.textContent).toBe("Projects & tools");
    expect(navToggle()!.hasAttribute("data-dot")).toBe(true);
    navToggle()!.click();
    expect(nav.getAttribute("data-cub-thread-nav")).toBe("open");
  });

  it("adds a search / sort / new-chat row in place of Claude's New row", () => {
    const { newLink, sidebar } = mountSidebar(read(ten.slice(0, 3)));
    syncThreadSidebar({ threadSidebar: true });

    const top = document.getElementById(TOP_ROW_ID)!;
    expect(top.parentElement!.id).toBe("new-host");
    expect(newLink.hasAttribute("data-cub-thread-hidden")).toBe(true);
    const aside = sidebar.closest("aside")!;
    expect(aside.getAttribute("data-cub-threads-theme")).toBe("dark");

    // No search button on screen: Claude's shortcut opens its search.
    const shortcuts = vi.fn();
    document.addEventListener("keydown", shortcuts);
    top.querySelector<HTMLButtonElement>(".cub-thread-search")!.click();
    expect(shortcuts).toHaveBeenCalledWith(expect.objectContaining({ key: "k", shiftKey: true }));
    document.removeEventListener("keydown", shortcuts);

    // With Claude's own search button showing, that's what gets pressed.
    const headingSearch = document.querySelector<HTMLElement>('[data-sidebar-group-label] [aria-label="Search"]')!;
    headingSearch.getClientRects = () => [new DOMRect(0, 0, 24, 24)] as unknown as DOMRectList;
    const searchClicks = vi.fn();
    headingSearch.addEventListener("click", searchClicks);
    top.querySelector<HTMLButtonElement>(".cub-thread-search")!.click();
    expect(searchClicks).toHaveBeenCalledTimes(1);

    const newClicks = vi.fn((event: Event) => event.preventDefault());
    newLink.addEventListener("click", newClicks);
    top.querySelector<HTMLButtonElement>(".cub-thread-new")!.click();
    expect(newClicks).toHaveBeenCalledTimes(1);

    syncThreadSidebarTheme(true);
    expect(aside.getAttribute("data-cub-threads-theme")).toBe("light");
  });

  it("sits beside Claude's New row, not inside it, and drives its Search row", () => {
    const { newLink } = mountSidebar({ ...read(ten.slice(0, 3)), searchRow: true });
    const before = document.body.innerHTML;
    syncThreadSidebar({ threadSidebar: true });

    const top = document.getElementById(TOP_ROW_ID)!;
    expect(top.parentElement!.id).toBe("new-host");
    expect(newLink.contains(top)).toBe(false);
    expect(newLink.hasAttribute("data-cub-thread-hidden")).toBe(true);
    const searchRow = document.getElementById("search-row")!;
    expect(searchRow.hasAttribute("data-cub-thread-hidden")).toBe(true);

    const searchClicks = vi.fn();
    searchRow.addEventListener("click", searchClicks);
    top.querySelector<HTMLButtonElement>(".cub-thread-search")!.click();
    expect(searchClicks).toHaveBeenCalledTimes(1);

    syncThreadSidebar({ threadSidebar: false });
    expect(document.body.innerHTML).toBe(before);
  });

  it("takes the place of Claude's own search bar when the layout has one", () => {
    mountSidebar({ ...read(ten.slice(0, 3)), claudeSearchBar: true });
    const bar = layOutSearchBar();
    syncThreadSidebar({ threadSidebar: true });

    const top = document.getElementById(TOP_ROW_ID)!;
    expect(top.nextElementSibling).toBe(bar);
    expect(bar.hasAttribute("data-cub-thread-hidden")).toBe(true);
    expect(top.querySelector(".cub-thread-new")).not.toBeNull();
    expect(document.querySelector("aside")!.getAttribute("data-cub-threads-theme")).toBe("dark");
  });

  it("ignores a search control that isn't on screen", () => {
    mountSidebar({ ...read(ten.slice(0, 3)), claudeSearchBar: true });
    syncThreadSidebar({ threadSidebar: true });
    expect(document.getElementById(TOP_ROW_ID)!.parentElement!.id).toBe("new-host");
    expect(document.getElementById("search-host")!.hasAttribute("data-cub-thread-hidden")).toBe(false);
  });

  it("sorts from its own menu", () => {
    mountSidebar(read(ten.slice(0, 3)));
    syncThreadSidebar({ threadSidebar: true });
    const button = document.querySelector<HTMLButtonElement>(".cub-thread-sort-btn")!;
    const menu = document.querySelector<HTMLElement>(".cub-thread-menu")!;
    expect(menu.hidden).toBe(true);

    button.click();
    expect(menu.hidden).toBe(false);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const items = [...menu.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]")];
    expect(items.map((item) => item.textContent)).toEqual(["Newest edited", "Newest created"]);
    expect(items[0].getAttribute("aria-checked")).toBe("true");

    items[1].click();
    expect(menu.hidden).toBe(true);
    expect(items[1].getAttribute("aria-checked")).toBe("true");

    button.click();
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(menu.hidden).toBe(true);
    button.click();
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(menu.hidden).toBe(true);
  });

  it("settles a card by hand from its Settle button, until it has new activity", async () => {
    mountSidebar({ ...read([{ key: "chat:w", status: "running" }, ...ten.slice(0, 4)]), pinned: [{ key: "chat:p1" }] });
    syncThreadSidebar({ threadSidebar: true });
    expect(rowEl("chat:p1").querySelector(".cub-thread-settle")).toBeNull();
    expect(settledToggle()?.textContent).toBe("Settled (4)");

    const settle = rowEl("chat:w").querySelector<HTMLButtonElement>("[data-row] > .cub-thread-settle")!;
    expect(settle.textContent).toBe("Settle");
    settle.click();
    expect(placementOf("chat:w")).toBe("settled");
    expect(settledToggle()?.textContent).toBe("Settled (5)");
    expect(rowEl("chat:w").querySelector(".cub-thread-settle")).toBeNull();

    // Finishing while you're elsewhere is new activity: it comes back, done.
    stopWorking("chat:w");
    await flushObservers();
    expect(placementOf("chat:w")).toBe("live");
    expect(rowEl("chat:w").getAttribute("data-cub-thread-status")).toBe("done");
  });

  it("settles the thread you're on too when asked", () => {
    history.replaceState(null, "", "/chat/c0");
    mountSidebar(read(ten.slice(0, 4)));
    syncThreadSidebar({ threadSidebar: true });
    rowEl("chat:c0").querySelector<HTMLButtonElement>(".cub-thread-settle")!.click();
    expect(placementOf("chat:c0")).toBe("settled");
  });

  it("re-sorts by created or edited times from Claude's own list responses", () => {
    const uuid = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
    mountSidebar(read([0, 1, 2, 3].map((n) => ({ key: `chat:${uuid(n)}` }))));
    syncThreadSidebar({ threadSidebar: true, threadSidebarSort: "created" });
    // Changed after the view started, so all four are open cards.
    const at = Date.now() + 60_000;
    postTimes([
      { id: uuid(0), createdAt: at - 4_000_000, updatedAt: at - 1_000 },
      { id: uuid(1), createdAt: at - 1_000_000, updatedAt: at - 2_000 },
      { id: uuid(2), createdAt: at - 3_000_000, updatedAt: at - 3_000 },
      { id: uuid(3), createdAt: at - 2_000_000, updatedAt: at - 4_000 },
    ]);
    const byOrder = () => [0, 1, 2, 3].sort((a, b) => orderOf(`chat:${uuid(a)}`) - orderOf(`chat:${uuid(b)}`));
    expect(byOrder()).toEqual([1, 3, 2, 0]);

    syncThreadSidebar({ threadSidebar: true, threadSidebarSort: "edited" });
    expect(byOrder()).toEqual([0, 1, 2, 3]);
    expect(whenOf(`chat:${uuid(0)}`)).toMatch(/^\d+(s|m|h|d|w)$/);
  });

  it("ignores malformed probe messages", () => {
    mountSidebar(read(ten.slice(0, 2)));
    syncThreadSidebar({ threadSidebar: true, threadSidebarSort: "created" });
    handleThreadTimesMessage(
      new MessageEvent("message", {
        data: { type: MESSAGE_TYPES.threadTimes, items: [{ id: "c1", createdAt: "soon" }, { id: "<b>", createdAt: NOW }] },
        source: window,
      }),
    );
    handleThreadTimesMessage(new MessageEvent("message", { data: { type: "other", items: [] }, source: window }));
    expect(orderOf("chat:c0")).toBeLessThan(orderOf("chat:c1"));
  });

  it("marks a watched thread done when it stops working unseen, until it's opened", async () => {
    mountSidebar(read([{ key: "chat:w", status: "running" }, ...ten.slice(0, 3)]));
    syncThreadSidebar({ threadSidebar: true });
    expect(whenOf("chat:w")).toMatch(/^Working/);

    stopWorking("chat:w");
    await flushObservers();
    expect(placementOf("chat:w")).toBe("live");
    expect(rowEl("chat:w").getAttribute("data-cub-thread-status")).toBe("done");
    expect(whenOf("chat:w")).toMatch(/^Done/);

    // Opening it in a visible tab clears the mark.
    history.replaceState(null, "", "/chat/w");
    applyThreadSidebar();
    expect(rowEl("chat:w").hasAttribute("data-cub-thread-status")).toBe(false);
    expect(placementOf("chat:w")).toBe("open");
  });

  it("doesn't mark done a thread you were watching finish", async () => {
    history.replaceState(null, "", "/chat/w");
    mountSidebar(read([{ key: "chat:w", status: "running" }, ...ten.slice(0, 3)]));
    syncThreadSidebar({ threadSidebar: true });
    stopWorking("chat:w");
    await flushObservers();
    expect(rowEl("chat:w").hasAttribute("data-cub-thread-status")).toBe(false);
    expect(placementOf("chat:w")).toBe("open");
  });

  it("restores Claude's DOM exactly when turned off", async () => {
    mountSidebar({
      groups: [
        { label: ["label:unread-unread", "Unread"], rows: [{ key: "chat:u1" }] },
        { label: ["label:unread-read", "Read"], rows: [...ten, { key: "chat:w", status: "awaiting" }] },
      ],
      pinned: [{ key: "chat:p1", icon: true }],
      pinnedProjects: true,
      scheduledDot: true,
    });
    history.replaceState(null, "", "/chat/c9");
    const before = document.body.innerHTML;

    syncThreadSidebar({ threadSidebar: true });
    postTimes([{ id: "c4", updatedAt: NOW }]);
    settledToggle()!.click();
    navToggle()!.click();
    syncThreadSidebarTheme(true);
    expect(document.body.innerHTML).not.toBe(before);

    syncThreadSidebar({ threadSidebar: false });
    expect(document.body.innerHTML).toBe(before);

    rowEl("chat:c0").insertAdjacentHTML("beforebegin", rowHtml({ key: "chat:later" }));
    await flushObservers();
    expect(document.querySelector("[data-cub-thread]")).toBeNull();
  });

  it("also restores the DOM when it replaced Claude's own search bar", () => {
    mountSidebar({ ...read([{ key: "chat:c1", status: "running" }, ...ten.slice(2, 4)]), claudeSearchBar: true });
    layOutSearchBar();
    const before = document.body.innerHTML;
    syncThreadSidebar({ threadSidebar: true });
    rowEl("chat:c1").querySelector<HTMLButtonElement>(".cub-thread-settle")!.click();
    document.querySelector<HTMLButtonElement>(".cub-thread-sort-btn")!.click();
    syncThreadSidebar({ threadSidebar: false });
    expect(document.body.innerHTML).toBe(before);
  });

  it("round-trips on → off → on without leftovers", () => {
    mountSidebar({ ...read(ten), pinned: [{ key: "chat:p1" }], pinnedProjects: true });
    syncThreadSidebar({ threadSidebar: true });
    const styled = document.body.innerHTML;
    syncThreadSidebar({ threadSidebar: false });
    syncThreadSidebar({ threadSidebar: true });
    expect(document.body.innerHTML).toBe(styled);
    for (const id of [SETTLED_TOGGLE_ID, NAV_TOGGLE_ID, TOP_ROW_ID]) {
      expect(document.querySelectorAll(`#${id}`)).toHaveLength(1);
    }
  });

  it("follows Claude's DOM: status changes and new rows apply before paint", async () => {
    mountSidebar(read(ten));
    syncThreadSidebar({ threadSidebar: true });

    rowEl("chat:c8").querySelector("[data-row]")!.insertAdjacentHTML(
      "beforeend",
      '<span data-row-decoration=""><span class="status-dot" data-kind="running"></span></span>',
    );
    await flushObservers();
    expect(placementOf("chat:c8")).toBe("live");

    // A chat you start arrives working; a row Claude merely loads stays settled.
    rowEl("chat:c0").insertAdjacentHTML("beforebegin", rowHtml({ key: "chat:fresh", status: "clay" }));
    rowEl("chat:c9").insertAdjacentHTML("afterend", rowHtml({ key: "chat:older" }));
    await flushObservers();
    expect(placementOf("chat:fresh")).toBe("live");
    expect(placementOf("chat:older")).toBe("settled");
  });

  it("stops (without stripping) once a newer content-script instance takes over", async () => {
    let active = true;
    initThreadSidebar(() => active);
    mountSidebar(read(ten));
    syncThreadSidebar({ threadSidebar: true });

    active = false;
    rowEl("chat:c0").insertAdjacentHTML("beforebegin", rowHtml({ key: "chat:after" }));
    await flushObservers();
    expect(rowEl("chat:after").hasAttribute("data-cub-thread")).toBe(false);
    expect(placementOf("chat:c0")).toBe("settled");
  });

  it("is a no-op when the page has no sidebar", () => {
    document.body.innerHTML = "<main></main>";
    syncThreadSidebar({ threadSidebar: true });
    applyThreadSidebar();
    expect(document.body.innerHTML).toBe("<main></main>");
  });
});

describe("shared state", () => {
  const session: Record<string, unknown> = {};
  const local: Record<string, unknown> = {};
  const area = (store: Record<string, unknown>) => ({
    get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
    set: async (items: Record<string, unknown>) => Object.assign(store, items),
    remove: async (key: string) => {
      delete store[key];
    },
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    for (const store of [session, local]) for (const key of Object.keys(store)) delete store[key];
    vi.stubGlobal("chrome", {
      runtime: { id: "test", sendMessage: vi.fn(), lastError: undefined },
      storage: {
        session: area(session),
        local: area(local),
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    });
  });

  it("shares the done mark across tabs through session storage", async () => {
    mountSidebar(read([{ key: "chat:w", status: "running" }, ...ten.slice(0, 2)]));
    syncThreadSidebar({ threadSidebar: true });
    stopWorking("chat:w");
    await flushObservers();
    const stored = session[STORAGE_KEYS.threadActivity] as Record<string, { doneAt?: number }>;
    expect(typeof stored["chat:w"]?.doneAt).toBe("number");
  });

  it("picks up a done mark another tab recorded", async () => {
    session[STORAGE_KEYS.threadActivity] = { "chat:w": { workingSince: Date.now() - 60_000 } };
    mountSidebar(read([{ key: "chat:w" }]));
    syncThreadSidebar({ threadSidebar: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rowEl("chat:w").getAttribute("data-cub-thread-status")).toBe("done");
  });

  it("starts from everything settled the first time, and forgets it all when turned off", async () => {
    mountSidebar(read([{ key: "chat:w", status: "running" }, ...ten.slice(0, 3)]));
    const before = Date.now();
    syncThreadSidebar({ threadSidebar: true });
    await settle();
    const stored = local[STORAGE_KEYS.threadPlaces] as { since: number; open: Record<string, number> };
    expect(stored.since).toBeGreaterThanOrEqual(before);
    expect(Object.keys(stored.open)).toEqual(["chat:w"]);
    expect(placementOf("chat:c0")).toBe("settled");

    syncThreadSidebar({ threadSidebar: false });
    await settle();
    expect(local).not.toHaveProperty(STORAGE_KEYS.threadPlaces);
  });

  it("keeps open and hand-settled threads in local storage, ids and times only", async () => {
    const since = Date.now() - 60 * 60_000;
    local[STORAGE_KEYS.threadPlaces] = { since, open: { "chat:c4": since + 1_000, "<bad>": since + 1 }, settled: {} };
    mountSidebar(read(ten.slice(0, 6)));
    syncThreadSidebar({ threadSidebar: true });
    await settle();
    expect(placementOf("chat:c4")).toBe("open");
    expect(placementOf("chat:c0")).toBe("settled");

    rowEl("chat:c4").querySelector<HTMLButtonElement>(".cub-thread-settle")!.click();
    expect(placementOf("chat:c4")).toBe("settled");
    const stored = local[STORAGE_KEYS.threadPlaces] as Record<string, Record<string, number> | number>;
    expect(stored.since).toBe(since);
    expect(stored.open).toEqual({});
    expect(Object.keys(stored.settled)).toEqual(["chat:c4"]);
    expect(Object.values(stored.settled).every((value) => typeof value === "number")).toBe(true);
  });

  it("opens threads that changed since, even on another device while the tab was shut", async () => {
    const uuid = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
    const since = Date.now() - 60 * 60_000;
    local[STORAGE_KEYS.threadPlaces] = { since, open: {}, settled: { [`chat:${uuid(2)}`]: since + 30 * 60_000 } };
    mountSidebar(read([0, 1, 2].map((n) => ({ key: `chat:${uuid(n)}` }))));
    syncThreadSidebar({ threadSidebar: true });
    await settle();
    postTimes([
      { id: uuid(0), updatedAt: since + 10 * 60_000 },
      { id: uuid(1), updatedAt: since - 10 * 60_000 },
      // Settled by hand after its last change: stays settled.
      { id: uuid(2), updatedAt: since + 20 * 60_000 },
    ]);
    expect(placementOf(`chat:${uuid(0)}`)).toBe("open");
    expect(placementOf(`chat:${uuid(1)}`)).toBe("settled");
    expect(placementOf(`chat:${uuid(2)}`)).toBe("settled");
  });
});
