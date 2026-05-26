import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CacheTimer, ContentApp } from "../content/ContentApp";
import type { ChatUsage, Settings } from "../shared/types";

const settings: Settings = {
  showOverlay: true,
  mode: "compact",
  barMetric: "session",
  ringTarget: "context",
  showBar: true,
  showBarLabel: false,
  showWheel: true,
  showWheelLabel: false,
};

const baseChatUsage: ChatUsage = {
  estimatedTokens: 24_000,
  currentContextTokens: 24_000,
  visibleMessageCount: 4,
  updatedAt: 123,
};

describe("ContentApp", () => {
  it("renders current context as the primary token metric", () => {
    render(<ContentApp settings={settings} chatUsage={baseChatUsage} />);

    expect(screen.getByLabelText("Context window 12% full")).toBeInTheDocument();
    expect(screen.getByText("24k / 200k context length")).toBeInTheDocument();
    expect(screen.getByText("24k current context")).toBeInTheDocument();
  });

  it("shows loading copy and spinner state while context is refreshing", () => {
    render(
      <ContentApp
        settings={settings}
        chatUsage={{
          ...baseChatUsage,
          isRefreshingContext: true,
        }}
      />,
    );

    expect(screen.getByLabelText("Context calculation loading")).toHaveAttribute("data-loading", "true");
    expect(screen.getByText("Calculating context usage...")).toBeInTheDocument();
    expect(screen.getByText("Loading exact token count")).toBeInTheDocument();
  });
});

describe("CacheTimer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the exact cache expiry when available", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-25T12:00:00.000Z"));

    render(<CacheTimer cacheExpiresAt={Date.now() + 90_000} fallbackStartedAt={Date.now() - 30_000} />);

    expect(screen.getByRole("timer")).toHaveAttribute("aria-label", "Prompt cache expires in 1:30");
    expect(screen.getByText("1:30")).toBeInTheDocument();
  });

  it("falls back to the stop-button timer when no exact expiry is available", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-25T12:00:00.000Z"));

    render(<CacheTimer fallbackStartedAt={Date.now() - 30_000} />);

    expect(screen.getByRole("timer")).toHaveAttribute("aria-label", "Prompt cache expires in 4:30");
    expect(screen.getByText("4:30")).toBeInTheDocument();
  });

  it("shows a placeholder when no timer source is available", () => {
    render(<CacheTimer />);

    expect(screen.getByRole("status")).toHaveTextContent("cache unknown");
  });
});
