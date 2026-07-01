import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(__dirname, "../content/styles.css"), "utf8");
const contentScript = readFileSync(resolve(__dirname, "../content/content.tsx"), "utf8");
const messageRailScript = readFileSync(resolve(__dirname, "../content/messageRail.ts"), "utf8");
const onboardingTourScript = readFileSync(resolve(__dirname, "../content/OnboardingTour.tsx"), "utf8");
const popupStyles = readFileSync(resolve(__dirname, "../popup/popup.css"), "utf8");

describe("content styles", () => {
  it("uses readable dark text for inline labels in light mode", () => {
    expect(styles).toContain(
      "#claude-usage-bar-root.cub-theme-light .cub-bar-label,\n#claude-usage-bar-root.cub-theme-light .cub-wheel-label {\n  color: rgb(80 78 72);",
    );
  });

  it("applies light mode treatment to the header cache timer", () => {
    expect(contentScript).toContain('cacheTimerHost?.classList.toggle("cub-theme-light", light);');
    expect(styles).toContain("#claude-cache-timer-host.cub-theme-light .cub-cache-timer-tooltip");
  });

  it("uses warm Claude light tracks for the bar, wheel, and usage rows", () => {
    expect(styles).toContain(
      "#claude-usage-bar-root.cub-theme-light .cub-meter {\n  background: rgb(221 219 214);",
    );
    expect(styles).toContain(
      "#claude-usage-bar-root.cub-theme-light .cub-token-ring {\n  background: conic-gradient(rgb(204 124 94) var(--cub-token-percentage), rgb(221 219 214) 0);",
    );
    expect(styles).toContain(
      "#claude-usage-bar-root.cub-theme-light .cub-usage-track {\n  background: rgb(235 233 228);",
    );
  });

  it("uses light-mode colors for nested hover surfaces", () => {
    expect(styles).toContain("#claude-usage-bar-root.cub-theme-light .cub-weekly-learning-tooltip");
    expect(styles).toContain("#claude-usage-bar-root.cub-theme-light .cub-review-banner");
    expect(styles).toContain("#claude-usage-bar-root.cub-theme-light .cub-review-banner-dismiss:hover");
  });

  it("strengthens the light-mode message rail instead of letting it blend into the page", () => {
    expect(styles).toContain("background: rgb(80 78 72 / 58%);");
    expect(styles).toContain("box-shadow: 0 0 0 1px rgb(255 255 255 / 80%);");
    expect(styles).toContain(".cub-message-rail--light .cub-message-rail-marker:hover::before");
  });

  it("uses the approved light palette for the toolbar popup", () => {
    expect(popupStyles).toContain("background: rgb(32 32 30);");
    expect(popupStyles).toContain("border-radius: 12px;");
    expect(popupStyles).toContain("body.cub-popup-light");
    expect(popupStyles).toContain("background: rgb(250 249 247);");
    expect(popupStyles).toContain("color: rgb(40 40 38);");
    expect(popupStyles).toContain("color: rgb(120 118 112);");
    expect(popupStyles).toContain("border-bottom-color: rgb(0 0 0 / 10%);");
  });

  it("detects Claude theme from explicit signals, computed UI color, then system preference", () => {
    expect(contentScript).toContain("const readComputedLightMode = (): boolean | null =>");
    expect(contentScript).toContain("const readElementLightMode = (element: Element | null): boolean | null =>");
    expect(contentScript).toContain("const computed = readComputedLightMode();");
    expect(contentScript).toContain('window.matchMedia("(prefers-color-scheme: dark)")');
    expect(contentScript).toContain("let lastSyncedTheme: \"light\" | \"dark\" | null = null;");
    expect(contentScript).toContain("[STORAGE_KEYS.detectedTheme]: light ? \"light\" : \"dark\"");
  });

  it("keeps the message rail in light mode when the rail is created after theme sync", () => {
    expect(messageRailScript).toContain("let currentThemeIsLight = false;");
    expect(messageRailScript).toContain("currentThemeIsLight = isLight;");
    expect(messageRailScript).toContain('railEl.classList.toggle("cub-message-rail--light", currentThemeIsLight);');
  });

  it("re-syncs theme after delayed overlay elements are mounted or refreshed", () => {
    expect(contentScript).toContain("tickMessageRail();\n    syncTheme();");
    expect(contentScript).toContain("render();\n  syncTheme();");
  });

  it("watches live Claude theme changes beyond the html element", () => {
    expect(contentScript).toContain("const THEME_SYNC_INTERVAL_MS = 500;");
    expect(contentScript).toContain("window.setInterval(syncTheme, THEME_SYNC_INTERVAL_MS);");
    expect(contentScript).toContain('attributeFilter: ["class", "data-theme", "data-color-scheme", "style"]');
    expect(contentScript).toContain("themeObserver.observe(document.body");
    expect(contentScript).toContain("observer.observe(document.documentElement, { attributes: true");
  });

  it("applies the real message rail light class to the tour's fake rail", () => {
    expect(onboardingTourScript).toContain('light ? "cub-tour-demo-rail cub-message-rail--light" : "cub-tour-demo-rail"');
    expect(onboardingTourScript).toContain("const THEME_SYNC_INTERVAL_MS = 500;");
    expect(onboardingTourScript).toContain("window.setInterval(() => setLight(isLightTheme()), THEME_SYNC_INTERVAL_MS);");
  });

  it("keeps the usage tooltip hoverable after leaving the meter bounds", () => {
    expect(styles).toContain(".cub-usage-tooltip:hover {");
    expect(styles).toContain("visibility: hidden;");
    expect(styles).toContain("visibility: visible;");
  });

  it("forces the usage details panel visible during walkthrough steps that target it", () => {
    expect(styles).toContain("body.cub-tour-bar-open .cub-usage-tooltip {\n  opacity: 1 !important;\n  visibility: visible !important;");
  });

  it("only auto-shows the onboarding tour on Claude's new-chat route", () => {
    expect(contentScript).toContain("const isNewChatPage = (): boolean => location.pathname === \"/new\" || location.pathname === \"/new/\";");
    expect(contentScript).toContain("storageState.settings.hasSeenTour === false && isNewChatPage()");
  });

  it("uses 5-hour session estimates on Claude design routes", () => {
    expect(contentScript).toContain("location.pathname === \"/designs\"");
    expect(contentScript).toContain("location.pathname.startsWith(\"/designs/\")");
    expect(contentScript).toContain("barMetric: \"session\" as const");
    expect(contentScript).toContain("showWheel: false");
    expect(contentScript).toContain("showClipboard: false");
    expect(contentScript).toContain("ringTarget: \"hidden\" as const");
  });
});
