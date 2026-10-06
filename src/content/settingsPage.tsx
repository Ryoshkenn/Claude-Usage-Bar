import React, { useEffect, useId, useState } from "react";
import { createRoot } from "react-dom/client";
import { clearWeeklyUsageMetrics, DEFAULT_SETTINGS, getStorage, updateSettings } from "../shared/storage";
import { SUPPORTED_LANGUAGES, setLanguage, t } from "../shared/i18n";
import { MESSAGE_TYPES } from "../shared/constants";
import type {
  ContextDisplay,
  MetricTarget,
  PaceSurplusFormat,
  ResetBannerScope,
  Settings,
  WeeklyEstimateDisplay,
  WeeklyPaceMode,
  WeeklyUsageMetrics,
} from "../shared/types";

const CWS_URL =
  "https://chromewebstore.google.com/detail/claude-usage-bar/eiddfcnlmiebkbnaopcgambdbnlangai";
const GITHUB_URL = "https://github.com/Ryoshkenn/Claude-Usage-Bar";
const PRIVACY_POLICY_URL = "https://sites.google.com/view/claude-usage-bar-privacy/home";

// Claude's design-system class strings, copied exactly from the DOM
const CDS_SECTION_HEADER = "mb-md flex items-start justify-between gap-lg";
const CDS_SECTION_TITLE_WRAP = "flex min-w-0 flex-col gap-1";
const CDS_SECTION_TITLE = "text-heading-semibold text-primary";
const CDS_ROWS =
  "divide-y divide-alpha-1 [&>[data-cds=DataTable]]:!border-t-0 [&>[data-cds=DataTable]+*]:!border-t-0 [&>[data-cds=Banner]]:!border-t-0 [&>[data-cds=Banner]+*]:!border-t-0 [&>[role=treegrid]]:!border-t-0 [&>[role=treegrid]+*]:!border-t-0 [&>[data-settings-nest]]:!border-t-0 [&>[data-settings-nest]+*]:!border-t-0 [&>:not([role=group]):not([data-cds=DataTable]):not([role=treegrid])]:py-md";
const CDS_ROW = "flex items-center justify-between gap-lg py-md";
const CDS_ROW_LABEL_WRAP = "flex min-w-0 flex-1 flex-col justify-center gap-1";
const CDS_ROW_LABEL = "text-body text-primary";
const CDS_ROW_DESC = "text-body text-muted";
const CDS_ROW_CONTROL_WRAP = "flex shrink-0 items-center";
const CDS_BUTTON =
  "cds-reset group/btn relative isolate inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap select-none border-0 outline-none rounded h-control font-sans text-body [&:disabled:not([aria-busy])]:opacity-50 disabled:pointer-events-none transition-shadow duration-fast focus-visible:shadow-focus text-primary aria-pressed:text-accent px-md";
const CDS_BUTTON_BG =
  "absolute -z-[1] rounded-[inherit] transition-colors duration-fast group-focus-visible/btn:shadow-[inset_0_0_0_1px_var(--cds-page-bg)] bg-fill-secondary group-hover/btn:bg-fill-secondary-hover group-aria-expanded/btn:bg-fill-secondary-hover inset-0 group-aria-pressed/btn:bg-accent group-hover/btn:group-aria-pressed/btn:bg-accent cds-btn-squish shadow-field";
const CDS_COMBOBOX_WRAP =
  "cds-reset group/cbx inline-flex items-center gap-1.5 h-control rounded font-sans text-body text-primary outline-none transition duration-fast data-[disabled]:opacity-50 data-[disabled]:pointer-events-none bg-transparent hover:bg-fill-ghost-hover pl-0 has-[:focus-visible]:shadow-focus data-[disabled]:cursor-default pr-sm shrink-0 relative";
const CDS_COMBOBOX_BTN =
  "cds-reset flex min-w-0 flex-1 items-center gap-1.5 self-stretch pl-sm text-left border-0 bg-transparent p-0 outline-none pointer-events-none";
const CDS_COMBOBOX_ICON =
  "mr-0.5 shrink-0 text-muted transition-colors group-hover/cbx:text-secondary";

// ── DOM helpers ──────────────────────────────────────────────────────────────

// Claude's new settings nav uses <li><button> items whose label lives in a
// truncating span (e.g. "General", "Usage"). The buttons have no href, so we
// locate them by their visible label text.
const NAV_LABEL_SELECTOR = "span.min-w-0.flex-1.truncate";

const findNavButtonByLabel = (label: string): HTMLButtonElement | null => {
  for (const span of document.querySelectorAll<HTMLSpanElement>(
    `li > button > ${NAV_LABEL_SELECTOR}`,
  )) {
    if (span.textContent?.trim() === label) return span.closest("button");
  }
  return null;
};

const findSettingsNav = (): HTMLUListElement | null =>
  findNavButtonByLabel("General")?.closest("ul") ?? null;

// The new settings overlay's scrollable content region styles its sections via
// [data-settings-section] arbitrary variants (e.g. "[&_[data-settings-section]]:gap-4").
// That class signature lives only on this one container; child sections carry
// `data-settings-section` as an attribute, not a class, so they won't match.
const OVERLAY_CONTAINER_SELECTOR = '[class*="data-settings-section"]';

const findSectionsContainer = (): HTMLElement | null =>
  document.querySelector<HTMLElement>(OVERLAY_CONTAINER_SELECTOR);

