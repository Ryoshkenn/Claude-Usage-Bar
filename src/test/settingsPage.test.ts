import { describe, expect, it } from "vitest";
import { formatManualStartTimeLabel } from "../content/settingsPage";

describe("settings page weekly schedule helpers", () => {
  it("formats manual start time labels with AM and PM", () => {
    expect(formatManualStartTimeLabel(0)).toBe("12:00 AM");
    expect(formatManualStartTimeLabel(9)).toBe("9:00 AM");
    expect(formatManualStartTimeLabel(12)).toBe("12:00 PM");
    expect(formatManualStartTimeLabel(15)).toBe("3:00 PM");
    expect(formatManualStartTimeLabel(23)).toBe("11:00 PM");
  });
});
