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
  const captureProbe = (payload: unknown) => {
    const posted: unknown[] = [];
    const originalPostMessage = window.postMessage.bind(window);
    vi.spyOn(window, "postMessage").mockImplementation((message: unknown) => {
      posted.push(message);
      originalPostMessage(message, window.location.origin);
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ clone: () => ({ json: async () => payload }) })),
    );
    window.eval(pageProbeSource);
    return posted;
  };

  it("passes on only ids and timestamps from Claude's thread lists", async () => {
    const posted = captureProbe({
      data: [
        {
          uuid: "3224989d-2473-4ebb-a864-e6533bee0a17",
          name: "Secret plans",
          summary: "Private summary",
          created_at: "2026-10-20T10:00:00.000Z",
          updated_at: "2026-10-21T09:30:00.000Z",
          project: { uuid: "01a12ec8-6eea-7723-b6af-612b60c2f520", name: "Project name" },
        },
        { id: "cse_01JBfMdEAB5BFkL9M9H7vjjY", title: "Cowork title", created_at: 1_792_600_000 },
        { uuid: "not-an-id", created_at: "2026-10-20T10:00:00.000Z" },
      ],
    });
    await window.fetch("/api/organizations/123e4567-e89b-12d3-a456-426614174000/chat_conversations_v2?limit=30");
    await Promise.resolve();
    await Promise.resolve();

    expect(posted).toContainEqual({
      type: MESSAGE_TYPES.threadTimes,
      items: [
        {
          id: "3224989d-2473-4ebb-a864-e6533bee0a17",
          createdAt: new Date("2026-10-20T10:00:00.000Z").getTime(),
          updatedAt: new Date("2026-10-21T09:30:00.000Z").getTime(),
        },
        { id: "cse_01JBfMdEAB5BFkL9M9H7vjjY", createdAt: 1_792_600_000_000, updatedAt: undefined },
      ],
    });
    expect(JSON.stringify(posted)).not.toMatch(/Secret|Private|Project name|Cowork title/);
  });

  it("never reads a single thread's response, which carries its transcript", async () => {
    const posted = captureProbe({
      uuid: "3224989d-2473-4ebb-a864-e6533bee0a17",
      created_at: "2026-10-20T10:00:00.000Z",
      chat_messages: [{ uuid: "4224989d-2473-4ebb-a864-e6533bee0a17", created_at: "2026-10-20T10:00:00.000Z" }],
    });
    await window.fetch(
      "/api/organizations/123e4567-e89b-12d3-a456-426614174000/chat_conversations/3224989d-2473-4ebb-a864-e6533bee0a17",
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(posted.filter((message) => (message as { type?: string }).type === MESSAGE_TYPES.threadTimes)).toEqual([]);
  });
});
