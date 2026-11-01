import { describe, expect, it } from "vitest";
import { MESSAGE_TYPES, STORAGE_KEYS } from "../shared/constants";
import {
  applyActivityPatch,
  createThreadStoreWriter,
  handleThreadStoreMessage,
  mergePlaces,
} from "../shared/threadStore";

// A chrome.storage area that copies values in and out, and yields between the
// read and the write so interleaving shows up the way it does across tabs.
const fakeArea = () => {
  const store: Record<string, unknown> = {};
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  const area = {
    get: async (key: string) => {
      await tick();
      return key in store ? { [key]: structuredClone(store[key]) } : {};
    },
    set: async (items: Record<string, unknown>) => {
      await tick();
      Object.assign(store, structuredClone(items));
    },
    remove: async (key: string) => {
      await tick();
      delete store[key];
    },
  };
  return { store, area: area as unknown as chrome.storage.StorageArea };
};

const setup = (viewOn = true) => {
  const session = fakeArea();
  const local = fakeArea();
  let enabled = viewOn;
  const writer = createThreadStoreWriter({
    session: session.area,
    local: local.area,
    viewEnabled: async () => enabled,
  });
  return { session, local, writer, setView: (on: boolean) => (enabled = on) };
};

describe("thread store writer", () => {
  it("keeps both tabs' marks when they write at the same moment", async () => {
    const { session, writer } = setup();
    const now = Date.now();
    // Two tabs, each recording a different thread, sent together.
    await Promise.all([
      writer.patchActivity({ "chat:a": { doneAt: now } }),
      writer.patchActivity({ "chat:b": { workingSince: now } }),
    ]);
    expect(session.store[STORAGE_KEYS.threadActivity]).toEqual({
      "chat:a": { doneAt: now },
      "chat:b": { workingSince: now },
    });
  });

  it("keeps both tabs' places when they write at the same moment", async () => {
    const { local, writer } = setup();
    const since = Date.now() - 60_000;
    await Promise.all([
      writer.patchPlaces({ since, open: {}, settled: { "chat:a": since + 1_000 } }),
      writer.patchPlaces({ since, open: { "chat:b": since + 2_000 }, settled: {} }),
    ]);
    expect(local.store[STORAGE_KEYS.threadPlaces]).toEqual({
      since,
      open: { "chat:b": since + 2_000 },
      settled: { "chat:a": since + 1_000 },
    });
  });

  it("doesn't bring back places once the view is off", async () => {
    const { local, writer, setView } = setup();
    const since = Date.now() - 60_000;
    await writer.patchPlaces({ since, open: { "chat:a": since + 1 }, settled: {} });
    setView(false);
    const late = writer.patchPlaces({ since, open: { "chat:b": since + 2 }, settled: {} });
    await Promise.all([writer.forgetPlaces(), late]);
    expect(local.store).not.toHaveProperty(STORAGE_KEYS.threadPlaces);
  });

  it("answers its own messages and nothing else", async () => {
    const { session, writer } = setup();
    const now = Date.now();
    await expect(
      handleThreadStoreMessage(writer, { type: MESSAGE_TYPES.threadActivityPatch, patch: { "chat:a": { doneAt: now } } }),
    ).resolves.toEqual({ ok: true });
    expect(session.store[STORAGE_KEYS.threadActivity]).toEqual({ "chat:a": { doneAt: now } });
    expect(handleThreadStoreMessage(writer, { type: MESSAGE_TYPES.fetchApiUsage })).toBeNull();
  });

  it("reports a failed write so the tab keeps it pending", async () => {
    const writer = createThreadStoreWriter({
      session: undefined,
      local: fakeArea().area,
      viewEnabled: async () => true,
    });
    await expect(
      handleThreadStoreMessage(writer, { type: MESSAGE_TYPES.threadActivityPatch, patch: {} }),
    ).resolves.toEqual({ ok: false });
  });
});

describe("merging", () => {
  it("applies a patch per key and drops bad or expired entries", () => {
    const now = Date.now();
    const stored = { "chat:a": { doneAt: now - 1_000 }, "chat:b": { workingSince: now - 2_000 } };
    expect(
      applyActivityPatch(
        stored,
        { "chat:a": null, "chat:c": { doneAt: now }, "<bad>": { doneAt: now }, "chat:d": { doneAt: now - 48 * 3_600_000 } },
        now,
      ),
    ).toEqual({ "chat:b": { workingSince: now - 2_000 }, "chat:c": { doneAt: now } });
  });

  it("keeps the newest time per key and the stored baseline", () => {
    const since = 1_000_000;
    expect(
      mergePlaces(
        { since, open: { "chat:a": since + 10 }, settled: { "chat:b": since + 10 } },
        { since: since + 999, open: { "chat:b": since + 20 }, settled: { "chat:a": since + 5 } },
      ),
    ).toEqual({ since, open: { "chat:a": since + 10, "chat:b": since + 20 }, settled: {} });
  });
});
