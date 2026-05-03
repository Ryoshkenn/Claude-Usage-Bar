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
  const normalized = normalizeTokenizationText(text);
  if (!normalized) {
    return 0;
  }

  try {
    return getTokenizer().encode(normalized).ids.length;
  } catch {
    return fallbackTokenCount(normalized);
  }
};
