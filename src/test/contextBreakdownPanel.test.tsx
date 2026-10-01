import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextBreakdownPanel } from "../content/ContextBreakdownPanel";
import { setLanguage } from "../shared/i18n";
import type { ContextBreakdown, ContextCategory } from "../shared/types";

afterEach(() => setLanguage("en"));

const zeroEntries = (): Record<ContextCategory, { tokens: number; count: number }> => ({
  userMessages: { tokens: 0, count: 0 },
  assistantMessages: { tokens: 0, count: 0 },
  thinking: { tokens: 0, count: 0 },
  toolCalls: { tokens: 0, count: 0 },
  toolResults: { tokens: 0, count: 0 },
  attachments: { tokens: 0, count: 0 },
  projectKnowledge: { tokens: 0, count: 0 },
  overhead: { tokens: 0, count: 0 },
});

const breakdownOf = (parts: Partial<Record<ContextCategory, { tokens: number; count: number }>>): ContextBreakdown => {
  const entries = { ...zeroEntries(), ...parts };
  const totalTokens = (Object.values(entries) as { tokens: number }[]).reduce(
    (sum, entry) => sum + entry.tokens,
    0,
  );
  return { entries, totalTokens };
};

const stackShares = (container: HTMLElement): number[] =>
  Array.from(container.querySelectorAll(".cub-ctx-stack-seg")).map((el) =>
    parseFloat((el as HTMLElement).style.getPropertyValue("--cub-ctx-share")),
  );

describe("ContextBreakdownPanel stack", () => {
  it("sizes segments as shares of the full window with a remainder filling the rest", () => {
    const breakdown = breakdownOf({
      userMessages: { tokens: 15000, count: 4 },
      assistantMessages: { tokens: 5000, count: 4 },
    });
    const { container } = render(
      <ContextBreakdownPanel breakdown={breakdown} contextLimit={1_000_000} onClose={vi.fn()} />,
    );

    const shares = stackShares(container);
    // 1.5% + 0.5% used + 98% remaining = the whole window.
    expect(shares).toHaveLength(3);
    expect(shares[0]).toBeCloseTo(1.5, 5);
    expect(shares[1]).toBeCloseTo(0.5, 5);
    expect(shares[2]).toBeCloseTo(98, 5);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 5);

    // The remainder segment carries the user-facing label.
    expect(container.querySelector('[title="Remaining"]')).not.toBeNull();
  });

  it("keeps row % labels as shares of tokens used, not of the window", () => {
    const breakdown = breakdownOf({
      userMessages: { tokens: 15000, count: 4 },
      assistantMessages: { tokens: 5000, count: 4 },
    });
    render(<ContextBreakdownPanel breakdown={breakdown} contextLimit={1_000_000} onClose={vi.fn()} />);

    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
  });

  it("shows no stack on zero usage", () => {
    const { container } = render(
      <ContextBreakdownPanel breakdown={breakdownOf({})} contextLimit={200_000} onClose={vi.fn()} />,
    );

    expect(screen.getByText("Nothing in the context window yet.")).toBeInTheDocument();
    expect(container.querySelector(".cub-ctx-stack")).toBeNull();
  });

  it("guards a zero context limit (no remainder, zero-width used segments)", () => {
    const breakdown = breakdownOf({ userMessages: { tokens: 1000, count: 1 } });
    const { container } = render(
      <ContextBreakdownPanel breakdown={breakdown} contextLimit={0} onClose={vi.fn()} />,
    );

    const shares = stackShares(container);
    expect(shares).toHaveLength(1);
    expect(shares[0]).toBe(0);
  });

  it("omits the remainder once usage fills the window", () => {
    const breakdown = breakdownOf({ userMessages: { tokens: 200_000, count: 10 } });
    const { container } = render(
      <ContextBreakdownPanel breakdown={breakdown} contextLimit={200_000} onClose={vi.fn()} />,
    );

    const shares = stackShares(container);
    expect(shares).toHaveLength(1);
    expect(shares[0]).toBeCloseTo(100, 5);
  });

  it("localizes the remainder label with the active language", () => {
    setLanguage("es");
    const breakdown = breakdownOf({ userMessages: { tokens: 1000, count: 1 } });
    const { container } = render(
      <ContextBreakdownPanel breakdown={breakdown} contextLimit={200_000} onClose={vi.fn()} />,
    );

    expect(container.querySelector('[title="Restante"]')).not.toBeNull();
  });
});
