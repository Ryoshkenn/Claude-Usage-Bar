import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MESSAGE_TYPES } from "../shared/constants";

const pageProbeSource = readFileSync(resolve(__dirname, "../../public/pageProbe.js"), "utf8");

describe("pageProbe", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps five-hour and weekly reset metadata separate for Claude usage payloads", async () => {
    const posted: unknown[] = [];
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-06-09T02:00:00.000Z").getTime());
    const originalPostMessage = window.postMessage.bind(window);
    vi.spyOn(window, "postMessage").mockImplementation((message: unknown) => {
      posted.push(message);
      originalPostMessage(message, window.location.origin);
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        clone: () => ({
          json: async () => ({
            five_hour: {
              utilization: 12,
              resets_at: "2026-06-09T05:00:00.000Z",
            },
            seven_day: {
              utilization: 76,
              resets_at: "2026-06-15T05:00:00.000Z",
            },
          }),
        }),
      })),
    );

    window.eval(pageProbeSource);
    await window.fetch("/api/organizations/123e4567-e89b-12d3-a456-426614174000/usage");
    await Promise.resolve();

    expect(posted).toContainEqual({
      type: MESSAGE_TYPES.realUsage,
      payload: {
        percentageUsed: 12,
        resetText: "resets 3h",
        sessionResetsAt: new Date("2026-06-09T05:00:00.000Z").getTime(),
        weeklyAllModelsPercentageUsed: 76,
        weeklyAllModelsResetText: "resets 7d",
        weeklyAllModelsResetsAt: new Date("2026-06-15T05:00:00.000Z").getTime(),
      },
    });
  });

  it("does not use the weekly reset for an unused session in the modern limits payload", async () => {
    const posted: unknown[] = [];
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-09-01T05:00:00.000Z").getTime());
    const originalPostMessage = window.postMessage.bind(window);
    vi.spyOn(window, "postMessage").mockImplementation((message: unknown) => {
      posted.push(message);
      originalPostMessage(message, window.location.origin);
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        clone: () => ({
          json: async () => ({
            five_hour: { utilization: 0, resets_at: null },
            seven_day: { utilization: 8, resets_at: "2026-09-08T05:00:00.000Z" },
            limits: [
              { kind: "session", group: "session", percent: 0, resets_at: null, scope: null },
              { kind: "weekly_all", group: "weekly", percent: 8, resets_at: "2026-09-08T05:00:00.000Z", scope: null },
            ],
          }),
        }),
      })),
    );

    window.eval(pageProbeSource);
    await window.fetch("/api/organizations/123e4567-e89b-12d3-a456-426614174000/usage");
    await Promise.resolve();

    expect(posted).toContainEqual({
      type: MESSAGE_TYPES.realUsage,
      payload: {
        percentageUsed: 0,
        weeklyAllModelsPercentageUsed: 8,
        weeklyAllModelsResetText: "resets 7d",
        weeklyAllModelsResetsAt: new Date("2026-09-08T05:00:00.000Z").getTime(),
      },
    });
  });
});
