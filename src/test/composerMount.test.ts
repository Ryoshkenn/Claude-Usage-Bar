import { afterEach, describe, expect, it } from "vitest";
import {
  findComposer,
  findComposerControls,
  findComposerInsertionPoint,
} from "../content/composerMount";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("composer mounting", () => {
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
});
