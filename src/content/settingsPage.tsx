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
// "off" folds each feature's on/off switch into its own picker, so a single
// control covers both whether it shows and how.
type BarChoice = MetricTarget | "off";
type ContextChoice = ContextDisplay | "off";

const resetScopeOptions = (): { value: ResetBannerScope; label: string }[] => [
  { value: "off", label: t("setOptOff", "Off") },
  { value: "claude", label: t("setResetScopeClaude", "claude.ai only") },
  { value: "everywhere", label: t("setResetScopeEverywhere", "Any site") },
];

const barOptions = (): { value: BarChoice; label: string }[] => [
  { value: "off", label: t("setOptOff", "Off") },
  { value: "session", label: t("ringSession", "5-hour session") },
  { value: "weekly", label: t("ringWeekly", "Weekly · all models") },
  { value: "weekly_fable", label: t("ringWeeklyFable", "Weekly · Fable") },
];

const contextOptions = (): { value: ContextChoice; label: string }[] => [
  { value: "off", label: t("setOptOff", "Off") },
  { value: "ring", label: t("setOptRing", "Ring") },
  { value: "text", label: t("setOptPercentText", "Percentage") },
];

const paceSurplusOptions = (): { value: PaceSurplusFormat; label: string }[] => [
  { value: "percent", label: t("setOptPctReset", "Percentage at reset") },
  { value: "time", label: t("setOptTimePast", "Time past reset") },
  { value: "messages", label: t("setOptMsgsLeft", "Messages left") },
];

const weeklyDisplayOptions = (): { value: WeeklyEstimateDisplay; label: string }[] => [
  { value: "active_hours", label: t("setOptActiveHours", "Active hours") },
  { value: "calendar_time", label: t("setOptDaysTime", "Days / time") },
  { value: "percent_at_reset", label: t("setOptPctReset", "Percentage at reset") },
];

// 16px line icons for the footer links (GitHub uses its own mark).
const LinkIcon = ({ name }: { name: "star" | "shield" | "github" }) =>
  name === "github" ? (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  ) : (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "star" ? (
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      ) : (
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      )}
    </svg>
  );

