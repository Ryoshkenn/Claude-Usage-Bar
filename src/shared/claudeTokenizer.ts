import { Tokenizer } from "@huggingface/tokenizers";
import claudeTokenizerConfig from "./claude-tokenizer-config.json";
import claudeTokenizerJson from "./claude-tokenizer.json";

const ESTIMATED_CHARACTERS_PER_TOKEN = 4;

let tokenizer: Tokenizer | null = null;

export const normalizeTokenizationText = (text: string): string => text.replace(/\s+/g, " ").trim();

const getTokenizer = (): Tokenizer => {
  if (!tokenizer) {
    tokenizer = new Tokenizer(claudeTokenizerJson, claudeTokenizerConfig);
  }

  return tokenizer;
};

const fallbackTokenCount = (text: string): number => Math.ceil(text.length / ESTIMATED_CHARACTERS_PER_TOKEN);

export const countClaudeTokens = (text: string): number => {
  // Blank messages carry no tokens. Otherwise count the raw text as-is:
  // indentation and line breaks in code are real tokens, so whitespace is
  // deliberately NOT collapsed here (collapsing undercounted code by ~10-20%).
  if (!text.trim()) {
    return 0;
  }

  try {
    return getTokenizer().encode(text).ids.length;
  } catch {
    return fallbackTokenCount(text);
  }
};
