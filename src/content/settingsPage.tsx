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

const SETTINGS_PATH = "/settings/usage-bar";

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

const findSettingsNav = (): HTMLUListElement | null =>
  document.querySelector<HTMLAnchorElement>('a[href="/settings/general"]')?.closest("ul") ?? null;

const findSectionsContainer = (): HTMLElement | null => {
  const main = document.querySelector<HTMLElement>("main");
  if (!main) return null;
  // The content area is the focusable outline div inside main
  return main.querySelector<HTMLElement>('[tabindex="-1"].outline-none') ?? main;
};

// ── Nav injection ────────────────────────────────────────────────────────────

let navLi: HTMLLIElement | null = null;

const NAV_BASE_CLASS =
  "font-base block whitespace-nowrap transition-colors ease-in-out rounded-lg px-3 h-9 line-clamp-1 flex gap-3 items-center";

const injectNavItem = () => {
  const ul = findSettingsNav();
  if (!ul) return;
  const existingA = ul.querySelector<HTMLElement>("[data-cub-nav]");
  if (existingA) {
    navLi = existingA.closest("li");
    updateNavActiveState();
    return;
  }

  const li = document.createElement("li");
  const a = document.createElement("a");
  a.href = SETTINGS_PATH;
  a.setAttribute("data-cub-nav", "");
  a.className = `${NAV_BASE_CLASS} hover:bg-bg-200`;
  a.textContent = "Usage Bar";

  a.addEventListener("click", (e) => {
    e.preventDefault();
    history.pushState(null, "", SETTINGS_PATH);
    // handleUrlChange is called by our pushState wrapper
  });

  li.appendChild(a);

  // Insert after General (2nd position, above Account)
  const generalLi = ul.querySelector<HTMLElement>('a[href="/settings/general"]')?.closest("li");
  if (generalLi?.nextSibling) {
    ul.insertBefore(li, generalLi.nextSibling);
  } else {
    ul.appendChild(li);
  }
  navLi = li;
  updateNavActiveState();
};

const updateNavActiveState = () => {
  const a = navLi?.querySelector<HTMLElement>("[data-cub-nav]");
  if (!a) return;
  const isActive = location.pathname === SETTINGS_PATH;
  if (isActive) {
    a.classList.remove("hover:bg-bg-200");
    a.classList.add("bg-bg-300");
  } else {
    a.classList.remove("bg-bg-300");
    a.classList.add("hover:bg-bg-200");
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

const handleUrlChange = () => {
  updateNavActiveState();
  if (location.pathname === SETTINGS_PATH) {
    mountPanel();
  } else {
    unmountPanel();
  }
};

// ── URL change detection ─────────────────────────────────────────────────────

let pushStatePatched = false;

const patchHistory = () => {
  if (pushStatePatched) return;
  pushStatePatched = true;

  const originalPushState = history.pushState.bind(history);
  history.pushState = (...args: Parameters<typeof history.pushState>) => {
    originalPushState(...args);
    handleUrlChange();
  };

  const originalReplaceState = history.replaceState.bind(history);
  history.replaceState = (...args: Parameters<typeof history.replaceState>) => {
    originalReplaceState(...args);
    handleUrlChange();
  };

  window.addEventListener("popstate", handleUrlChange);
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
}

const Row = ({ labelId, descId, label, description, children }: RowProps) => (
  <div
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
  { value: "design", label: "Claude Design" },
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
      <Section title="General">
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
              void updateSettings({ hasSeenTour: false });
              history.pushState(null, "", "/new");
              window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
            }}
          >
            Replay Tour
          </CdsButton>
        </Row>
        <Row
          labelId={id("review")}
          descId={id("review-desc")}
          label="Leave a review"
          description="Enjoying Claude Usage Bar? A rating helps others discover it and takes less than a minute."
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

      <div id="cub-metrics-sections">
      <Section id="cub-section-weekly-metrics" title="Weekly usage metrics">
        <Row
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

export const initSettingsPage = () => {
  patchHistory();
  injectNavItem();
  handleUrlChange();

  // Claude's pushState runs in the page world and bypasses our content-script
  // wrapper, so we poll every 100 ms to catch navigations that handleUrlChange
  // would otherwise miss (panel unmount, highlight clear).
  let lastPathname = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPathname) {
      lastPathname = location.pathname;
      handleUrlChange();
    }
  }, 100);
};

export const tickSettingsPage = () => {
  if (!navLi || !document.contains(navLi)) {
    navLi = null;
    injectNavItem();
  }

  // Always sync nav highlight — Claude's pushState runs in the page world and
  // bypasses our content-script-world wrapper, so handleUrlChange may not fire.
  updateNavActiveState();

  if (location.pathname === SETTINGS_PATH) {
    if (!panelEl || !document.contains(panelEl)) {
      // Panel was destroyed by Claude's re-render — clean up stale refs and remount
      if (panelEl) {
        panelRoot?.unmount();
        panelRoot = null;
        panelEl = null;
        hiddenChildren.length = 0;
      }
      mountPanel();
    } else {
      // Panel is live — hide any new children Claude injected (e.g. "not found" text)
      const container = panelEl.parentElement;
      if (container) {
        for (const child of Array.from(container.children)) {
          const el = child as HTMLElement;
          if (el !== panelEl && el.style.display !== "none") {
            el.style.display = "none";
            hiddenChildren.push(el);
          }
        }
      }
    }
  } else if (panelEl) {
    // We navigated away from SETTINGS_PATH but panel is still mounted.
    // Happens because Claude's pushState runs in the page world and skips our wrapper.
    unmountPanel();
  }
};
