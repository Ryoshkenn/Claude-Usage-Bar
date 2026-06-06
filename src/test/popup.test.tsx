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

const installBrowserThemeMock = (initialTheme: "light" | "dark") => {
  let matches = initialTheme === "light";
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mediaQueryList = {
    get matches() {
      return matches;
    },
    media: "(prefers-color-scheme: light)",
    onchange: null,
    addEventListener: vi.fn((_event: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_event: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    }),
    addListener: vi.fn((listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    }),
    removeListener: vi.fn((listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    }),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList;

  vi.stubGlobal("matchMedia", vi.fn(() => mediaQueryList));

  return {
    setTheme(theme: "light" | "dark") {
      matches = theme === "light";
      listeners.forEach((listener) => listener({ matches } as MediaQueryListEvent));
    },
  };
};

describe("Popup", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(now);
    document.body.className = "";
    installBrowserThemeMock("dark");
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

  it("uses the browser light theme for the toolbar popup", async () => {
    installBrowserThemeMock("light");
    installChromeMock({});

    render(<Popup />);

    await waitFor(() => expect(document.body).toHaveClass("cub-popup-light"));
  });

  it("uses the browser dark theme for the toolbar popup", async () => {
    installBrowserThemeMock("dark");
    installChromeMock({ [STORAGE_KEYS.detectedTheme]: "light" });

    render(<Popup />);

    await waitFor(() => expect(screen.getByText("Claude Usage Bar")).toBeInTheDocument());
    expect(document.body).not.toHaveClass("cub-popup-light");
  });

  it("updates the toolbar popup when the browser theme changes", async () => {
    const browserTheme = installBrowserThemeMock("dark");
    installChromeMock({});

    render(<Popup />);

    await waitFor(() => expect(screen.getByText("Claude Usage Bar")).toBeInTheDocument());
    expect(document.body).not.toHaveClass("cub-popup-light");

    browserTheme.setTheme("light");

    await waitFor(() => expect(document.body).toHaveClass("cub-popup-light"));
  });

  it("mounts itself and imports popup styles for the extension toolbar entry", () => {
    expect(popupSource).toContain('import { createRoot } from "react-dom/client";');
    expect(popupSource).toContain('import "./popup.css";');
    expect(popupSource).toContain('document.getElementById("root")');
    expect(popupSource).toContain("createRoot(rootElement).render(<Popup />);");
  });
});
