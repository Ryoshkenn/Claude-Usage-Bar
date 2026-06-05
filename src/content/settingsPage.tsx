import React, { useEffect, useId, useState } from "react";
import { createRoot } from "react-dom/client";
import { clearWeeklyUsageMetrics, DEFAULT_SETTINGS, getStorage, updateSettings } from "../shared/storage";
import type {
  MetricTarget,
  PaceSurplusFormat,
  RingTarget,
  Settings,
  WeeklyEstimateDisplay,
  WeeklyPaceMode,
  WeeklyUsageMetrics,
} from "../shared/types";

const CWS_URL =
  "https://chromewebstore.google.com/detail/claude-usage-bar/eiddfcnlmiebkbnaopcgambdbnlangai";

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
const CDS_SWITCH =
  "cds-reset relative inline-flex shrink-0 rounded-full border-0 outline-none bg-switch-track hover:bg-switch-track-hover data-[checked]:bg-fill-accent data-[checked]:hover:bg-fill-accent-hover disabled:opacity-50 disabled:hover:bg-switch-track focus-visible:shadow-focus h-switch w-[calc(var(--cds-switch-h,20px)*1.8)] p-[2px]";
const CDS_SWITCH_KNOB =
  "block rounded-full bg-switch-knob shadow-sm transition-transform duration-snap ease-overshoot motion-reduce:transition-none size-[calc(var(--cds-switch-h,20px)-4px)] data-[checked]:translate-x-[calc(var(--cds-switch-h,20px)*0.8)]";
const CDS_BUTTON =
  "cds-reset group/btn relative isolate inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap select-none border-0 outline-none rounded h-control font-sans text-body font-medium [&:disabled:not([aria-busy])]:opacity-50 disabled:pointer-events-none transition-shadow duration-fast focus-visible:shadow-focus text-primary aria-pressed:text-accent px-md";
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

const Switch = ({
  checked,
  onChange,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  id: string;
}) => {
  const checkedProps = checked ? { "data-checked": "" } : { "data-unchecked": "" };
  return (
    <button
      type="button"
      tabIndex={0}
      id={id}
      role="switch"
      aria-checked={checked}
      data-cds="Switch"
      className={CDS_SWITCH}
      {...checkedProps}
      onClick={() => onChange(!checked)}
    >
      <span className={CDS_SWITCH_KNOB} {...checkedProps} />
    </button>
  );
};

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

// ── Options ──────────────────────────────────────────────────────────────────

const METRIC_OPTIONS: { value: MetricTarget; label: string }[] = [
  { value: "session", label: "5-hour session" },
  { value: "weekly", label: "Weekly · all models" },
  { value: "context", label: "Context window" },
];

const RING_OPTIONS: { value: RingTarget; label: string }[] = [...METRIC_OPTIONS];

const PACE_SURPLUS_OPTIONS: { value: PaceSurplusFormat; label: string }[] = [
  { value: "percent", label: "Percentage at reset" },
  { value: "time", label: "Time past reset" },
];

const WEEKLY_PACE_OPTIONS: { value: WeeklyPaceMode; label: string }[] = [
  { value: "smart", label: "Smart schedule" },
  { value: "manual", label: "Manual schedule" },
];

