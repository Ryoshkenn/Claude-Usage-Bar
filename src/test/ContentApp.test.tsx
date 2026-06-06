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
  showPace: true,
  showCacheTimer: true,
  paceSurplusFormat: "percent",
  weeklyMetricsEnabled: true,
  weeklyPaceMode: "smart",
  weeklyEstimateDisplay: "active_hours",
  weeklyManualWorkDays: [1, 2, 3, 4, 5],
  weeklyManualActiveHoursPerDay: 10,
  weeklyManualStartHour: 9,
  hasSeenTour: true,
  showClipboard: true,
};

const baseChatUsage: ChatUsage = {
  estimatedTokens: 24_000,
  currentContextTokens: 24_000,
  visibleMessageCount: 4,
  updatedAt: 123,
};

afterEach(() => {
  vi.useRealTimers();
});

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

  it("shows a weekly learning notice while smart weekly metrics are new", () => {
    render(
      <ContentApp
        settings={settings}
        chatUsage={baseChatUsage}
        realUsageSnapshot={{
          source: "real",
          capturedAt: Date.now(),
          percentageUsed: 20,
          sessionResetsAt: Date.now() + 2 * 60 * 60_000,
          weeklyAllModelsPercentageUsed: 30,
          weeklyAllModelsResetsAt: Date.now() + 4 * 24 * 60 * 60_000,
        }}
        weeklyUsageMetrics={{
          startedAt: Date.now() - 2 * 24 * 60 * 60_000,
          lastUpdatedAt: Date.now(),
          sampleCount: 4,
          activeDayBuckets: { "1": 2 },
          activeHourBuckets: { "14": 2 },
          activeSlotBuckets: { "1:14": 2 },
          averageActiveHoursPerDay: 2,
          confidence: "learning",
        }}
      />,
    );

    expect(screen.getByLabelText("Weekly usage estimate is still learning")).toBeInTheDocument();
    expect(screen.getByText("Weekly estimates may be inaccurate during the first week while Usage Bar learns your pattern.")).toBeInTheDocument();
  });

  it("uses constant weekly pacing and hides learning UI when weekly learning is disabled", () => {
    render(
      <ContentApp
        settings={{ ...settings, weeklyMetricsEnabled: false }}
        chatUsage={baseChatUsage}
        realUsageSnapshot={{
          source: "real",
          capturedAt: Date.now(),
          percentageUsed: 20,
          sessionResetsAt: Date.now() + 2 * 60 * 60_000,
          weeklyAllModelsPercentageUsed: 30,
          weeklyAllModelsResetsAt: Date.now() + 4 * 24 * 60 * 60_000,
        }}
        weeklyUsageMetrics={{
          startedAt: Date.now() - 2 * 24 * 60 * 60_000,
          lastUpdatedAt: Date.now(),
          sampleCount: 4,
          activeDayBuckets: { "1": 2 },
          activeHourBuckets: { "14": 2 },
          activeSlotBuckets: { "1:14": 2 },
          averageActiveHoursPerDay: 2,
          confidence: "learning",
        }}
      />,
    );

    expect(screen.queryByLabelText("Weekly usage estimate is still learning")).not.toBeInTheDocument();
    expect(screen.getAllByText(/% at reset|active left/).length).toBeGreaterThan(0);
  });

  it("shows a calendar run-out time when weekly display is days and time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T14:00:00"));

    render(
      <ContentApp
        settings={{ ...settings, weeklyEstimateDisplay: "calendar_time", weeklyPaceMode: "manual" }}
        chatUsage={baseChatUsage}
        realUsageSnapshot={{
          source: "real",
          capturedAt: Date.now(),
          percentageUsed: 20,
          sessionResetsAt: Date.now() + 2 * 60 * 60_000,
          weeklyAllModelsPercentageUsed: 50,
          weeklyAllModelsResetsAt: new Date("2026-06-08T00:00:00").getTime(),
        }}
      />,
    );

    expect(screen.getByText(/empty Mon 7:00 PM/)).toBeInTheDocument();
  });

  it("does not mark exactly 100 percent at reset as good", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T14:00:00"));

    render(
      <ContentApp
        settings={{ ...settings, weeklyPaceMode: "manual" }}
        chatUsage={baseChatUsage}
        realUsageSnapshot={{
          source: "real",
          capturedAt: Date.now(),
          percentageUsed: 20,
          sessionResetsAt: Date.now() + 2 * 60 * 60_000,
          weeklyAllModelsPercentageUsed: 10,
          weeklyAllModelsResetsAt: new Date("2026-06-08T00:00:00").getTime(),
        }}
      />,
    );

    expect(screen.queryByText("100% at reset")).not.toBeInTheDocument();
    expect(screen.getByText("~45h active left")).toHaveAttribute("data-kind", "bad");
  });

  it("shows a bad percent-at-reset label for a depleted 5-hour session on first render", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T14:00:00"));

    render(
      <ContentApp
        settings={{ ...settings, paceSurplusFormat: "percent" }}
        chatUsage={baseChatUsage}
        realUsageSnapshot={{
          source: "real",
          capturedAt: Date.now(),
          percentageUsed: 100,
          sessionResetsAt: Date.now() + 2 * 60 * 60_000,
        }}
      />,
    );

    expect(screen.getByText("100% at reset")).toHaveAttribute("data-kind", "bad");
  });

  it("recomputes the depleted percent-at-reset label when pace is toggled back on", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T14:00:00"));

    const snapshot = {
      source: "real" as const,
      capturedAt: Date.now(),
      percentageUsed: 100,
      sessionResetsAt: Date.now() + 2 * 60 * 60_000,
    };

    const { rerender } = render(
      <ContentApp
        settings={{ ...settings, showPace: false, paceSurplusFormat: "percent" }}
        chatUsage={baseChatUsage}
        realUsageSnapshot={snapshot}
      />,
    );

    expect(screen.queryByText("100% at reset")).not.toBeInTheDocument();

    rerender(
      <ContentApp
        settings={{ ...settings, showPace: true, paceSurplusFormat: "percent" }}
        chatUsage={baseChatUsage}
        realUsageSnapshot={snapshot}
      />,
    );

    expect(screen.getByText("100% at reset")).toHaveAttribute("data-kind", "bad");
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