// The settings overlay is a modal: its visible presence is the only reliable
// "is the settings UI open" signal, since it opens without a URL change. We
// check visibility (offsetParent), not mere DOM presence — if Claude closes the
// modal by hiding it in place rather than removing it, a presence-only check
// would leave panelActive stuck and show a stale panel on the next open.
export const isSettingsOverlayOpen = (): boolean => {
  const container = findSectionsContainer();
  // getClientRects() is empty when the element (or an ancestor) is display:none
  // or detached, and — unlike offsetParent — stays truthy for position:fixed
  // modals that are actually visible.
  return !!container && container.getClientRects().length > 0;
};

// Open/close the overlay via Claude's own app-level shortcut (⇧⌘, on mac,
// ⇧⌃, elsewhere) and Escape. These are synthetic keydowns dispatched on
// document; Claude's global keydown handler doesn't check isTrusted, so they
// drive the real overlay without us needing the avatar/menu selectors.
const isMacPlatform = (): boolean =>
  /Mac|iPhone|iPad|iPod/.test(navigator.platform) || /Mac OS X/.test(navigator.userAgent);

export const openSettingsOverlay = (): void => {
  if (isSettingsOverlayOpen()) return;
  const mac = isMacPlatform();
  document.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: ",",
      code: "Comma",
      keyCode: 188,
      which: 188,
      shiftKey: true,
      metaKey: mac,
      ctrlKey: !mac,
      bubbles: true,
      cancelable: true,
    }),
  );
};

export const closeSettingsOverlay = (): void => {
  if (!isSettingsOverlayOpen()) return;
  document.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      keyCode: 27,
      which: 27,
      bubbles: true,
      cancelable: true,
    }),
  );
};

// ── Nav injection ────────────────────────────────────────────────────────────

let navLi: HTMLLIElement | null = null;

// Whether our settings panel is the active section inside the overlay. Driven
// by clicks (our nav item activates it; any other nav item deactivates it) —
// never by the URL, so we never navigate to a fake /settings route that would
// expose Claude's old settings page behind the overlay.
let panelActive = false;

// Claude's nav-button class strings, copied exactly from the DOM. The base set
// is shared by every item; the active/inactive sets toggle per current route.
const NAV_BTN_BASE =
  "flex h-control w-full cursor-pointer items-center gap-sm rounded px-sm text-left text-body transition-colors";
const NAV_BTN_INACTIVE = "text-secondary hover:bg-fill-ghost-hover hover:text-primary";
const NAV_BTN_ACTIVE = "bg-alpha-2 font-medium text-primary";

const buildNavIcon = (): HTMLSpanElement => {
  const icon = document.createElement("span");
  icon.setAttribute("data-cds", "Icon");
  icon.className = "shrink-0 text-secondary";
  icon.setAttribute("aria-hidden", "true");
  // Match the 1em / 20px box Claude's Anthropicons glyphs occupy so our row
  // aligns with the others; render a small bar-meter SVG inside it.
  icon.style.cssText =
    "width:1em;height:1em;font-size:20px;display:flex;align-items:center;justify-content:center;flex-shrink:0;";
  icon.innerHTML =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="20" x2="4" y2="14"/><line x1="10" y1="20" x2="10" y2="9"/><line x1="16" y1="20" x2="16" y2="13"/><line x1="22" y1="20" x2="22" y2="5"/></svg>';
  return icon;
};

const injectNavItem = () => {
  const ul = findSettingsNav();
  if (!ul) return;
  const existing = ul.querySelector<HTMLElement>("[data-cub-nav]");
  if (existing) {
    navLi = existing.closest("li");
    updateNavActiveState();
    return;
  }

  const li = document.createElement("li");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.setAttribute("data-cub-nav", "");
  btn.className = `${NAV_BTN_BASE} ${NAV_BTN_INACTIVE}`;

  const text = document.createElement("span");
  text.className = "min-w-0 flex-1 truncate";
  text.textContent = "Usage Bar";

  btn.append(buildNavIcon(), text);

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    activatePanel();
  });

  li.appendChild(btn);

  // Insert directly after General (2nd position, above Account)
  const generalLi = findNavButtonByLabel("General")?.closest("li");
  if (generalLi?.nextSibling) {
    ul.insertBefore(li, generalLi.nextSibling);
  } else {
    ul.appendChild(li);
  }
  navLi = li;
  updateNavActiveState();
};

const updateNavActiveState = () => {
  const btn = navLi?.querySelector<HTMLElement>("[data-cub-nav]");
  if (!btn) return;
  const isActive = panelActive;
  if (isActive) {
    btn.classList.remove(...NAV_BTN_INACTIVE.split(" "));
    btn.classList.add(...NAV_BTN_ACTIVE.split(" "));
    btn.setAttribute("aria-current", "page");
  } else {
    btn.classList.remove(...NAV_BTN_ACTIVE.split(" "));
    btn.classList.add(...NAV_BTN_INACTIVE.split(" "));
    btn.removeAttribute("aria-current");
  }
};

// ── Panel mounting ───────────────────────────────────────────────────────────

let panelRoot: ReturnType<typeof createRoot> | null = null;
let panelEl: HTMLDivElement | null = null;
const hiddenChildren: HTMLElement[] = [];

