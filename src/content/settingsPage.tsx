import React, { useEffect, useId, useState } from "react";
import { createRoot } from "react-dom/client";
import { DEFAULT_SETTINGS, getStorage, updateSettings } from "../shared/storage";
import type { MetricTarget, PaceSurplusFormat, RingTarget, Settings } from "../shared/types";

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
}

const Section = ({ title, children }: SectionProps) => (
  <section className="mb-xl last:mb-0">
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

// ── SettingsPage ─────────────────────────────────────────────────────────────

const SettingsPage = () => {
  const uid = useId();
  const id = (key: string) => `cub-${uid}-${key}`;

  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void getStorage().then((s) => {
      setSettings(s.settings);
      setLoaded(true);
    });

    const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes.settings?.newValue) {
        setSettings(changes.settings.newValue as Settings);
      }
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }, []);

  const update = (partial: Partial<Settings>) => {
    void updateSettings(partial).then(setSettings);
  };

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

      <Section title="Pace">
        <Row
          labelId={id("show-pace")}
          label="Show pace"
          description="Show the pace estimate next to the usage bar when enough recent session data is available."
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
      </Section>
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
