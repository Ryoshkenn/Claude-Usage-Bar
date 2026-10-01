import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tickMessageRail } from "../content/messageRail";

// jsdom lacks IntersectionObserver / rAF; the rail only needs them to exist.
class NoopIO {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const RAIL = "#claude-user-message-rail";
let nextTop = 0;
let convoSeq = 0;

// The rail holds module-level state across ticks (by design). Each test gets a
// unique conversation path so the conversation-change reset gives it a clean list.
const newConversation = (): void => {
  window.history.pushState({}, "", `/chat/conversation-${++convoSeq}`);
};

// Append a user message whose vertical position increases with insertion order,
// so the rail's position-based ordering is deterministic under jsdom (which
// otherwise reports every rect as zero).
const addUserMessage = (text: string): HTMLElement => {
  const el = document.createElement("div");
  el.setAttribute("data-testid", "user-message");
  el.textContent = text;
  const top = (nextTop += 100);
  el.getBoundingClientRect = () =>
    ({ top, height: 50, bottom: top + 50, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
  document.body.appendChild(el);
  return el;
};

const markerCount = (): number => document.querySelectorAll(`${RAIL} .cub-message-rail-marker`).length;

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", NoopIO);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  newConversation();
  document.body.innerHTML = "";
  nextTop = 0;
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("message rail", () => {
  it("keeps a marker for every message seen, even after it is virtualized out of the DOM", () => {
    const a = addUserMessage("first");
    const b = addUserMessage("second");
    const c = addUserMessage("third");
    const d = addUserMessage("fourth");
    tickMessageRail();
    expect(markerCount()).toBe(4);

    // Simulate claude.ai unmounting the middle messages as the user scrolls.
    b.remove();
    c.remove();
    tickMessageRail();

    // They must NOT be dropped from the rail — this is the bug being fixed.
    expect(markerCount()).toBe(4);

    // The still-mounted messages keep working; the list stays complete.
    a.remove();
    d.remove();
    addUserMessage("fifth");
    tickMessageRail();
    expect(markerCount()).toBe(5);
  });

  it("does not show a rail below the minimum message count", () => {
    addUserMessage("only one");
    tickMessageRail();
    expect(document.querySelector(RAIL)).toBeNull();
  });

  it("resets the accumulated list when the conversation changes", () => {
    addUserMessage("a");
    addUserMessage("b");
    addUserMessage("c");
    tickMessageRail();
    expect(markerCount()).toBe(3);

    // Navigate to a different chat and render a fresh, shorter transcript.
    newConversation();
    document.body.innerHTML = "";
    nextTop = 0;
    addUserMessage("x");
    addUserMessage("y");
    tickMessageRail();

    // Old conversation's markers must be gone, not carried over.
    expect(markerCount()).toBe(2);
  });
});
