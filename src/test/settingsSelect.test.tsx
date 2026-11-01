import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CdsSelect } from "../content/settingsPage";

const OPTIONS = [
  { value: "off", label: "Off" },
  { value: "ring", label: "Ring" },
  { value: "text", label: "Percentage" },
];

const Harness = ({ onChange }: { onChange?: (value: string) => void }) => {
  const [value, setValue] = useState("ring");
  return (
    <div id="cub-settings-panel">
      <span id="context">Context window</span>
      <CdsSelect
        labelId="context"
        value={value}
        options={OPTIONS}
        onChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
      />
    </div>
  );
};

const trigger = () => screen.getByRole("combobox", { name: "Context window" });

afterEach(() => {
  document.body.innerHTML = "";
});

describe("settings dropdown", () => {
  it("opens our own menu, marks the current choice, and picks on click", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    expect(screen.queryByRole("listbox")).toBeNull();

    fireEvent.click(trigger());
    const listbox = screen.getByRole("listbox");
    // Portalled to the panel root, outside the row that may clip it.
    expect(listbox.parentElement?.id).toBe("cub-settings-panel");
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["Off", "Ring", "Percentage"]);
    expect(options[1].getAttribute("aria-selected")).toBe("true");

    fireEvent.click(options[2]);
    expect(onChange).toHaveBeenCalledWith("text");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(trigger().textContent).toBe("Percentage");
  });

  it("works from the keyboard and keeps Escape from reaching Claude's dialog", () => {
    const onChange = vi.fn();
    const dialogEscape = vi.fn();
    const onDocumentKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dialogEscape();
    };
    document.addEventListener("keydown", onDocumentKey);
    render(<Harness onChange={onChange} />);

    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(trigger().getAttribute("aria-activedescendant")).toBe("context-menu-1");
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    fireEvent.keyDown(trigger(), { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("text");

    fireEvent.keyDown(trigger(), { key: "Enter" });
    fireEvent.keyDown(trigger(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(dialogEscape).not.toHaveBeenCalled();
    document.removeEventListener("keydown", onDocumentKey);
  });

  it("closes on a press outside and doesn't fire for the current value", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(trigger());
    act(() => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(screen.queryByRole("listbox")).toBeNull();

    fireEvent.click(trigger());
    fireEvent.click(screen.getAllByRole("option")[1]);
    expect(onChange).not.toHaveBeenCalled();
  });
});
