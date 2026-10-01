import { afterEach, describe, expect, it } from "vitest";
import {
  readClaudeDomSnapshot,
  readComposerEffortLevel,
  readSelectedModelLabel,
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

  // Live claude.ai markup (Sept 2026): the effort submenu uses
  // [role="menuitemradio"][data-effort-id][aria-checked], no testids, no switch.
  const effortSubmenu = (checkedId: string | null): string => {
    const options = ["low", "medium", "high", "xhigh", "max"]
      .map(
        (id) =>
          `<div role="menuitemradio" data-effort-id="${id}" aria-checked="${id === checkedId}"><span>${id}</span></div>`,
      )
      .join("");
    return `<div role="menu">${options}</div>`;
  };

  it("reads the checked data-effort-id radio (current live markup)", () => {
    document.body.innerHTML = effortSubmenu("low");
    expect(readThinkingLevel()).toBe("low");
    document.body.innerHTML = effortSubmenu("medium");
    expect(readThinkingLevel()).toBe("medium");
    document.body.innerHTML = effortSubmenu("high");
    expect(readThinkingLevel()).toBe("high");
  });

  it("maps data-effort-id xhigh to 'extra' and max to 'max'", () => {
    document.body.innerHTML = effortSubmenu("xhigh");
    expect(readThinkingLevel()).toBe("extra");
    document.body.innerHTML = effortSubmenu("max");
    expect(readThinkingLevel()).toBe("max");
  });

  it("returns undefined when no effort radio is checked", () => {
    document.body.innerHTML = effortSubmenu(null);
    expect(readThinkingLevel()).toBeUndefined();
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

  it("reads the new-style Opus 5 Low control and bare Haiku 4.5", () => {
    document.body.innerHTML = composer("Opus 5", "Low");
    expect(readComposerEffortLevel()).toBe("low");
    // Haiku has no effort levels — bare label, no suffix.
    document.body.innerHTML = composer("Haiku 4.5");
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

describe("readSelectedModelLabel", () => {
  it("reads the aria-label when textContent carries no model (Model: Opus 5 Low)", () => {
    document.body.innerHTML = `<button data-testid="model-selector-dropdown" aria-haspopup="menu" aria-label="Model: Opus 5 Low"></button>`;
    expect(readSelectedModelLabel("")).toBe("Opus 5");
  });

  it("detects live Opus 5 / Sonnet 5 / Fable 5.1 / Haiku 4.5 labels", () => {
    for (const label of ["Opus 5", "Sonnet 5", "Fable 5.1", "Haiku 4.5"]) {
      document.body.innerHTML = `<button data-testid="model-selector-dropdown">${label}</button>`;
      expect(readSelectedModelLabel("")).toBe(label);
    }
  });
});

describe("readDomAttachments", () => {
  it("extracts pdf tiles (filename from img alt, no size signal)", () => {
    document.body.innerHTML = `
      <div data-testid="user-message"><p>read these</p></div>
      <div data-cds="MessageAttachments">
        <div data-testid="file-thumbnail">
          <button><img alt="Methods Used to Establish Authoritarian States (1).pdf" src="/api/org/files/uuid-1/thumbnail"></button>
          <div><p class="uppercase">pdf</p></div>
        </div>
      </div>
    `;
    expect(readClaudeDomSnapshot().attachments).toEqual([
      { fileName: "Methods Used to Establish Authoritarian States (1).pdf", kind: "pdf" },
    ]);
  });

  it("extracts txt cards (filename from title, kind from badge, line count)", () => {
    document.body.innerHTML = `
      <div data-testid="user-message"><p>see attached</p></div>
      <div data-cds="MessageAttachments">
        <div data-cds="MessageAttachmentsFile" data-testid="file-thumbnail">
          <span data-cds="CardLink" role="button" title="Hashimoto-LegacyKorematsu-Condensed-2000-Words.txt"></span>
          <span title="Hashimoto-LegacyKorematsu-Condensed-2000-Words.txt">truncated…</span>
          <span class="truncate">67 lines</span>
          <span data-cds="Badge">TXT</span>
        </div>
      </div>
    `;
    expect(readClaudeDomSnapshot().attachments).toEqual([
      {
        fileName: "Hashimoto-LegacyKorematsu-Condensed-2000-Words.txt",
        kind: "txt",
        lineCount: 67,
      },
    ]);
  });

  it("ignores composer-staged files inside the form", () => {
    document.body.innerHTML = `
      <form><div data-testid="file-thumbnail"><img alt="draft.pdf" src="/thumb"></div></form>
      <div data-testid="user-message"><p>hi</p></div>
    `;
    expect(readClaudeDomSnapshot().attachments).toEqual([]);
  });

  it("returns no attachments for a text-only chat", () => {
    document.body.innerHTML = `<div data-testid="user-message"><p>hi</p></div>`;
    expect(readClaudeDomSnapshot().attachments).toEqual([]);
  });

  it("extracts image tiles (filename from sr-only, intrinsic dims from the resource)", () => {
    document.body.innerHTML = `
      <div data-testid="user-message"><p>what is this</p></div>
      <div data-cds="MessageAttachments">
        <div data-cds="MessageAttachmentsImage" data-testid="file-thumbnail">
          <button><img alt="" src="/api/org/files/uuid/preview"><span class="sr-only">IMG_2198.jpeg</span></button>
        </div>
      </div>
    `;
    // jsdom never loads images, so stub the intrinsic (full-resource) size —
    // live this reads 952×1269 while the tile renders at 120×120.
    const img = document.querySelector("img")!;
    Object.defineProperty(img, "naturalWidth", { value: 952 });
    Object.defineProperty(img, "naturalHeight", { value: 1269 });
    expect(readClaudeDomSnapshot().attachments).toEqual([
      { fileName: "IMG_2198.jpeg", kind: "jpeg", imageWidth: 952, imageHeight: 1269 },
    ]);
  });
});
