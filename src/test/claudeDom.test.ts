import { afterEach, describe, expect, it } from "vitest";
import {
  readComposerEffortLevel,
  readThinkingEnabled,
  readThinkingLevel,
  resolveEffectiveThinkingLevel,
} from "../content/claudeDom";

// Minimal reproductions of claude.ai's effort menu markup (see the real snippet
// in claudeDom.ts). The switch + radios only exist while the menu is open.
const effortRadio = (testid: string, checked: boolean): string =>
  `<div role="menuitemradio" data-testid="effort-option-${testid}" aria-checked="${checked}"><span>${testid}</span></div>`;

const thinkingSwitch = (checked: boolean): string =>
  `<button role="switch" aria-label="Thinking" aria-checked="${checked}">toggle</button>`;

const effortMenu = (checkedTestid: string | null, switchOn = true): string => {
  const options = ["low", "medium", "high", "xhigh", "max"]
    .map((id) => effortRadio(id, id === checkedTestid))
    .join("");
  return `<div role="menu">${thinkingSwitch(switchOn)}${options}</div>`;
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("readThinkingLevel", () => {
  it("returns undefined when the effort menu is closed (nothing in the DOM)", () => {
    document.body.innerHTML = "<div>composer</div>";
    expect(readThinkingLevel()).toBeUndefined();
  });

  it("returns 'off' when the Thinking switch is toggled off", () => {
    document.body.innerHTML = effortMenu("high", false);
    expect(readThinkingLevel()).toBe("off");
  });

  it("maps the checked effort radio to a level", () => {
    document.body.innerHTML = effortMenu("low");
    expect(readThinkingLevel()).toBe("low");
  });

  it("maps the xhigh radio to 'extra' and max to 'max'", () => {
    document.body.innerHTML = effortMenu("xhigh");
    expect(readThinkingLevel()).toBe("extra");
    document.body.innerHTML = effortMenu("max");
    expect(readThinkingLevel()).toBe("max");
  });
});

describe("readThinkingEnabled", () => {
  it("returns undefined when the switch isn't in the DOM (menu closed)", () => {
    document.body.innerHTML = "<div>composer</div>";
    expect(readThinkingEnabled()).toBeUndefined();
  });

  it("returns true when the switch is on, regardless of the checked effort radio", () => {
    document.body.innerHTML = effortMenu("max", true);
    expect(readThinkingEnabled()).toBe(true);
  });

  it("returns false when the switch is off, even while effort radios still show a level", () => {
    document.body.innerHTML = effortMenu("max", false);
    expect(readThinkingEnabled()).toBe(false);
  });
});

describe("readComposerEffortLevel", () => {
  // The model switcher always shows model + effort, e.g. "Opus 4.8<span> Max</span>".
  const composer = (model: string, suffix?: string): string =>
    `<button data-testid="model-selector-dropdown">${model}${suffix ? `<span class="ml-1 text-text-500"> ${suffix}</span>` : ""}</button>`;

  it("reads the effort level trailing the model name", () => {
    document.body.innerHTML = composer("Opus 4.8", "Max");
    expect(readComposerEffortLevel()).toBe("max");
  });

  it("maps each visible effort label to its level", () => {
    for (const [label, level] of [
      ["Low", "low"],
      ["Medium", "medium"],
      ["High", "high"],
      ["Extra", "extra"],
      ["Max", "max"],
    ] as const) {
      document.body.innerHTML = composer("Sonnet 4.6", label);
      expect(readComposerEffortLevel()).toBe(level);
    }
  });

  it("returns undefined when no effort suffix trails the model (off looks the same)", () => {
    document.body.innerHTML = composer("Opus 4.8");
    expect(readComposerEffortLevel()).toBeUndefined();
  });

  it("returns undefined when no model control is present", () => {
    document.body.innerHTML = "<div>composer</div>";
    expect(readComposerEffortLevel()).toBeUndefined();
  });
});

describe("resolveEffectiveThinkingLevel", () => {
  it("treats the effort-menu switch as the on/off authority", () => {
    // Switch off → effective off, regardless of the level the composer still shows.
    expect(resolveEffectiveThinkingLevel("off", "max", undefined)).toEqual({ level: "off", enabled: false });
    // A menu radio level means the switch is on → that level, enabled true.
    expect(resolveEffectiveThinkingLevel("high", "max", undefined)).toEqual({ level: "high", enabled: true });
  });

  it("uses the composer level when the menu is closed but thinking is known on", () => {
    expect(resolveEffectiveThinkingLevel(undefined, "max", true)).toEqual({ level: "max", enabled: true });
  });

  it("stays off when the switch was last seen off, even as the composer shows a level", () => {
    expect(resolveEffectiveThinkingLevel(undefined, "max", false)).toEqual({ level: "off", enabled: false });
  });

  it("conservatively assumes on (uses the composer level) until the switch is first seen", () => {
    expect(resolveEffectiveThinkingLevel(undefined, "low", undefined)).toEqual({ level: "low", enabled: undefined });
  });

  it("returns an undefined level (keep last known) when nothing is readable", () => {
    expect(resolveEffectiveThinkingLevel(undefined, undefined, undefined)).toEqual({
      level: undefined,
      enabled: undefined,
    });
  });
});