const mountPanel = () => {
  if (panelEl) return;

  const container = findSectionsContainer();
  if (!container) return;

  // Hide all existing children (Claude's sections + any "not found" text)
  for (const child of Array.from(container.children)) {
    const el = child as HTMLElement;
    if (el.style.display !== "none") {
      el.style.display = "none";
      hiddenChildren.push(el);
    }
  }

  panelEl = document.createElement("div");
  panelEl.id = "cub-settings-panel";
  // Claude scopes its component design tokens (--cds-switch-track/-knob/-h, etc.)
  // to the `.cds-root` class, not :root. Our panel mounts outside that subtree,
  // so without this class those vars are empty and the Switch knob/track render
  // blank (the switch collapses to a solid accent pill). `cds-root` self-themes
  // the panel; it only adds font-smoothing + the token defs, no layout box.
  panelEl.className = "cds-root";
  container.appendChild(panelEl);

  panelRoot = createRoot(panelEl);
  panelRoot.render(
    <React.StrictMode>
      <SettingsPage />
    </React.StrictMode>,
  );
};

const unmountPanel = () => {
  if (!panelEl) return;

  panelRoot?.unmount();
  panelRoot = null;
  panelEl.remove();
  panelEl = null;

  for (const el of hiddenChildren) {
    el.style.display = "";
  }
  hiddenChildren.length = 0;
};

// Reset panel refs without restoring hidden siblings — used when the overlay
// itself is gone (its DOM, including our panel and the sections we hid, has
// already been removed), so there is nothing to restore.
const teardownPanel = () => {
  if (!panelEl) return;
  panelRoot?.unmount();
  panelRoot = null;
  panelEl.remove();
  panelEl = null;
  hiddenChildren.length = 0;
};

// Hide any sibling sections Claude (re)injected into the container while our
// panel is the active section (e.g. a "not found" block or a re-rendered list).
const hideStrayChildren = () => {
  const container = panelEl?.parentElement;
  if (!container) return;
  for (const child of Array.from(container.children)) {
    const el = child as HTMLElement;
    if (el !== panelEl && el.style.display !== "none") {
      el.style.display = "none";
      hiddenChildren.push(el);
    }
  }
};

const activatePanel = () => {
  panelActive = true;
  mountPanel();
  updateNavActiveState();
};

const deactivatePanel = () => {
  panelActive = false;
  unmountPanel();
  updateNavActiveState();
};

// Single source of truth, run by the MutationObserver and the refresh tick.
const syncSettingsPanel = () => {
  if (!isSettingsOverlayOpen()) {
    // Overlay closed/dismissed — its DOM is gone. Drop all refs so reopening
    // starts clean (panel inactive, nav re-injected fresh).
    teardownPanel();
    panelActive = false;
    navLi = null;
    return;
  }

  if (!navLi || !document.contains(navLi)) {
    navLi = null;
    injectNavItem();
  }
  updateNavActiveState();

  if (panelActive) {
    if (!panelEl || !document.contains(panelEl)) {
      teardownPanel();
      mountPanel();
    } else {
      hideStrayChildren();
    }
  } else if (panelEl) {
    unmountPanel();
  }
};

// ── React components matching Claude's CDS design system ─────────────────────

// Styled inline rather than via Claude's CDS classes: those depend on
// `--cds-switch-*` vars scoped to `.cds-root`, which our injected panel sits
// outside of, so the knob/track render blank. Inline colors match the file's
// existing work-day-button pattern. Track: accent (on) / translucent grey (off);
// knob: always white. `--cds-switch-track` is kept as the off-track value so it
// themes when in scope, with a grey fallback when it isn't.
const Switch = ({
  checked,
  onChange,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  id: string;
}) => (
  <button
    type="button"
    tabIndex={0}
    id={id}
    role="switch"
    aria-checked={checked}
    data-cds="Switch"
    className="cds-reset relative inline-flex shrink-0 cursor-pointer items-center rounded-full border-0 outline-none transition-colors focus-visible:shadow-focus"
    style={{
      height: "16px",
      width: "28px",
      padding: "2px",
      background: checked ? "rgb(204 124 94)" : "var(--cds-switch-track, rgb(255 255 255 / 22%))",
    }}
    onClick={() => onChange(!checked)}
  >
    <span
      className="block rounded-full shadow-sm transition-transform"
      style={{
        height: "12px",
        width: "12px",
        background: "#fff",
        transform: checked ? "translateX(12px)" : "translateX(0)",
      }}
    />
  </button>
);

