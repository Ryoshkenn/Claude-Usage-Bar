import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PromptClipboard } from "../content/PromptClipboard";
import { STORAGE_KEYS } from "../shared/constants";
import type { PromptEntry } from "../shared/types";

const PROMPT: PromptEntry = {
  id: "p1",
  title: "Summary",
  content: "Summarize this in one line.",
  tags: [],
  pinned: false,
  createdAt: 1,
  updatedAt: 1,
};

beforeEach(() => {
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: vi.fn(async () => ({ [STORAGE_KEYS.prompts]: [PROMPT] })),
        set: vi.fn(async () => undefined),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: { id: "test", lastError: undefined },
  });
  document.body.innerHTML = '<div contenteditable="true" role="textbox"></div>';
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("prompt clipboard", () => {
  it("inserts a prompt once from its Insert button", async () => {
    // jsdom has no execCommand; stand in for the editor accepting the text.
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { value: execCommand, configurable: true });

    render(<PromptClipboard />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Prompt clipboard" }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Insert" }));
    });

    // The card itself also inserts on click; Insert must not trigger both.
    expect(execCommand).toHaveBeenCalledTimes(1);
    expect(execCommand).toHaveBeenCalledWith("insertText", false, PROMPT.content);
  });
});
