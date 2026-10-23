import { describe, expect, it } from "vitest";
import { clampZoom, stepZoom, zoomLabel } from "./pageZoom";

describe("page zoom", () => {
  it("steps through the presets and stops at the ends", () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(0.75, -1)).toBe(0.5);
    expect(stepZoom(0.5, -1)).toBe(0.5);
    expect(stepZoom(2, 1)).toBe(2);
    // A zoom between presets goes to the next one either way.
    expect(stepZoom(1.3, 1)).toBe(1.5);
    expect(stepZoom(1.3, -1)).toBe(1.25);
  });

  it("makes a stored zoom safe", () => {
    expect(clampZoom(undefined)).toBe(1);
    expect(clampZoom("2")).toBe(1);
    expect(clampZoom(NaN)).toBe(1);
    expect(clampZoom(0)).toBe(1);
    expect(clampZoom(9)).toBe(2);
    expect(clampZoom(0.1)).toBe(0.5);
    expect(clampZoom(1.25)).toBe(1.25);
  });

  it("labels as a percentage", () => {
    expect(zoomLabel(0.75)).toBe("75%");
    expect(zoomLabel(1.1)).toBe("110%");
  });
});