// Combobox: Claude's dropdown visual with a transparent native <select> overlaid for interaction
const CdsSelect = ({
  id,
  value,
  onChange,
  options,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) => {
  const currentLabel = options.find((o) => o.value === value)?.label ?? value;
  return (
    <div className={CDS_COMBOBOX_WRAP}>
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        className={CDS_COMBOBOX_BTN}
      >
        <span className="min-w-0 flex-1 truncate">{currentLabel}</span>
        <svg
          className={CDS_COMBOBOX_ICON}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        className="absolute inset-0 w-full opacity-0 cursor-pointer"
        aria-label={currentLabel}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
};

const CdsButton = ({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button type="button" data-cds="Button" className={CDS_BUTTON} onClick={onClick}>
    <span aria-hidden="true" className={CDS_BUTTON_BG} />
    <span className="inline-flex items-center gap-1">{children}</span>
  </button>
);

interface RowProps {
  labelId: string;
  descId?: string;
  label: string;
  description?: string;
  children: React.ReactNode;
  // Stable id for a single row, used as a compact onboarding-tour spotlight
  // target (the dynamic labelId from useId() isn't a reliable selector).
  rowId?: string;
}

const Row = ({ labelId, descId, label, description, children, rowId }: RowProps) => (
  <div
    id={rowId}
    role="group"
    aria-labelledby={labelId}
    aria-describedby={descId}
    className={CDS_ROW}
  >
    <div className={CDS_ROW_LABEL_WRAP}>
      <div id={labelId} className={CDS_ROW_LABEL}>
        {label}
      </div>
      {description && (
        <div id={descId} className={CDS_ROW_DESC}>
          {description}
        </div>
      )}
    </div>
    <div className={CDS_ROW_CONTROL_WRAP}>{children}</div>
  </div>
);

interface SectionProps {
  title: string;
  children: React.ReactNode;
  id?: string;
}

const Section = ({ title, children, id }: SectionProps) => (
  <section id={id} className="mb-xl last:mb-0">
    <div className={CDS_SECTION_HEADER}>
      <div className={CDS_SECTION_TITLE_WRAP}>
        <h3 className={CDS_SECTION_TITLE}>{title}</h3>
      </div>
    </div>
    <div className={CDS_ROWS}>{children}</div>
  </section>
);

// A top-level metric row plus its (optional) revealable sub-options, kept as one
// direct child of CDS_ROWS. It carries `data-settings-nest` so CDS_ROWS' own
// divide-y doesn't draw a border around it — the .cub-metric-group CSS draws the
// separators between groups itself, so collapsed sub-options never leave a stray
// divider between the main rows.
const MetricGroup = ({ children }: { children: React.ReactNode }) => (
  <div data-settings-nest className="cub-metric-group">
    {children}
  </div>
);

// Animated disclosure for a control's advanced sub-options. Always mounted so
// both expand and collapse animate (grid-template-rows 0fr↔1fr via .cub-nest-anim).
const NestGroup = ({ open, children }: { open: boolean; children: React.ReactNode }) => (
  <div className="cub-nest-anim" data-open={open ? "true" : "false"}>
    <div className="cub-nest-anim-inner">
      <div className="cub-nest">{children}</div>
    </div>
  </div>
);

// One sub-option inside a NestGroup; wraps a Row so the git-graph connector
// (::before/::after in .cub-nest-item) links it to the trunk.
const NestItem = ({ children }: { children: React.ReactNode }) => (
  <div className="cub-nest-item">{children}</div>
);

// ── Options ──────────────────────────────────────────────────────────────────

// Option labels are functions, not consts, because t() reads the active language
// at call time — a module-level const would freeze the labels in English.
// Bar can't show context window — that's the wheel's job.
const resetScopeOptions = (): { value: ResetBannerScope; label: string }[] => [
  { value: "claude", label: t("setResetScopeClaude", "claude.ai only") },
  { value: "everywhere", label: t("setResetScopeEverywhere", "Any site") },
];

const barMetricOptions = (): { value: MetricTarget; label: string }[] => [
  { value: "session", label: t("ringSession", "5-hour session") },
  { value: "weekly", label: t("ringWeekly", "Weekly · all models") },
  { value: "weekly_fable", label: t("ringWeeklyFable", "Weekly · Fable") },
];

const contextDisplayOptions = (): { value: ContextDisplay; label: string }[] => [
  { value: "ring", label: t("setOptRing", "Ring") },
  { value: "text", label: t("setOptPercentText", "Percentage") },
];

const paceSurplusOptions = (): { value: PaceSurplusFormat; label: string }[] => [
  { value: "percent", label: t("setOptPctReset", "Percentage at reset") },
  { value: "time", label: t("setOptTimePast", "Time past reset") },
  { value: "messages", label: t("setOptMsgsLeft", "Messages left") },
];

const weeklyPaceOptions = (): { value: WeeklyPaceMode; label: string }[] => [
  { value: "smart", label: t("setOptSmart", "Smart schedule") },
  { value: "manual", label: t("setOptManual", "Manual schedule") },
];

const weeklyDisplayOptions = (): { value: WeeklyEstimateDisplay; label: string }[] => [
  { value: "active_hours", label: t("setOptActiveHours", "Active hours") },
  { value: "calendar_time", label: t("setOptDaysTime", "Days / time") },
];

export const formatManualStartTimeLabel = (hour: number): string => {
  const normalizedHour = Math.max(0, Math.min(23, Math.floor(hour)));
  const suffix = normalizedHour < 12 ? "AM" : "PM";
  const displayHour = normalizedHour % 12 === 0 ? 12 : normalizedHour % 12;
  return `${displayHour}:00 ${suffix}`;
};

const MANUAL_START_TIME_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: formatManualStartTimeLabel(hour),
}));

const weekDays = (): { value: number; label: string }[] => [
  { value: 0, label: t("setDaySun", "S") },
  { value: 1, label: t("setDayMon", "M") },
  { value: 2, label: t("setDayTue", "T") },
  { value: 3, label: t("setDayWed", "W") },
  { value: 4, label: t("setDayThu", "T") },
  { value: 5, label: t("setDayFri", "F") },
  { value: 6, label: t("setDaySat", "S") },
];

