import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PromptClipboard } from "../content/PromptClipboard";
import { buildSkillsConversionPrompt } from "../content/skillsConversion";
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

  it("shows the retirement notice and drafts the skills request in a new chat", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    history.replaceState(null, "", "/chat/abc");
    document.body.innerHTML = `
      <a href="/new" data-row-main-button="">New</a>
      <div contenteditable="true" role="textbox" id="old-editor"></div>`;
    // Claude's router: the New link swaps in /new and a fresh composer.
    document.querySelector("a")!.addEventListener("click", (event) => {
      event.preventDefault();
      history.pushState(null, "", "/new");
      document.getElementById("old-editor")!.remove();
      document.body.insertAdjacentHTML("beforeend", '<div contenteditable="true" role="textbox" id="new-editor"></div>');
    });
    const inserted: { target: string | undefined; text: string }[] = [];
    Object.defineProperty(document, "execCommand", {
      value: vi.fn((_command: string, _ui: boolean, text: string) => {
        inserted.push({ target: document.activeElement?.id, text });
        return true;
      }),
      configurable: true,
    });

    render(<PromptClipboard />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Prompt clipboard" }));
    });
    expect(screen.getByRole("note").textContent).toContain("Prompt Clipboard is being retired");
    expect(screen.getByRole("note").textContent).toContain("P.S. Skills can do the same and more.");

    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Convert my prompts to skills" }));
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(location.pathname).toBe("/new");
    expect(inserted).toEqual([
      { target: "new-editor", text: buildSkillsConversionPrompt([PROMPT], document.documentElement.lang) },
    ]);
    vi.useRealTimers();
  });
});

describe("skills conversion draft", () => {
  const second: PromptEntry = { ...PROMPT, id: "p2", title: "", content: "  Fix my code.\nKeep the style.  ", tags: ["coding", "debug"] };

  it("lays out every prompt and asks Claude to make skills and explain them", () => {
    const draft = buildSkillsConversionPrompt([PROMPT, second], "en-US");
    expect(draft).toContain("turn them into Claude skills");
    expect(draft).toContain("what a skill is");
    expect(draft).toContain("Customize → Skills");
    expect(draft).toContain("type / in the message box");
    expect(draft).toContain("My 2 prompts:");
    expect(draft).toContain("<prompt>\n<title>Summary</title>\n<text>\nSummarize this in one line.\n</text>\n</prompt>");
    expect(draft).toContain("<title>Untitled</title>\n<tags>coding, debug</tags>\n<text>\nFix my code.\nKeep the style.\n</text>");
    expect(draft).not.toContain("Please reply in");
  });

  it("asks for the reply in the language Claude is set to", () => {
    expect(buildSkillsConversionPrompt([PROMPT], "sv")).toContain("Please reply in Swedish, the language I use Claude in.");
    expect(buildSkillsConversionPrompt([PROMPT], "sv")).toContain("My prompt:");
  });
});