const WEEKLY_DISPLAY_OPTIONS: { value: WeeklyEstimateDisplay; label: string }[] = [
  { value: "active_hours", label: "Active hours" },
  { value: "calendar_time", label: "Days / time" },
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

const WEEK_DAYS = [
  { value: 0, label: "S" },
  { value: 1, label: "M" },
  { value: 2, label: "T" },
  { value: 3, label: "W" },
  { value: 4, label: "T" },
  { value: 5, label: "F" },
  { value: 6, label: "S" },
];

// ── SettingsPage ─────────────────────────────────────────────────────────────

const SettingsPage = () => {
  const uid = useId();
  const id = (key: string) => `cub-${uid}-${key}`;

  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [weeklyMetrics, setWeeklyMetrics] = useState<WeeklyUsageMetrics | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void getStorage().then((s) => {
      setSettings(s.settings);
      setWeeklyMetrics(s.weeklyUsageMetrics);
      setLoaded(true);
    });

    const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes.settings?.newValue) {
        setSettings(changes.settings.newValue as Settings);
      }
      if (area === "local" && changes.weeklyUsageMetrics?.newValue) {
        setWeeklyMetrics(changes.weeklyUsageMetrics.newValue as WeeklyUsageMetrics);
      }
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }, []);

  const update = (partial: Partial<Settings>) => {
    void updateSettings(partial).then(setSettings);
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
  const showManualStartTime =
    settings.weeklyEstimateDisplay === "calendar_time" || settings.weeklyPaceMode === "manual";

  if (!loaded) return null;

  return (
    <div className="flex flex-col">
      <Section id="cub-section-general" title="General">
        <Row labelId={id("show-overlay")} label="Show overlay" description="Display the usage bar overlay in the Claude chat composer.">
          <Switch
            id={id("show-overlay")}
            checked={settings.showOverlay}
            onChange={(v) => update({ showOverlay: v })}
          />
        </Row>
        <Row
          labelId={id("replay-tour")}
          label="Feature tour"
          description="Walk through the extension features step by step."
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
            Replay Tour
          </CdsButton>
        </Row>
        <Row
          labelId={id("review")}
          descId={id("review-desc")}
          label="Leave a review"
          description="Enjoying Claude Usage Bar? A rating helps others discover it and takes less than a minute. You can also request features or suggest other products you'd like to see right in your review."
        >
          <CdsButton onClick={() => window.open(CWS_URL, "_blank", "noopener,noreferrer")}>
            Rate on Chrome Web Store
          </CdsButton>
        </Row>
      </Section>

      <Section title="Bar">
        <Row labelId={id("show-bar")} label="Show bar" description="Show the horizontal usage meter in the composer toolbar.">
          <Switch
            id={id("show-bar")}
            checked={settings.showBar}
            onChange={(v) => update({ showBar: v })}
          />
        </Row>
        <Row labelId={id("bar-metric")} label="Bar shows" description="Which usage metric the bar fill represents.">
          <CdsSelect
            id={id("bar-metric")}
            value={settings.barMetric}
            options={METRIC_OPTIONS}
            onChange={(v) => update({ barMetric: v as MetricTarget })}
          />
        </Row>
        <Row labelId={id("bar-label")} label="Show percentage label" description="Display the current percentage as text next to the bar.">
          <Switch
            id={id("bar-label")}
            checked={settings.showBarLabel}
            onChange={(v) => update({ showBarLabel: v })}
          />
        </Row>
      </Section>

      <Section title="Wheel">
        <Row labelId={id("show-wheel")} label="Show wheel" description="Show the circular ring indicator next to the bar.">
          <Switch
            id={id("show-wheel")}
            checked={settings.showWheel}
            onChange={(v) => update({ showWheel: v })}
          />
        </Row>
        <Row labelId={id("ring-target")} label="Wheel shows" description="Which usage metric the wheel fill represents.">
          <CdsSelect
            id={id("ring-target")}
            value={settings.ringTarget}
            options={RING_OPTIONS}
            onChange={(v) => update({ ringTarget: v as RingTarget })}
          />
        </Row>
        <Row labelId={id("wheel-label")} label="Show percentage label" description="Display the current percentage as small text below the wheel.">
          <Switch
            id={id("wheel-label")}
            checked={settings.showWheelLabel}
            onChange={(v) => update({ showWheelLabel: v })}
          />
        </Row>
      </Section>

      <Section title="Cache timer">
        <Row
          labelId={id("show-cache-timer")}
          label="Show cache timer"
          description="Show a countdown in the chat header for how long the prompt cache stays warm. Turn this off to hide it."
        >
          <Switch
            id={id("show-cache-timer")}
            checked={settings.showCacheTimer !== false}
            onChange={(v) => update({ showCacheTimer: v })}
          />
        </Row>
      </Section>

      <div id="cub-metrics-sections">
      <Section id="cub-section-weekly-metrics" title="Weekly usage metrics">
        <Row
          rowId="cub-row-weekly-learning"
          labelId={id("weekly-enabled")}
          label="Learn weekly patterns"
          description="Use local numeric samples to tune weekly estimates. Turn this off to keep weekly pacing on the fixed manual schedule."
        >
          <Switch
            id={id("weekly-enabled")}
            checked={settings.weeklyMetricsEnabled !== false}
            onChange={(v) => update({ weeklyMetricsEnabled: v })}
          />
        </Row>
        <Row
          labelId={id("weekly-mode")}
          label="Weekly estimate"
          description="Smart mode starts from about ten 5-hour windows per week, then learns your active Claude pattern from local numeric usage samples."
        >
          <CdsSelect
            id={id("weekly-mode")}
            value={settings.weeklyPaceMode}
            options={WEEKLY_PACE_OPTIONS}
            onChange={(v) => update({ weeklyPaceMode: v as WeeklyPaceMode })}
          />
        </Row>
        <Row
          labelId={id("weekly-display")}
          label="Weekly estimate display"
          description="Active hours shows usable Claude time left. Days / time predicts the local day and time you will run out."
        >
          <CdsSelect
            id={id("weekly-display")}
            value={settings.weeklyEstimateDisplay ?? "active_hours"}
            options={WEEKLY_DISPLAY_OPTIONS}
            onChange={(v) => update({ weeklyEstimateDisplay: v as WeeklyEstimateDisplay })}
          />
        </Row>
        <Row
          labelId={id("weekly-days")}
          label="Manual work days"
          description="Used as the default schedule while smart weekly metrics are learning, or whenever manual mode is selected."
        >
          <div className="flex items-center gap-1" role="group" aria-label="Manual weekly work days">
            {WEEK_DAYS.map((day) => {
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
        <Row
          labelId={id("weekly-hours")}
          label="Manual hours per work day"
          description="Used as the starting cap for weekly pacing before smart metrics have enough history."
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
        {showManualStartTime && (
          <Row
            labelId={id("weekly-start-hour")}
            label="Manual start time"
            description="Local time used with manual days to place weekly usage into calendar time."
          >
            <CdsSelect
              id={id("weekly-start-hour")}
              value={String(settings.weeklyManualStartHour ?? 9)}
              options={MANUAL_START_TIME_OPTIONS}
              onChange={(v) => update({ weeklyManualStartHour: Math.min(23, Math.max(0, Number(v) || 9)) })}
            />
          </Row>
        )}
        <Row
          labelId={id("weekly-learned")}
          label="Learned pattern"
          description="Stored locally in this browser. No prompts, responses, cookies, or raw Claude payloads are stored."
        >
          <div className="flex items-center gap-2">
            <span className="text-body text-muted">
              {weeklyMetrics?.confidence === "ready" ? "Ready" : "Learning"} · {weeklyMetrics?.sampleCount ?? 0} samples
              {learnedDays > 0 ? ` · ${learnedDays} active days` : ""}
              {learnedHours > 0 ? ` · ${Math.round(learnedHours * 10) / 10}h/day` : ""}
            </span>
            <CdsButton onClick={deleteWeeklyHistory}>Delete history</CdsButton>
          </div>
        </Row>
      </Section>

      <Section id="cub-section-5hr-metrics" title="5hr usage metrics">
        <Row
          labelId={id("show-pace")}
          label="Show pace"
          description="Show the pace estimate next to the usage bar. Accurate pace requires pattern learning — to opt out of pattern-based pacing, turn this off."
        >
          <Switch
            id={id("show-pace")}
            checked={settings.showPace}
            onChange={(v) => update({ showPace: v })}
          />
        </Row>
        <Row
          labelId={id("pace-surplus")}
          label="Pace format past reset"
          description="When your usage lasts longer than the reset window, show the percentage you'll be at when reset hits, or the extra time you'll have past reset."
        >
          <CdsSelect
            id={id("pace-surplus")}
            value={settings.paceSurplusFormat}
            options={PACE_SURPLUS_OPTIONS}
            onChange={(v) => update({ paceSurplusFormat: v as PaceSurplusFormat })}
          />
        </Row>
        <Row
          labelId={id("pace-learned")}
          label="Learned pattern"
          description="Stored locally in this browser. No prompts, responses, cookies, or raw Claude payloads are stored."
        >
          <div className="flex items-center gap-2">
            <span className="text-body text-muted">
              {weeklyMetrics?.confidence === "ready" ? "Ready" : "Learning"} · {weeklyMetrics?.sampleCount ?? 0} samples
              {learnedDays > 0 ? ` · ${learnedDays} active days` : ""}
              {learnedHours > 0 ? ` · ${Math.round(learnedHours * 10) / 10}h/day` : ""}
            </span>
            <CdsButton onClick={deleteWeeklyHistory}>Delete history</CdsButton>
          </div>
        </Row>
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