// ── SettingsPage ─────────────────────────────────────────────────────────────

const SettingsPage = () => {
  const uid = useId();
  const id = (key: string) => `cub-${uid}-${key}`;

  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [weeklyMetrics, setWeeklyMetrics] = useState<WeeklyUsageMetrics | null>(null);
  const [testCountdown, setTestCountdown] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void getStorage().then((s) => {
      setLanguage(s.settings.language);
      setSettings(s.settings);
      setWeeklyMetrics(s.weeklyUsageMetrics);
      setLoaded(true);
    });

    const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes.settings?.newValue) {
        const next = changes.settings.newValue as Settings;
        setLanguage(next.language);
        setSettings(next);
      }
      if (area === "local" && changes.weeklyUsageMetrics?.newValue) {
        setWeeklyMetrics(changes.weeklyUsageMetrics.newValue as WeeklyUsageMetrics);
      }
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }, []);

  // Countdown is cosmetic; the background worker owns the real 5s timer, so
  // closing this panel mid-count still delivers the banner.
  useEffect(() => {
    if (testCountdown <= 0) return;
    const timer = setTimeout(() => setTestCountdown((value) => value - 1), 1_000);
    return () => clearTimeout(timer);
  }, [testCountdown]);

  const update = (partial: Partial<Settings>) => {
    void updateSettings(partial).then(setSettings);
  };

  // chrome.permissions.request() is unavailable to content scripts and needs a
  // user gesture on an extension page, so picking "Any site" hands off to the
  // background, which opens a small grant window. Storage syncs the result back
  // into this panel via the onChanged listener above.
  const changeResetScope = async (next: ResetBannerScope) => {
    if (next === "everywhere") {
      chrome.runtime.sendMessage({ type: MESSAGE_TYPES.requestAllSites }, () => {
        void chrome.runtime.lastError;
      });
      return;
    }
    update({ resetBannerScope: next });
    chrome.runtime.sendMessage({ type: MESSAGE_TYPES.syncResetBanner }, () => {
      void chrome.runtime.lastError;
    });
  };

  const sendTestBanner = () => {
    if (testCountdown > 0) return;
    chrome.runtime.sendMessage(
      { type: MESSAGE_TYPES.testResetBanner, kind: "session" },
      (response: { delayMs?: number } | undefined) => {
        void chrome.runtime.lastError;
        setTestCountdown(Math.round((response?.delayMs ?? 5_000) / 1_000));
      },
    );
  };

  const deleteWeeklyHistory = () => {
    void clearWeeklyUsageMetrics().then(setWeeklyMetrics);
  };

  const toggleWorkDay = (day: number) => {
    const current = new Set(settings.weeklyManualWorkDays ?? [1, 2, 3, 4, 5]);
    if (current.has(day)) {
      current.delete(day);
    } else {
      current.add(day);
    }
    update({ weeklyManualWorkDays: [...current].sort((a, b) => a - b) });
  };

  const learnedDays = Object.keys(weeklyMetrics?.activeDayBuckets ?? {}).length;
  const learnedHours = weeklyMetrics?.averageActiveHoursPerDay ?? 0;

  // "Data collected" status string describing the locally learned usage pattern.
  const learnedStatusText =
    `${weeklyMetrics?.confidence === "ready" ? t("setReady", "Ready") : t("setLearning", "Learning")}` +
    ` · ${t("setSamples", "$1 samples", weeklyMetrics?.sampleCount ?? 0)}` +
    (learnedDays > 0 ? ` · ${t("setActiveDays", "$1 active days", learnedDays)}` : "") +
    (learnedHours > 0 ? ` · ${t("setHoursPerDay", "$1h/day", Math.round(learnedHours * 10) / 10)}` : "");

  if (!loaded) return null;

  return (
    <div className="flex flex-col">
      <Section id="cub-section-general" title={t("setSecGeneral", "General")}>
        <Row labelId={id("show-overlay")} label={t("setShowOverlay", "Show overlay")} description={t("setShowOverlayDesc", "Display the usage bar overlay in the Claude chat composer.")}>
          <Switch
            id={id("show-overlay")}
            checked={settings.showOverlay}
            onChange={(v) => update({ showOverlay: v })}
          />
        </Row>
        <Row
          labelId={id("language")}
          label={t("setLanguage", "Language")}
          description={t("setLanguageDesc", "Language for the usage overlay and popup. Defaults to English. Translations may be inaccurate.")}
        >
          <CdsSelect
            id={id("language")}
            value={settings.language ?? "en"}
            onChange={(v) => update({ language: v })}
            options={SUPPORTED_LANGUAGES}
          />
        </Row>
        <Row
          labelId={id("replay-tour")}
          label={t("setTour", "Feature tour")}
          description={t("setTourDesc", "Walk through the extension features step by step.")}
        >
          <CdsButton
            onClick={() => {
              // Close the settings overlay (the tour starts on /new), then
              // (re)start the tour. Don't unmount our panel synchronously here —
              // we're inside its own React root; closing the overlay lets the
              // observer's syncSettingsPanel tear it down safely on the next frame.
              closeSettingsOverlay();
              void updateSettings({ hasSeenTour: false });
            }}
          >
            {t("setTourBtn", "Replay Tour")}
          </CdsButton>
        </Row>
        <Row
          labelId={id("review")}
          descId={id("review-desc")}
          label={t("setReview", "Leave a review")}
          description={t("setReviewDesc", "Enjoying Claude Usage Bar? A rating helps others discover it and takes less than a minute. You can also request features or suggest other products you'd like to see right in your review.")}
        >
          <CdsButton onClick={() => window.open(CWS_URL, "_blank", "noopener,noreferrer")}>
            {t("setReviewBtn", "Rate on Chrome Web Store")}
          </CdsButton>
        </Row>
        <Row
          labelId={id("privacy-policy")}
          descId={id("privacy-policy-desc")}
          label={t("setPrivacy", "Privacy policy")}
          description={t("setPrivacyDesc", "View what Claude Usage Bar accesses, stores, and never sends to the developer.")}
        >
          <CdsButton onClick={() => window.open(PRIVACY_POLICY_URL, "_blank", "noopener,noreferrer")}>
            {t("setPrivacyBtn", "Open Privacy Policy")}
          </CdsButton>
        </Row>
        <Row
          labelId={id("github")}
          descId={id("github-desc")}
          label={t("setProject", "GitHub")}
          description={t("setProjectDesc", "Open the GitHub repository for source code, issues, and support.")}
        >
          <CdsButton onClick={() => window.open(GITHUB_URL, "_blank", "noopener,noreferrer")}>
            {t("setProjectBtn", "Open GitHub")}
          </CdsButton>
        </Row>
      </Section>

      <Section title={t("setSecBar", "Bar")}>
        <Row labelId={id("show-bar")} label={t("setShowBar", "Show bar")} description={t("setShowBarDesc", "Show the horizontal usage meter in the composer toolbar.")}>
          <Switch
            id={id("show-bar")}
            checked={settings.showBar}
            onChange={(v) => update({ showBar: v })}
          />
        </Row>
        <Row labelId={id("bar-metric")} label={t("setBarShows", "Bar shows")} description={t("setBarShowsDesc", "Which usage metric the bar fill represents.")}>
          <CdsSelect
            id={id("bar-metric")}
            value={settings.barMetric}
            options={barMetricOptions()}
            onChange={(v) => update({ barMetric: v as MetricTarget })}
          />
        </Row>
        <Row labelId={id("bar-label")} label={t("setShowPctLabel", "Show percentage label")} description={t("setBarLabelDesc", "Display the current percentage as text next to the bar.")}>
          <Switch
            id={id("bar-label")}
            checked={settings.showBarLabel}
            onChange={(v) => update({ showBarLabel: v })}
          />
        </Row>
      </Section>

      <Section title={t("setSecWheel", "Context window")}>
        <Row labelId={id("show-wheel")} label={t("setShowWheel", "Show context window")} description={t("setShowWheelDesc", "Show the context window indicator in the composer toolbar.")}>
          <Switch
            id={id("show-wheel")}
            checked={settings.showWheel}
            onChange={(v) => update({ showWheel: v })}
          />
        </Row>
        <Row labelId={id("context-display")} label={t("setContextDisplay", "Show as")} description={t("setContextDisplayDesc", "A ring that fills up, or the percentage as text.")}>
          <CdsSelect
            id={id("context-display")}
            value={settings.contextDisplay ?? "ring"}
            options={contextDisplayOptions()}
            onChange={(v) => update({ contextDisplay: v as ContextDisplay })}
          />
        </Row>
      </Section>

      <Section title={t("setSecResetAlerts", "Reset alerts")}>
        <Row
          labelId={id("reset-banner")}
          label={t("setResetBanner", "Show reset alerts")}
          description={t(
            "setResetBannerDesc",
            "Pop a banner when a usage limit rolls over, so you know you can start again.",
          )}
        >
          <Switch
            id={id("reset-banner")}
            checked={settings.resetBannerScope !== "off"}
            onChange={(v) => update({ resetBannerScope: v ? "claude" : "off" })}
          />
        </Row>
        {settings.resetBannerScope !== "off" && (
          <>
            <Row
              labelId={id("reset-banner-scope")}
              label={t("setResetBannerScope", "Show alerts on")}
              description={t(
                "setResetBannerScopeDesc",
                "Any site lets the banner reach you while you're browsing elsewhere. Chrome will ask for permission.",
              )}
            >
              <CdsSelect
                id={id("reset-banner-scope")}
                value={settings.resetBannerScope}
                options={resetScopeOptions()}
                onChange={(v) => void changeResetScope(v as ResetBannerScope)}
              />
            </Row>
            <Row
              labelId={id("reset-banner-session")}
              label={t("setResetBannerSession", "5-hour limit")}
              description={t("setResetBannerSessionDesc", "Alert when the 5-hour session window resets.")}
            >
              <Switch
                id={id("reset-banner-session")}
                checked={settings.resetBannerSession}
                onChange={(v) => update({ resetBannerSession: v })}
              />
            </Row>
            <Row
              labelId={id("reset-banner-weekly")}
              label={t("setResetBannerWeekly", "Weekly limit")}
              description={t("setResetBannerWeeklyDesc", "Alert when the weekly all-models window resets.")}
            >
              <Switch
                id={id("reset-banner-weekly")}
                checked={settings.resetBannerWeekly}
                onChange={(v) => update({ resetBannerWeekly: v })}
              />
            </Row>
            <Row
              labelId={id("reset-banner-test")}
              label={t("setResetBannerTest", "Preview the banner")}
              description={t(
                "setResetBannerTestDesc",
                "Sends a real banner after 5 seconds, so you can switch tabs and see where it lands.",
              )}
            >
              <CdsButton onClick={sendTestBanner}>
                {testCountdown > 0
                  ? t("setResetBannerTestCounting", "in $1s", String(testCountdown))
                  : t("setResetBannerTestGo", "Send test")}
              </CdsButton>
            </Row>
          </>
        )}
      </Section>

      <Section title={t("setSecCacheTimer", "Cache timer")}>
        <Row
          labelId={id("show-cache-timer")}
          label={t("setShowCacheTimer", "Show cache timer")}
          description={t("setShowCacheTimerDesc", "Show a countdown in the chat header for how long the prompt cache stays warm. Turn this off to hide it.")}
        >
          <Switch
            id={id("show-cache-timer")}
            checked={settings.showCacheTimer !== false}
            onChange={(v) => update({ showCacheTimer: v })}
          />
        </Row>
      </Section>

      <div id="cub-metrics-sections">
      <Section id="cub-section-usage-metrics" title={t("setSecUsageMetrics", "Usage metrics")}>
        {/* 5-hour metrics: toggle reveals its pace format sub-option */}
        <MetricGroup>
          <Row
            rowId="cub-row-5hr-metrics"
            labelId={id("show-pace")}
            label={t("set5hrMetrics", "5-hour metrics")}
            description={t("set5hrMetricsDesc", "Show a pace estimate next to the 5-hour usage bar. Accurate pace uses local pattern learning — turn this off to opt out of pattern-based pacing.")}
          >
            <Switch
              id={id("show-pace")}
              checked={settings.showPace}
              onChange={(v) => update({ showPace: v })}
            />
          </Row>
          <NestGroup open={settings.showPace}>
            <NestItem>
              <Row
                labelId={id("pace-surplus")}
                label={t("setPaceFormat", "Pace format")}
                description={t("setPaceFormatDesc", "What to show next to the 5-hour percentage: the percentage you'll be at when reset hits, the extra time you'll have past reset, or an estimate of how many messages you have left at the model you're using.")}
              >
                <CdsSelect
                  id={id("pace-surplus")}
                  value={settings.paceSurplusFormat}
                  options={paceSurplusOptions()}
                  onChange={(v) => update({ paceSurplusFormat: v as PaceSurplusFormat })}
                />
              </Row>
            </NestItem>
          </NestGroup>
        </MetricGroup>

        {/* Weekly metrics: toggle reveals the weekly estimate display sub-option */}
        <MetricGroup>
          <Row
            rowId="cub-row-weekly-metrics"
            labelId={id("weekly-enabled")}
            label={t("setWeeklyMetrics", "Weekly metrics")}
            description={t("setWeeklyMetricsDesc", "Learn weekly usage from local numeric samples to power the weekly estimate. Turn this off to keep weekly pacing on the fixed manual schedule.")}
          >
            <Switch
              id={id("weekly-enabled")}
              checked={settings.weeklyMetricsEnabled !== false}
              onChange={(v) => update({ weeklyMetricsEnabled: v })}
            />
          </Row>
          <NestGroup open={settings.weeklyMetricsEnabled !== false}>
            <NestItem>
              <Row
                labelId={id("weekly-display")}
                label={t("setWeeklyDisplay", "Weekly estimate display")}
                description={t("setWeeklyDisplayDesc", "Active hours shows usable Claude time left. Days / time predicts the local day and time you will run out.")}
              >
                <CdsSelect
                  id={id("weekly-display")}
                  value={settings.weeklyEstimateDisplay ?? "active_hours"}
                  options={weeklyDisplayOptions()}
                  onChange={(v) => update({ weeklyEstimateDisplay: v as WeeklyEstimateDisplay })}
                />
              </Row>
            </NestItem>
            {settings.weeklyEstimateDisplay === "calendar_time" && settings.weeklyPaceMode !== "manual" && (
              <NestItem>
                <Row
                  labelId={id("weekly-start-hour")}
                  label={t("setManualStart", "Manual start time")}
                  description={t("setManualStartDesc", "Local time used with manual days to place weekly usage into calendar time.")}
                >
                  <CdsSelect
                    id={id("weekly-start-hour")}
                    value={String(settings.weeklyManualStartHour ?? 9)}
                    options={MANUAL_START_TIME_OPTIONS}
                    onChange={(v) => update({ weeklyManualStartHour: Math.min(23, Math.max(0, Number(v) || 9)) })}
                  />
                </Row>
              </NestItem>
            )}
          </NestGroup>
        </MetricGroup>

        {/* Estimates: manual reveals the work-day / hours / start-time sub-options */}
        <MetricGroup>
          <Row
            labelId={id("weekly-mode")}
            label={t("setEstimates", "Estimates")}
            description={t("setEstimatesDesc", "Smart learns your active Claude pattern from local usage samples. Manual lets you set a fixed weekly schedule.")}
          >
            <CdsSelect
              id={id("weekly-mode")}
              value={settings.weeklyPaceMode}
              options={weeklyPaceOptions()}
              onChange={(v) => update({ weeklyPaceMode: v as WeeklyPaceMode })}
            />
          </Row>
          <NestGroup open={settings.weeklyPaceMode === "manual"}>
            <NestItem>
              <Row
                labelId={id("weekly-days")}
                label={t("setManualDays", "Manual work days")}
                description={t("setManualDaysDesc", "Used as the default schedule while smart weekly metrics are learning, or whenever manual mode is selected.")}
              >
                <div className="flex items-center gap-1" role="group" aria-label={t("setManualDaysAria", "Manual weekly work days")}>
                  {weekDays().map((day) => {
                    const active = (settings.weeklyManualWorkDays ?? [1, 2, 3, 4, 5]).includes(day.value);
                    return (
                      <button
                        key={day.value}
                        type="button"
                        aria-pressed={active}
                        className="cds-reset inline-flex h-7 w-7 items-center justify-center rounded border text-body"
                        style={{
                          background: active ? "rgb(204 124 94 / 18%)" : "rgb(255 255 255 / 6%)",
                          borderColor: active ? "rgb(204 124 94 / 64%)" : "rgb(255 255 255 / 10%)",
                          color: active ? "rgb(204 124 94)" : "var(--text-primary)",
                        }}
                        onClick={() => toggleWorkDay(day.value)}
                      >
                        {day.label}
                      </button>
                    );
                  })}
                </div>
              </Row>
            </NestItem>
            <NestItem>
              <Row
                labelId={id("weekly-hours")}
                label={t("setManualHours", "Manual hours per work day")}
                description={t("setManualHoursDesc", "Used as the starting cap for weekly pacing before smart metrics have enough history.")}
              >
                <input
                  id={id("weekly-hours")}
                  type="number"
                  min="1"
                  max="24"
                  step="1"
                  value={settings.weeklyManualActiveHoursPerDay}
                  onChange={(e) => {
                    const value = Math.min(24, Math.max(1, Number(e.currentTarget.value) || 10));
                    update({ weeklyManualActiveHoursPerDay: value });
                  }}
                  className="h-control w-16 rounded bg-bg-000 px-sm text-body text-primary outline-none shadow-field"
                />
              </Row>
            </NestItem>
            <NestItem>
              <Row
                labelId={id("manual-start-hour")}
                label={t("setManualStart", "Manual start time")}
                description={t("setManualStartDesc", "Local time used with manual days to place weekly usage into calendar time.")}
              >
                <CdsSelect
                  id={id("manual-start-hour")}
                  value={String(settings.weeklyManualStartHour ?? 9)}
                  options={MANUAL_START_TIME_OPTIONS}
                  onChange={(v) => update({ weeklyManualStartHour: Math.min(23, Math.max(0, Number(v) || 9)) })}
                />
              </Row>
            </NestItem>
          </NestGroup>
        </MetricGroup>

        {/* Data collected: local learned-pattern status + delete */}
        <MetricGroup>
          <Row
            labelId={id("weekly-learned")}
            label={t("setDataCollected", "Data collected")}
            description={t("setLearnedPatternDesc", "Stored locally in this browser. No prompts, responses, cookies, or raw Claude payloads are stored.")}
          >
            <div className="flex items-center gap-2">
              <span className="text-body text-muted">{learnedStatusText}</span>
              <CdsButton onClick={deleteWeeklyHistory}>{t("setDeleteHistory", "Delete history")}</CdsButton>
            </div>
          </Row>
        </MetricGroup>
      </Section>
      </div>
    </div>
  );
};

