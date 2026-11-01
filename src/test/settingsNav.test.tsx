import { act } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initSettingsPage, tickSettingsPage } from "../content/settingsPage";

// Claude's settings modal as of Oct 2026: grouped <ul>s of
// <li data-testid="…-settings"><button><icon/><span truncate>Label</span></button>,
// "General" renamed to "Appearance" (still general-settings), and the sections
// container keyed by its [data-settings-section] arbitrary-variant class.
const navItem = (testId: string | null, label: string, current = false) => `
  <li${testId ? ` data-testid="${testId}"` : ""}>
    <button type="button"${current ? ' aria-current="page"' : ""}>
      <span data-cds="Icon"></span><span class="min-w-0 flex-1 truncate">${label}</span>
    </button>
  </li>`;

const mountSettingsModal = () => {
  document.body.innerHTML = `
    <div role="dialog">
      <nav>
        <ul>
          ${navItem("account-settings", "Account", true)}
          ${navItem("billing-settings", "Billing")}
          ${navItem("usage-settings", "Usage")}
        </ul>
        <ul>
          ${navItem("general-settings", "Appearance")}
          ${navItem(null, "Your Claude")}
        </ul>
      </nav>
      <div class="p-lg [&_[data-settings-section]]:gap-4" data-testid="sections"><main>Account</main></div>
    </div>`;
  // jsdom has no layout; the overlay counts as open once its container has a box.
  const sections = document.querySelector<HTMLElement>('[data-testid="sections"]')!;
  sections.getClientRects = () => [new DOMRect(0, 0, 600, 400)] as unknown as DOMRectList;
};

const ourItem = () => document.querySelector<HTMLElement>("[data-cub-nav]");

// Registers the document-level click handling the content script sets up once.
beforeAll(() => {
  initSettingsPage();
});

beforeEach(() => {
  vi.stubGlobal("chrome", {
    storage: {
      local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: { sendMessage: vi.fn(), lastError: undefined },
  });
});

afterEach(() => {
  // Let the overlay "close" so module state resets between tests.
  document.body.innerHTML = "";
  tickSettingsPage();
  vi.unstubAllGlobals();
});

describe("settings nav item", () => {
  it("sits right after Claude's own Usage item in the redesigned modal", () => {
    mountSettingsModal();
    tickSettingsPage();

    const li = ourItem()!.closest("li")!;
    expect(li.previousElementSibling?.getAttribute("data-testid")).toBe("usage-settings");
    expect(ourItem()!.textContent).toBe("Usage Bar");
    expect(document.querySelectorAll("[data-cub-nav]")).toHaveLength(1);
  });

  it("is the only item that reads as current while its panel shows", async () => {
    mountSettingsModal();
    tickSettingsPage();
    const nav = document.querySelector("nav")!;

    await act(async () => {
      ourItem()!.click();
    });
    expect(ourItem()!.getAttribute("aria-current")).toBe("page");
    expect(nav.hasAttribute("data-cub-panel-active")).toBe(true);
    expect(document.getElementById("cub-settings-panel")).not.toBeNull();

    // Any of Claude's own items hands the section back.
    await act(async () => {
      document.querySelector<HTMLElement>('[data-testid="billing-settings"] > button')!.click();
    });
    expect(ourItem()!.hasAttribute("aria-current")).toBe(false);
    expect(nav.hasAttribute("data-cub-panel-active")).toBe(false);
    expect(document.getElementById("cub-settings-panel")).toBeNull();
  });
});
