import type { PromptEntry } from "../shared/types";

// The Prompt Clipboard is being retired in favour of Claude's own skills. Its
// "Convert my prompts to skills" button drafts this message in a new chat: the
// saved prompts in a plain, tagged layout, plus instructions asking Claude to
// turn them into skills and show the user how skills work. It's only drafted —
// the user reads it and sends it themselves.

// "sv" → "Swedish", for asking the reply in the language the user runs Claude in.
const languageName = (tag: string): string => {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
};

const formatPrompt = (prompt: PromptEntry): string =>
  [
    "<prompt>",
    `<title>${prompt.title.trim() || "Untitled"}</title>`,
    ...(prompt.tags.length > 0 ? [`<tags>${prompt.tags.join(", ")}</tags>`] : []),
    "<text>",
    prompt.content.trim(),
    "</text>",
    "</prompt>",
  ].join("\n");

export const buildSkillsConversionPrompt = (prompts: PromptEntry[], languageTag?: string): string => {
  const tag = languageTag?.trim();
  const replyLanguage =
    tag && !/^en\b/i.test(tag) ? [`Please reply in ${languageName(tag)}, the language I use Claude in.`, ""] : [];
  return [
    "I've been saving reusable prompts in the Prompt Clipboard of the Claude Usage Bar extension, which is being retired. Please help me turn them into Claude skills.",
    "",
    "1. Make a skill from each prompt below, or one skill from a few prompts that clearly belong together. Give each a short name and a description that says when it should be used, and put the prompt's instructions in its SKILL.md, tidied up where that helps but doing the same job. Package each skill as a file I can download.",
    "2. Then explain briefly, for someone new to skills:",
    "   - what a skill is, and how it differs from a saved prompt;",
    "   - how to add these to my account (in Claude, under Customize → Skills);",
    "   - how to use them: type / in the message box to pick one, or just ask for the task and Claude uses a matching skill on its own.",
    "",
    ...replyLanguage,
    `My ${prompts.length === 1 ? "prompt" : `${prompts.length} prompts`}:`,
    "",
    prompts.map(formatPrompt).join("\n\n"),
  ].join("\n");
};
