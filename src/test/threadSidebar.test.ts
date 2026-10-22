import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyThreadSidebar,
  initThreadSidebar,
  NAV_TOGGLE_ID,
  placeThreadRows,
  readRowStatus,
  resetThreadSidebarForTests,
  SETTLED_TOGGLE_ID,
  syncThreadSidebar,
  threadKindOf,
  threadMetaText,
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
}

// Mirrors the structure of claude.ai's sidebar rows (data-row-key wrapper →
// [data-row] → main button + trailing decoration + hover actions).
const rowHtml = ({ key, status, unreadMark, current, icon }: RowSpec): string => {
  const id = key.slice(key.indexOf(":") + 1);
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
      <div><button type="button" aria-label="Search"></button></div>
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
        <div class="shrink-0"><a href="/new" data-row="" data-row-main-button="">New</a></div>
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
    column: document.getElementById("nav-scroll")!,
    recents: document.querySelector<HTMLElement>('[data-testid="sidebar-recents"]')!,
    nav: document.querySelector<HTMLElement>('[data-testid="nav-pin-rows"]')!,
  };
};

const read = (rows: RowSpec[]): SidebarSpec => ({ groups: [{ label: ["label:unread-read", "Read"], rows }] });
const rowEl = (key: string): HTMLElement => document.querySelector<HTMLElement>(`[data-row-key="${key}"]`)!;
const placementOf = (key: string): string | null => rowEl(key).getAttribute("data-cub-thread");
const metaOf = (key: string): string | null =>
  rowEl(key).querySelector("[data-row-label]")!.getAttribute("data-cub-thread-meta");
const settledToggle = (): HTMLButtonElement | null =>
  document.getElementById(SETTLED_TOGGLE_ID) as HTMLButtonElement | null;
const navToggle = (): HTMLButtonElement | null => document.getElementById(NAV_TOGGLE_ID) as HTMLButtonElement | null;
const flushObservers = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const ten = Array.from({ length: 10 }, (_, i) => ({ key: `chat:c${i}` }));

beforeEach(() => {
  history.replaceState(null, "", "/new");
});

afterEach(() => {
  resetThreadSidebarForTests();
  document.body.innerHTML = "";
});

describe("placeThreadRows", () => {
  const row = (partial: Partial<ThreadRowInfo> = {}): ThreadRowInfo => ({
    label: false,
    status: null,
    current: false,
    ...partial,
  });

  it("cards live threads wherever they sit, then the first N recent ones", () => {
    const rows = [row(), row(), row(), row({ status: "working" }), row(), row()];
    expect(placeThreadRows(rows, 2)).toEqual(["recent", "recent", "settled", "live", "settled", "settled"]);
  });

  it("never folds the open thread away", () => {
    const rows = [row(), row(), row(), row({ current: true })];
    expect(placeThreadRows(rows, 1)).toEqual(["recent", "settled", "settled", "recent"]);
  });

  it("keeps only the first group label", () => {
    const rows = [row({ label: true }), row(), row({ label: true }), row()];
    expect(placeThreadRows(rows, 5)).toEqual(["label", "recent", "label-hidden", "recent"]);
  });

  it("settles everything that isn't live when no recent cards are wanted", () => {
    expect(placeThreadRows([row(), row({ status: "unread" })], 0)).toEqual(["settled", "live"]);
  });

  it("keeps pinned threads out of the recent count and hides pinned projects", () => {
    const rows = [row({ hidden: true }), row({ pinned: true }), row({ pinned: true, status: "working" }), row(), row()];
    expect(placeThreadRows(rows, 1)).toEqual(["hidden", "pinned", "pinned", "recent", "settled"]);
  });
});

