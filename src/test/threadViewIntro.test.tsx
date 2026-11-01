import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { threadIntroAction, ThreadViewIntro } from "../content/ThreadViewIntro";

const settings = (partial: Partial<{ hasSeenTour: boolean; seenThreadViewIntro: boolean; threadSidebar: boolean }>) => ({
  hasSeenTour: true,
  seenThreadViewIntro: false,
  threadSidebar: false,
  ...partial,
});

describe("threadIntroAction", () => {
  it("shows the card once to someone who had Usage Bar before the thread view", () => {
    expect(threadIntroAction(settings({}), true)).toBe("show");
    // Seen once: never again.
    expect(threadIntroAction(settings({ seenThreadViewIntro: true }), true)).toBe("none");
  });

  it("leaves new installs to the tour, which covers the thread view", () => {
    expect(threadIntroAction(settings({ hasSeenTour: false }), true)).toBe("none");
  });

  it("marks it seen without showing it when the view is already on", () => {
    expect(threadIntroAction(settings({ threadSidebar: true }), true)).toBe("mark-seen");
  });

  it("waits for a background tab to be looked at", () => {
    expect(threadIntroAction(settings({}), false)).toBe("none");
  });
});

describe("ThreadViewIntro", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("offers the thread view with the tour's preview, and answers with the choice", () => {
    const onClose = vi.fn();
    render(<ThreadViewIntro onClose={onClose} />);
    const dialog = screen.getByRole("dialog", { name: "The thread view is here" });
    expect(dialog.querySelector(".cub-tour-thread-preview")).not.toBeNull();
    const accept = screen.getByRole("button", { name: "Use this" });
    expect(document.activeElement).toBe(accept);

    fireEvent.click(screen.getByRole("button", { name: "No thanks" }));
    expect(onClose).toHaveBeenLastCalledWith(false);
    fireEvent.click(accept);
    expect(onClose).toHaveBeenLastCalledWith(true);
  });

  it("closes on Escape without changing anything", () => {
    const onClose = vi.fn();
    render(<ThreadViewIntro onClose={onClose} />);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledWith();
  });
});