// ── Init ─────────────────────────────────────────────────────────────────────

// Open the overlay (if needed) and make our panel its active section. Used by
// the in-bar settings shortcut and the onboarding tour. Polls for the overlay
// to mount after the shortcut fires, then activates.
export const openUsageBarSettings = async (): Promise<void> => {
  if (!isSettingsOverlayOpen()) {
    openSettingsOverlay();
    for (let i = 0; i < 25 && !isSettingsOverlayOpen(); i++) {
      await new Promise((r) => setTimeout(r, 60));
    }
  }
  injectNavItem();
  activatePanel();
};

// The overlay opens as a modal with no URL change, so a debounced refresh tick
// alone reacts too slowly (the nav item used to take ~2 s to appear). This
// observer runs syncSettingsPanel the instant the DOM changes — injecting the
// nav, recovering the panel after Claude re-renders, and tearing down on close.
// syncSettingsPanel bails cheaply when the overlay is closed, so the only
// expensive work runs when there's actually something to do.
let syncScheduled = false;

const scheduleSync = () => {
  if (syncScheduled) return;
  syncScheduled = true;
  requestAnimationFrame(() => {
    syncScheduled = false;
    syncSettingsPanel();
  });
};

export const initSettingsPage = () => {
  injectNavItem();

  const observer = new MutationObserver(scheduleSync);
  observer.observe(document.body, { childList: true, subtree: true });

  // Clicking any settings nav item other than ours deactivates our panel and
  // lets Claude show its own section. Delegated + capture so it survives
  // Claude re-rendering the nav, and fires before the page's own handler.
  document.addEventListener(
    "click",
    (e) => {
      if (!panelActive) return;
      const btn = (e.target as Element | null)?.closest?.("li > button");
      if (btn && !btn.hasAttribute("data-cub-nav")) {
        deactivatePanel();
      }
    },
    true,
  );
};

export const tickSettingsPage = () => {
  syncSettingsPanel();
};