describe("row status", () => {
  it("maps Claude's status dots onto thread states", () => {
    for (const [kind, expected] of [
      ["running", "working"],
      ["clay", "working"],
      ["awaiting", "awaiting"],
      ["error", "error"],
      ["ready", "ready"],
      ["unread", "unread"],
    ] as const) {
      mountSidebar(read([{ key: "chat:a", status: kind }]));
      expect(readRowStatus(rowEl("chat:a"))).toBe(expected);
    }
  });

  it("ignores decorations that aren't status dots", () => {
    mountSidebar(read([{ key: "chat:a" }]));
    rowEl("chat:a").querySelector("[data-row]")!.insertAdjacentHTML(
      "beforeend",
      '<span data-row-decoration=""><span role="img" aria-label="Includes a document"></span></span>',
    );
    expect(readRowStatus(rowEl("chat:a"))).toBeNull();
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
    expect(threadMetaText("chat", "working", false)).toBe("Chat · Working");
    expect(threadMetaText("cowork", null, true)).toBe("Cowork · Open");
    expect(threadMetaText("chat", null, false)).toBe("Chat");
    expect(threadMetaText("chat", "awaiting", false, true)).toBe("Chat · Pinned · Needs input");
  });
});

describe("thread sidebar DOM", () => {
  it("does nothing while the option is off", () => {
    const { column } = mountSidebar({ ...read(ten), pinned: [{ key: "chat:p" }], pinnedProjects: true });
    const before = document.body.innerHTML;
    syncThreadSidebar({ threadSidebar: false, threadSidebarRecentCount: 3 });
    expect(document.body.innerHTML).toBe(before);
    expect(column.hasAttribute("data-cub-threads")).toBe(false);
  });

  it("cards recent threads and folds the rest under Settled", () => {
    const { column, recents } = mountSidebar(read(ten));
    syncThreadSidebar({ threadSidebar: true, threadSidebarRecentCount: 3 });

    // The scroll column is the flex container; the wrappers above the list
    // and the list itself are flattened into it.
    expect(column.getAttribute("data-cub-threads")).toBe("on");
    expect(column.getAttribute("data-cub-threads-settled")).toBe("closed");
    expect(recents.hasAttribute("data-cub-thread-flat")).toBe(true);
    expect(document.querySelector('[data-first-paint-hold]')!.hasAttribute("data-cub-thread-flat")).toBe(true);

    expect(placementOf("label:unread-read")).toBe("label");
    expect(["c0", "c1", "c2"].map((id) => placementOf(`chat:${id}`))).toEqual(["recent", "recent", "recent"]);
    expect(placementOf("chat:c3")).toBe("settled");
    expect(rowEl("chat:c0").querySelector("[data-row]")!.hasAttribute("data-cub-thread-card")).toBe(true);
    expect(rowEl("chat:c3").querySelector("[data-row]")!.hasAttribute("data-cub-thread-card")).toBe(false);
    expect(metaOf("chat:c0")).toBe("Chat");
    expect(document.querySelector("[data-group-name]")!.getAttribute("data-cub-thread-label")).toBe("Threads");

    expect(settledToggle()?.parentElement).toBe(recents);
    expect(settledToggle()?.textContent).toBe("Settled (7)");
    expect(settledToggle()?.getAttribute("aria-expanded")).toBe("false");
  });

  it("expands and collapses the settled threads", () => {
    const { column } = mountSidebar(read(ten));
    syncThreadSidebar({ threadSidebar: true, threadSidebarRecentCount: 3 });

    settledToggle()!.click();
    expect(column.getAttribute("data-cub-threads-settled")).toBe("open");
    expect(settledToggle()!.getAttribute("aria-expanded")).toBe("true");
    settledToggle()!.click();
    expect(column.getAttribute("data-cub-threads-settled")).toBe("closed");
  });

  it("puts a working thread on top and separates it from the recent cards", () => {
    mountSidebar(read([...ten.slice(0, 6), { key: "cowork:cse_w", status: "running" }, ...ten.slice(6)]));
    syncThreadSidebar({ threadSidebar: true, threadSidebarRecentCount: 2 });

    expect(placementOf("cowork:cse_w")).toBe("live");
    expect(rowEl("cowork:cse_w").getAttribute("data-cub-thread-status")).toBe("working");
    expect(metaOf("cowork:cse_w")).toBe("Cowork · Working");
    expect(rowEl("cowork:cse_w").hasAttribute("data-cub-thread-first")).toBe(false);
    expect(rowEl("chat:c0").hasAttribute("data-cub-thread-first")).toBe(true);
    expect(rowEl("chat:c1").hasAttribute("data-cub-thread-first")).toBe(false);
    expect(settledToggle()?.textContent).toBe("Settled (8)");
  });

  it("treats rows in Claude's unread group as live", () => {
    mountSidebar({
      groups: [
        { label: ["label:unread-unread", "Unread"], rows: [{ key: "chat:u1" }] },
        { label: ["label:unread-read", "Read"], rows: ten.slice(0, 4) },
      ],
    });
    syncThreadSidebar({ threadSidebar: true, threadSidebarRecentCount: 1 });

    expect(placementOf("chat:u1")).toBe("live");
    expect(rowEl("chat:u1").getAttribute("data-cub-thread-status")).toBe("unread");
    expect(placementOf("label:unread-unread")).toBe("label");
    expect(placementOf("label:unread-read")).toBe("label-hidden");
  });

  it("leads with pinned threads, drops pinned projects and Claude's Pinned heading", () => {
    mountSidebar({
      ...read(ten.slice(0, 5)),
      pinned: [{ key: "chat:p1", icon: true }, { key: "cowork:cse_p2", icon: true, status: "awaiting" }],
      pinnedProjects: true,
    });
    syncThreadSidebar({ threadSidebar: true, threadSidebarRecentCount: 2 });

    expect(placementOf("chat:p1")).toBe("pinned");
    expect(placementOf("cowork:cse_p2")).toBe("pinned");
    expect(metaOf("chat:p1")).toBe("Chat · Pinned");
    expect(metaOf("cowork:cse_p2")).toBe("Cowork · Pinned · Needs input");
    expect(rowEl("chat:p1").querySelector("[data-row]")!.hasAttribute("data-cub-thread-card")).toBe(true);

    // Projects stay under Projects, not in the thread list.
    expect(placementOf("section:home-projects")).toBe("hidden");
    expect(rowEl("project:p1").hasAttribute("data-cub-thread")).toBe(false);
    const pinnedLabel = document.querySelector('[data-testid="sidebar-pinned"] [data-sidebar-group-label]')!;
    expect(pinnedLabel.hasAttribute("data-cub-thread-hidden")).toBe(true);

    // Pinned threads don't use up recent cards, and a divider follows them.
    expect(["c0", "c1"].map((id) => placementOf(`chat:${id}`))).toEqual(["recent", "recent"]);
    expect(placementOf("chat:c2")).toBe("settled");
    expect(rowEl("chat:c0").hasAttribute("data-cub-thread-first")).toBe(true);
    expect(rowEl("chat:p1").hasAttribute("data-cub-thread-first")).toBe(false);
    expect(document.querySelector('[data-testid="sidebar-pinned"]')!.hasAttribute("data-cub-thread-flat")).toBe(true);
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
    expect(navToggle()!.getAttribute("aria-expanded")).toBe("false");
    expect(navToggle()!.hasAttribute("data-cub-thread-nav-dot")).toBe(true);

    navToggle()!.click();
    expect(nav.getAttribute("data-cub-thread-nav")).toBe("open");
    expect(navToggle()!.getAttribute("aria-expanded")).toBe("true");
  });

  it("follows Claude's DOM: status changes and new rows apply before paint", async () => {
    mountSidebar(read(ten));
    syncThreadSidebar({ threadSidebar: true, threadSidebarRecentCount: 3 });

    rowEl("chat:c8").querySelector("[data-row]")!.insertAdjacentHTML(
      "beforeend",
      '<span data-row-decoration=""><span class="status-dot" data-kind="running"></span></span>',
    );
    await flushObservers();
    expect(placementOf("chat:c8")).toBe("live");

    rowEl("chat:c0").insertAdjacentHTML("beforebegin", rowHtml({ key: "chat:fresh" }));
    await flushObservers();
    expect(placementOf("chat:fresh")).toBe("recent");
    expect(placementOf("chat:c2")).toBe("settled");
  });

  it("re-adds the nav toggle when Claude re-renders the nav rows", async () => {
    const { nav } = mountSidebar(read(ten.slice(0, 2)));
    syncThreadSidebar({ threadSidebar: true });
    const fresh = nav.cloneNode(false) as HTMLElement;
    fresh.innerHTML = '<div data-row=""><a href="/artifacts" data-row-main-button="">Artifacts</a></div>';
    nav.replaceWith(fresh);
    await flushObservers();
    expect(fresh.firstElementChild).toBe(navToggle());
    expect(document.querySelectorAll(`#${NAV_TOGGLE_ID}`)).toHaveLength(1);
  });

  it("keeps the open thread visible and highlighted", () => {
    mountSidebar(read(ten));
    history.replaceState(null, "", "/chat/c7");
    syncThreadSidebar({ threadSidebar: true, threadSidebarRecentCount: 3 });

    expect(placementOf("chat:c7")).toBe("recent");
    expect(rowEl("chat:c7").querySelector("[data-row]")!.hasAttribute("data-cub-thread-current")).toBe(true);
    expect(metaOf("chat:c7")).toBe("Chat · Open");
  });

  it("re-places rows when the recent count changes", () => {
    mountSidebar(read(ten));
    syncThreadSidebar({ threadSidebar: true, threadSidebarRecentCount: 3 });
    syncThreadSidebar({ threadSidebar: true, threadSidebarRecentCount: 8 });
    expect(placementOf("chat:c7")).toBe("recent");
    expect(settledToggle()?.textContent).toBe("Settled (2)");

    syncThreadSidebar({ threadSidebar: true, threadSidebarRecentCount: 12 });
    expect(settledToggle()).toBeNull();
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

    syncThreadSidebar({ threadSidebar: true, threadSidebarRecentCount: 3 });
    settledToggle()!.click();
    navToggle()!.click();
    expect(document.body.innerHTML).not.toBe(before);

    syncThreadSidebar({ threadSidebar: false, threadSidebarRecentCount: 3 });
    expect(document.body.innerHTML).toBe(before);

    // And stays off: later sidebar mutations are no longer styled.
    rowEl("chat:c0").insertAdjacentHTML("beforebegin", rowHtml({ key: "chat:later" }));
    await flushObservers();
    expect(document.querySelector("[data-cub-thread]")).toBeNull();
    expect(navToggle()).toBeNull();
  });

  it("round-trips on → off → on without leftovers", () => {
    mountSidebar({ ...read(ten), pinned: [{ key: "chat:p1" }], pinnedProjects: true });
    syncThreadSidebar({ threadSidebar: true, threadSidebarRecentCount: 3 });
    const styled = document.body.innerHTML;
    syncThreadSidebar({ threadSidebar: false });
    syncThreadSidebar({ threadSidebar: true, threadSidebarRecentCount: 3 });
    expect(document.body.innerHTML).toBe(styled);
    expect(document.querySelectorAll(`#${SETTLED_TOGGLE_ID}`)).toHaveLength(1);
    expect(document.querySelectorAll(`#${NAV_TOGGLE_ID}`)).toHaveLength(1);
  });

  it("stops (without stripping) once a newer content-script instance takes over", async () => {
    let active = true;
    initThreadSidebar(() => active);
    mountSidebar(read(ten));
    syncThreadSidebar({ threadSidebar: true, threadSidebarRecentCount: 3 });

    active = false;
    rowEl("chat:c0").insertAdjacentHTML("beforebegin", rowHtml({ key: "chat:after" }));
    await flushObservers();
    expect(rowEl("chat:after").hasAttribute("data-cub-thread")).toBe(false);
    expect(placementOf("chat:c0")).toBe("recent");
  });

  it("is a no-op when the page has no sidebar", () => {
    document.body.innerHTML = "<main></main>";
    syncThreadSidebar({ threadSidebar: true });
    applyThreadSidebar();
    expect(document.body.innerHTML).toBe("<main></main>");
  });
});
