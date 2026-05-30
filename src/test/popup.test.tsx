import { render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Popup } from "../popup/popup";
import { STORAGE_KEYS } from "../shared/constants";

const sevenDays = 7 * 24 * 60 * 60 * 1000;
const thirtyDays = 30 * 24 * 60 * 60 * 1000;

const now = new Date("2026-05-26T12:00:00.000Z").getTime();
const popupSource = readFileSync(resolve(__dirname, "../popup/popup.tsx"), "utf8");

const usageHistory = Array.from({ length: 100 }, (_, index) => ({
  capturedAt: now - sevenDays + index,
  sessionUsedPercent: index,
}));

const installChromeMock = (data: Record<string, unknown>) => {
  const storageData = { ...data };
  const get = vi.fn(async (keys?: string[] | string | Record<string, unknown> | null) => {
    if (!keys) return { ...storageData };
    if (Array.isArray(keys)) {
      return Object.fromEntries(keys.map((key) => [key, storageData[key]]));
    }
    if (typeof keys === "string") {
      return { [keys]: storageData[keys] };
    }
    return Object.fromEntries(Object.keys(keys).map((key) => [key, storageData[key] ?? keys[key]]));
  });
  const set = vi.fn(async (items: Record<string, unknown>) => {
    Object.assign(storageData, items);
  });

  vi.stubGlobal("chrome", {
    runtime: {
      lastError: undefined,
      sendMessage: vi.fn((_message: unknown, callback: (response: unknown) => void) => {
        callback({ ok: true });
      }),
    },
    storage: {
      local: {
        get,
        set,
        remove: vi.fn(),
      },
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
  });
};

describe("Popup", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(now);
  });

  it("does not show the review prompt before the set time", async () => {
    installChromeMock({
      [STORAGE_KEYS.installedAt]: now - sevenDays + 1,
      [STORAGE_KEYS.usageHistory]: usageHistory,
    });

    render(<Popup />);

    await waitFor(() => expect(screen.getByText("Claude Usage Bar")).toBeInTheDocument());
    expect(screen.queryByText(/Enjoying it/i)).not.toBeInTheDocument();
  });

  it("keeps the review prompt hidden after a recent dismissal", async () => {
    installChromeMock({
      [STORAGE_KEYS.installedAt]: now - sevenDays - 1,
      [STORAGE_KEYS.usageHistory]: usageHistory,
      [STORAGE_KEYS.reviewBannerDismissedAt]: now - thirtyDays + 1,
    });

    render(<Popup />);

    await waitFor(() => expect(screen.getByText("Claude Usage Bar")).toBeInTheDocument());
    expect(screen.queryByText(/Enjoying it/i)).not.toBeInTheDocument();
  });

  it("defaults the toolbar popup to dark until Claude reports a light theme", async () => {
    installChromeMock({});
    document.body.className = "";

    render(<Popup />);

    await waitFor(() => expect(screen.getByText("Claude Usage Bar")).toBeInTheDocument());
    expect(document.body).not.toHaveClass("cub-popup-light");
  });

  it("uses the saved Claude light theme for the toolbar popup", async () => {
    installChromeMock({ [STORAGE_KEYS.detectedTheme]: "light" });
    document.body.className = "";

    render(<Popup />);

    await waitFor(() => expect(document.body).toHaveClass("cub-popup-light"));
  });

  it("mounts itself and imports popup styles for the extension toolbar entry", () => {
    expect(popupSource).toContain('import { createRoot } from "react-dom/client";');
    expect(popupSource).toContain('import "./popup.css";');
    expect(popupSource).toContain('document.getElementById("root")');
    expect(popupSource).toContain("createRoot(rootElement).render(<Popup />);");
  });
});
