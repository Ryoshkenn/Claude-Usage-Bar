import { afterEach, describe, expect, it, vi } from "vitest";
import {
  findComposer,
  findComposerControls,
  findComposerInsertionPoint,
  findCoworkControlsAnchor,
  findChinSlot,
  findLargestGap,
  measureCardActionStrip,
  findDisclaimerMount,
  findNewChatActions,
  findNewChatComposerCard,
  findNewChatComposerSurface,
  findNewChatInsertionPoint,
} from "../content/composerMount";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("composer mounting", () => {
  it("targets the disclaimer row and leaves the outer flex container as the mount", () => {
    document.body.innerHTML = `
      <div class="flex min-w-0 items-center text-muted flex-1" data-testid="disclaimer-mount">
        <div role="note" data-disclaimer="true" class="text-muted [&amp;_a]:text-inherit text-left @[24rem]:ps-md">
          <a href="https://support.anthropic.com/en/articles/8525154-claude-is-providing-incorrect-or-misleading-responses-what-s-going-on">
            Claude is AI and can make mistakes.
          </a>
        </div>
      </div>
    `;

    expect(findDisclaimerMount()).toBe(document.querySelector('[data-testid="disclaimer-mount"]'));
  });

  describe("chin slot", () => {
    it("descends single-child wrappers to the controls row", () => {
      document.body.innerHTML = `
        <div data-cds="ChatComposer" data-testid="composer">
          <div data-cds="ChatComposerChin"><div><div>
            <div data-testid="row"><div><button>+</button></div><div class="ms-auto"><button>Sonnet</button></div></div>
          </div></div></div>
        </div>
      `;

      expect(findChinSlot()).toEqual({
        composer: document.querySelector('[data-testid="composer"]'),
        row: document.querySelector('[data-testid="row"]'),
      });
    });

    it("returns null without a chin inside a composer", () => {
      document.body.innerHTML = `<div data-cds="ChatComposerChin"><button>+</button></div>`;
      expect(findChinSlot()).toBeNull();
    });

    it("finds the widest free stretch between controls", () => {
      // + and mic on the left, model + Auto (overlapping hidden toggle) on the right.
      const spans = [
        { left: 35, right: 59 },
        { left: 63, right: 104 },
        { left: 206, right: 342 },
        { left: 344, right: 392 },
        { left: 340, right: 400 },
      ];
      expect(findLargestGap(28, 401, spans)).toEqual({ left: 104, right: 206 });
    });

    it("measures the /new in-card action strip between + and dictate", () => {
      document.body.innerHTML = `
        <div data-cds="ChatComposer">
          <div data-testid="wrapper" style="padding-bottom: 34px">
            <div data-cds="ChatComposerEditor"></div>
          </div>
          <button data-testid="add">+</button>
          <button data-testid="dictate">mic</button>
          <div data-cds="ChatComposerChin"><button data-testid="project">Project</button></div>
        </div>
      `;
      const rects: Record<string, [number, number, number, number]> = {
        wrapper: [235, 431, 859, 518],
        add: [235, 486, 267, 518],
        dictate: [772, 486, 804, 518],
        project: [235, 534, 306, 558],
      };
      for (const [testId, [left, top, right, bottom]] of Object.entries(rects)) {
        const el = document.querySelector(`[data-testid="${testId}"]`) as HTMLElement;
        vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
          left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}),
        } as DOMRect);
      }

      const composer = document.querySelector('[data-cds="ChatComposer"]') as HTMLElement;
      expect(measureCardActionStrip(composer)).toEqual({ top: 484, height: 34, gap: { left: 267, right: 772 } });
    });

    it("reports no strip when the editor wrapper reserves no bottom padding", () => {
      document.body.innerHTML = `
        <div data-cds="ChatComposer"><div><div data-cds="ChatComposerEditor"></div></div></div>
      `;
      expect(measureCardActionStrip(document.querySelector('[data-cds="ChatComposer"]') as HTMLElement)).toBeNull();
    });

    it("treats the row edges as gap bounds", () => {
      expect(findLargestGap(0, 500, [{ left: 0, right: 50 }])).toEqual({ left: 50, right: 500 });
      expect(findLargestGap(0, 100, [])).toEqual({ left: 0, right: 100 });
      expect(findLargestGap(0, 100, [{ left: 0, right: 100 }])).toBeNull();
    });
  });

  it("targets Claude's current composer toolbar row from the add-files button", () => {
    document.body.innerHTML = `
      <form>
        <div class="relative flex gap-2 w-full items-center" data-testid="current-toolbar">
          <div class="relative shrink-0 flex items-center gap-1">
            <button type="button" aria-label="Add files, connectors, and more"></button>
          </div>
          <div class="flex flex-row items-center min-w-0 gap-1"></div>
          <div class="grow"></div>
          <div class="flex items-center gap-2 min-w-0 transition-all duration-200 ease-out"></div>
          <button aria-label="Press and hold to record"></button>
          <button aria-label="Use voice mode"></button>
        </div>
      </form>
    `;

    const toolbar = document.querySelector<HTMLElement>('[data-testid="current-toolbar"]');

    expect(findComposerControls()).toBe(toolbar);
    expect(findComposer()).toBe(toolbar);
    expect(findComposerInsertionPoint(toolbar!)).toBe(toolbar!.children[1]);
  });

  it("keeps supporting Claude's previous composer toolbar row", () => {
    document.body.innerHTML = `
      <form>
        <div class="relative flex-1 flex items-center shrink min-w-0 gap-1" data-testid="legacy-toolbar">
          <div>
            <button type="button" aria-label="Add files, connectors, and more"></button>
          </div>
          <div></div>
        </div>
      </form>
    `;

    const toolbar = document.querySelector<HTMLElement>('[data-testid="legacy-toolbar"]');

    expect(findComposerControls()).toBe(toolbar);
    expect(findComposer()).toBe(toolbar);
  });

  it("falls back to the chat form when toolbar controls are unavailable", () => {
    document.body.innerHTML = `
      <form data-testid="chat-form">
        <div contenteditable="true" role="textbox"></div>
        <button type="submit" aria-label="Send message"></button>
      </form>
    `;

    expect(findComposer()).toBe(document.querySelector('[data-testid="chat-form"]'));
  });

  it("ignores conversation preferences forms", () => {
    document.body.innerHTML = `
      <form data-testid="preferences-form">
        <textarea id="conversation-preferences"></textarea>
        <button type="submit" aria-label="Send preferences"></button>
      </form>
    `;

    expect(findComposer()).toBeNull();
  });

  it("targets a row directly below the /new composer card", () => {
    document.body.innerHTML = `
      <div data-testid="composer-wrap">
        <div data-testid="composer-card">
          <div data-cds="ChatComposerEditor"></div>
          <div data-cds="ChatComposerActions" class="contents">
            <div class="absolute bottom-0 left-0"></div>
            <div class="contents"></div>
          </div>
          <div class="absolute bottom-0 right-0" data-testid="right-actions"></div>
        </div>
        <div data-testid="below-card"></div>
      </div>
    `;

    const card = document.querySelector<HTMLElement>('[data-testid="composer-card"]');
    expect(findNewChatActions()).toBe(
      document.querySelector('div[data-cds="ChatComposerActions"]'),
    );
    expect(findNewChatComposerCard()).toBe(card);

    const insertion = findNewChatInsertionPoint();
    expect(insertion?.parent).toBe(document.querySelector('[data-testid="composer-wrap"]'));
    expect(insertion?.anchor).toBe(document.querySelector('[data-testid="below-card"]'));
  });

  it("returns null for the /new slot when the actions wrapper is missing", () => {
    document.body.innerHTML = `<div><div class="absolute bottom-0 right-0"></div></div>`;

    expect(findNewChatActions()).toBeNull();
    expect(findNewChatComposerCard()).toBeNull();
    expect(findNewChatInsertionPoint()).toBeNull();
  });

  it("returns null for the /new slot when the parent has no composer editor", () => {
    document.body.innerHTML = `
      <div data-testid="not-a-card">
        <div data-cds="ChatComposerActions" class="contents"></div>
      </div>
    `;

    expect(findNewChatComposerCard()).toBeNull();
    expect(findNewChatInsertionPoint()).toBeNull();
  });

  // Live claude.ai/new shape: the bar must mount OUTSIDE the bordered surface
  // (below it), never inside it — inside placement stretches the composer.
  it("targets a row below the rounded composer surface, not inside it", () => {
    document.body.innerHTML = `
      <div data-testid="composer-stack" style="display: flex; flex-direction: column;">
        <div data-testid="composer-surface" class="bg-surface-3 rounded-composer">
          <div data-testid="composer-card" class="relative w-full">
            <div data-cds="ChatComposerEditor"></div>
            <div data-cds="ChatComposerActions" class="contents"></div>
          </div>
        </div>
        <div data-testid="chin-slot"></div>
      </div>
    `;

    expect(findNewChatComposerSurface()).toBe(document.querySelector('[data-testid="composer-surface"]'));
    const insertion = findNewChatInsertionPoint();
    expect(insertion?.parent).toBe(document.querySelector('[data-testid="composer-stack"]'));
    expect(insertion?.anchor).toBe(document.querySelector('[data-testid="chin-slot"]'));
  });

  describe("cowork chin-trail rows", () => {
    const coworkRow = (leftButtons: string) => `
      <div data-size="xs" class="flex min-h-control items-center justify-between" data-testid="chin-row">
        <div class="flex items-center self-start" data-testid="left-controls">
          <div>${leftButtons}</div>
        </div>
        <div class="ms-auto flex min-w-0 items-center gap-1" data-testid="right-group">
          <div class="group/chin-trail grid">
            <div>
              <div role="note" data-disclaimer="true" style="opacity: 0;">Claude is AI and can make mistakes.</div>
            </div>
          </div>
          <div data-testid="model-selector">Opus 5 High</div>
        </div>
      </div>
    `;

    it("keeps the regular disclaimer mount on cowork rows (same mount path as chats)", () => {
      document.body.innerHTML = coworkRow(`<button data-cds="Button" type="button">Skip</button>`);

      const disclaimer = document.querySelector('[data-disclaimer="true"]');
      expect(findDisclaimerMount()).toBe(disclaimer?.parentElement ?? null);
    });

    it("anchors to the left Skip controls group instead of the right disclaimer", () => {
      document.body.innerHTML = coworkRow(`<button data-cds="Button" type="button">Skip</button>`);

      expect(findCoworkControlsAnchor(findDisclaimerMount())).toBe(
        document.querySelector('[data-testid="left-controls"]'),
      );
    });

    it("anchors when an Approve button is present alongside Skip", () => {
      document.body.innerHTML = coworkRow(
        `<button data-cds="Button" type="button">Approve</button><button data-cds="Button" type="button">Skip</button>`,
      );

      expect(findCoworkControlsAnchor(findDisclaimerMount())).toBe(
        document.querySelector('[data-testid="left-controls"]'),
      );
    });

    it("returns null on regular chats with no Skip/Approve controls", () => {
      document.body.innerHTML = `
        <div class="flex min-w-0 items-center text-muted flex-1" data-testid="disclaimer-mount">
          <div role="note" data-disclaimer="true">Claude is AI and can make mistakes.</div>
        </div>
      `;

      expect(findCoworkControlsAnchor(findDisclaimerMount())).toBeNull();
    });

    it("returns null when the row has no Skip/Approve button", () => {
      document.body.innerHTML = coworkRow(`<button data-cds="Button" type="button">Stop</button>`);

      expect(findCoworkControlsAnchor(findDisclaimerMount())).toBeNull();
    });

    it("returns null when the control sits in the same container as the disclaimer", () => {
      document.body.innerHTML = `
        <div data-size="xs" class="flex min-h-control items-center justify-between">
          <div class="flex items-center self-start"></div>
          <div class="ms-auto flex min-w-0 items-center gap-1">
            <div class="group/chin-trail grid">
              <div>
                <div role="note" data-disclaimer="true">Claude is AI and can make mistakes.</div>
                <button data-cds="Button" type="button">Skip</button>
              </div>
            </div>
          </div>
        </div>
      `;

      expect(findCoworkControlsAnchor(findDisclaimerMount())).toBeNull();
    });

    it("returns null for null or detached mounts", () => {
      expect(findCoworkControlsAnchor(null)).toBeNull();
      document.body.innerHTML = coworkRow(`<button data-cds="Button" type="button">Skip</button>`);
      const mount = findDisclaimerMount()!;
      mount.remove();
      expect(findCoworkControlsAnchor(mount)).toBeNull();
    });
  });
});
