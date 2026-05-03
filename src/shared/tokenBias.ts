const CONSERVATIVE_TOKEN_BIAS = 1.2;

export const applyConservativeTokenBias = (tokens: number): number => {
  if (tokens <= 0) {
    return 0;
  }

  return Math.max(1, Math.ceil(tokens * CONSERVATIVE_TOKEN_BIAS));
};

