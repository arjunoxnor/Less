import { describe, expect, it } from "vitest";
import { ZOOM_AUTO, ZOOM_FIT_PAGE, ZOOM_FIT_WIDTH, clampZoom, fittedZoom, stepZoom, zoomLabel } from "./pageZoom";

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
    expect(clampZoom(0)).toBe(ZOOM_AUTO);
    expect(clampZoom(-1)).toBe(ZOOM_FIT_WIDTH);
    expect(clampZoom(-7)).toBe(1);
    expect(clampZoom(9)).toBe(2);
    expect(clampZoom(0.1)).toBe(0.5);
    expect(clampZoom(1.25)).toBe(1.25);
  });

  it("labels as a percentage", () => {
    expect(zoomLabel(0.75)).toBe("75%");
    expect(zoomLabel(1.1)).toBe("110%");
  });
});

describe("zooms that fit the window", () => {
  it("Auto fits a laptop but never grows past 100% on a big monitor", () => {
    expect(fittedZoom(ZOOM_AUTO, 700, 900)).toBe(0.85);
    expect(fittedZoom(ZOOM_AUTO, 2000, 1200)).toBe(1);
  });
  it("Fit width fills the width at any size, Whole page shows a whole page", () => {
    expect(fittedZoom(ZOOM_FIT_WIDTH, 1224, 900)).toBe(1.5);
    expect(fittedZoom(ZOOM_FIT_PAGE, 1224, 528)).toBe(0.5);
  });
  it("leaves a fixed zoom as it is", () => {
    expect(fittedZoom(1.25, 500, 500)).toBe(1.25);
  });
});