const FooterLink = ({
  href,
  icon,
  children,
}: {
  href: string;
  icon: "star" | "shield" | "github";
  children: React.ReactNode;
}) => (
  <a className="cub-settings-link text-body text-muted" href={href} target="_blank" rel="noopener noreferrer">
    <LinkIcon name={icon} />
    {children}
  </a>
);

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

  // Pacing is the one switch for estimates and the local learning behind them,
  // so turning it off also stops new samples from being recorded.
  const setPacing = (on: boolean) => update({ showPace: on, weeklyMetricsEnabled: on });

  const learnedSamples = weeklyMetrics?.sampleCount ?? 0;

  if (!loaded) return null;

  const pacingOn = settings.showPace !== false;
  const barChoice: BarChoice = settings.showBar !== false ? settings.barMetric : "off";
  const contextChoice: ContextChoice =
    settings.showWheel !== false ? (settings.contextDisplay ?? "ring") : "off";

  return (
    <div className="flex flex-col">
      <Section id="cub-section-display" title={t("setSecDisplay", "Display")}>
        <Row labelId={id("show-overlay")} label={t("setShowOverlay", "Show overlay")} description={t("setShowOverlayDesc", "Turn everything in the composer on or off.")}>
          <Switch
            id={id("show-overlay")}
            checked={settings.showOverlay}
            onChange={(v) => update({ showOverlay: v })}
          />
        </Row>
        <Row labelId={id("bar")} label={t("setUsageBar", "Usage bar")} description={t("setUsageBarDesc", "Which limit the bar tracks.")}>
          <div className="flex items-center gap-3">
            {barChoice !== "off" && (
              <label className="flex items-center gap-1.5 text-body text-muted" htmlFor={id("bar-label")}>
                {t("setShowPct", "Show %")}
                <Switch
                  id={id("bar-label")}
                  checked={settings.showBarLabel}
                  onChange={(v) => update({ showBarLabel: v })}
                />
              </label>
            )}
            <CdsSelect
              id={id("bar")}
              value={barChoice}
              options={barOptions()}
              onChange={(v) =>
                update(v === "off" ? { showBar: false } : { showBar: true, barMetric: v as MetricTarget })
              }
            />
          </div>
        </Row>
        <Row labelId={id("context")} label={t("setSecWheel", "Context window")} description={t("setContextDesc", "How full the current chat is.")}>
          <CdsSelect
            id={id("context")}
            value={contextChoice}
            options={contextOptions()}
            onChange={(v) =>
              update(v === "off" ? { showWheel: false } : { showWheel: true, contextDisplay: v as ContextDisplay })
            }
          />
        </Row>
        <Row
          labelId={id("show-cache-timer")}
          label={t("setSecCacheTimer", "Cache timer")}
          description={t("setCacheTimerDesc", "Countdown in the chat header while the prompt cache is warm.")}
        >
          <Switch
            id={id("show-cache-timer")}
            checked={settings.showCacheTimer !== false}
            onChange={(v) => update({ showCacheTimer: v })}
          />
        </Row>
      </Section>

      <Section id="cub-section-pacing" title={t("setSecPacing", "Pacing")}>
        <MetricGroup>
          <Row
            labelId={id("pacing")}
            label={t("setPacing", "Show pace estimates")}
            description={t("setPacingDesc", "Estimates learn from numeric usage samples stored only in this browser. Turning this off stops collecting them.")}
          >
            <Switch id={id("pacing")} checked={pacingOn} onChange={setPacing} />
          </Row>
          <NestGroup open={pacingOn}>
            <NestItem>
              <Row labelId={id("pace-surplus")} label={t("set5hrPace", "5-hour pace")} description={t("set5hrPaceDesc", "Shown next to the 5-hour percentage.")}>
                <CdsSelect
                  id={id("pace-surplus")}
                  value={settings.paceSurplusFormat}
                  options={paceSurplusOptions()}
                  onChange={(v) => update({ paceSurplusFormat: v as PaceSurplusFormat })}
                />
              </Row>
            </NestItem>
            <NestItem>
              <Row labelId={id("weekly-display")} label={t("setWeeklyEstimate", "Weekly estimate")} description={t("setWeeklyEstimateDesc", "Usable hours left, the day and time you'll run out, or where you'll be at reset.")}>
                <CdsSelect
                  id={id("weekly-display")}
                  value={settings.weeklyEstimateDisplay ?? "active_hours"}
                  options={weeklyDisplayOptions()}
                  onChange={(v) => update({ weeklyEstimateDisplay: v as WeeklyEstimateDisplay })}
                />
              </Row>
            </NestItem>
            <NestItem>
              <Row
                labelId={id("learned")}
                label={t("setLearnedData", "Learned usage")}
                description={t("setSamples", "$1 samples", learnedSamples)}
              >
                <CdsButton onClick={deleteWeeklyHistory}>{t("setDeleteHistory", "Delete history")}</CdsButton>
              </Row>
            </NestItem>
          </NestGroup>
        </MetricGroup>
      </Section>

      <Section title={t("setSecResetAlerts", "Reset alerts")}>
        <Row
          labelId={id("reset-banner-scope")}
          label={t("setResetBannerScope", "Show alerts on")}
          description={t(
            "setResetAlertsDesc",
            "Banner when your 5-hour or weekly limit resets. Any site needs Chrome permission.",
          )}
        >
          <div className="flex items-center gap-2">
            {settings.resetBannerScope !== "off" && (
              <CdsButton onClick={sendTestBanner}>
                {testCountdown > 0
                  ? t("setResetBannerTestCounting", "in $1s", String(testCountdown))
                  : t("setResetBannerTestGo", "Send test")}
              </CdsButton>
            )}
            <CdsSelect
              id={id("reset-banner-scope")}
              value={settings.resetBannerScope}
              options={resetScopeOptions()}
              onChange={(v) => void changeResetScope(v as ResetBannerScope)}
            />
          </div>
        </Row>
      </Section>

      <Section id="cub-section-general" title={t("setSecGeneral", "General")}>
        <Row
          labelId={id("language")}
          label={t("setLanguage", "Language")}
          description={t("setLanguageShortDesc", "Translations may be inaccurate.")}
        >
          <CdsSelect
            id={id("language")}
            value={settings.language ?? "en"}
            onChange={(v) => update({ language: v })}
            options={SUPPORTED_LANGUAGES}
          />
        </Row>
        <Row labelId={id("replay-tour")} label={t("setTour", "Feature tour")}>
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
        <div className="cub-settings-links">
          <FooterLink href={CWS_URL} icon="star">{t("setReviewLink", "Rate on Chrome Web Store")}</FooterLink>
          <FooterLink href={PRIVACY_POLICY_URL} icon="shield">{t("setPrivacy", "Privacy policy")}</FooterLink>
          <FooterLink href={GITHUB_URL} icon="github">{t("setProject", "GitHub")}</FooterLink>
        </div>
      </Section>
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
