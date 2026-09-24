import { describe, expect, it } from "vitest";

import { AUTOSCROLL_EDGE, AUTOSCROLL_MAX, autoScrollStep, gridSlotAt, listSlotAt } from "./pointerDrag";

const box = (left: number, top: number, width: number, height: number) =>
  ({
    getBoundingClientRect: () => ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON: () => ({}),
    }),
  }) as unknown as HTMLElement;

describe("carrying something near the edge of a scroller", () => {
  it("stays put in the middle", () => {
    expect(autoScrollStep(400, 0, 800)).toBe(0);
  });

  it("scrolls up near the top and down near the bottom, faster toward the edge", () => {
    const gentle = autoScrollStep(AUTOSCROLL_EDGE - 10, 0, 800);
    const hard = autoScrollStep(4, 0, 800);
    expect(gentle).toBeLessThan(0);
    expect(hard).toBeLessThan(gentle);
    expect(autoScrollStep(800 - 4, 0, 800)).toBeGreaterThan(0);
  });

  it("runs at full speed past the edge, over the bars around the page", () => {
    expect(autoScrollStep(-50, 0, 800)).toBe(-AUTOSCROLL_MAX);
    expect(autoScrollStep(900, 0, 800)).toBe(AUTOSCROLL_MAX);
  });

  it("keeps the band proportionate in a short scroller", () => {
    // A 120px panel: a quarter of it, not 72px from each edge.
    expect(autoScrollStep(60, 0, 120)).toBe(0);
    expect(autoScrollStep(5, 0, 120)).toBeLessThan(0);
  });
});

describe("where a carried thing lands", () => {
  it("finds the slot in a list from the middles of the rows", () => {
    const rows = [box(0, 0, 200, 30), box(0, 30, 200, 30), box(0, 60, 200, 30)];
    expect(listSlotAt(rows, 5)).toBe(0);
    expect(listSlotAt(rows, 20)).toBe(1);
    expect(listSlotAt(rows, 50)).toBe(2);
    expect(listSlotAt(rows, 400)).toBe(3);
  });

  it("finds the slot in a wrapping grid by row, then across it", () => {
    // Two rows of three 100x80 cards.
    const cards = [0, 1, 2, 3, 4, 5].map((i) => box((i % 3) * 110, Math.floor(i / 3) * 90, 100, 80));
    expect(gridSlotAt(cards, 10, 10)).toBe(0);
    expect(gridSlotAt(cards, 70, 10)).toBe(1);
    expect(gridSlotAt(cards, 400, 10)).toBe(3); // after the first row's last card
    expect(gridSlotAt(cards, 120, 100)).toBe(4);
    expect(gridSlotAt(cards, 5, 500)).toBe(3); // below everything: the last row
  });
});
