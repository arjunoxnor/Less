import { describe, expect, it } from "vitest";
import {
  arrangeDesk,
  DESK_GAP,
  DESK_PAD,
  DESK_W0_MIN,
  deskScale,
  designWidthOf,
  firstFree,
  freezeDesk,
  placeOnDesk,
  removeFromDesk,
  sanitizeDesk,
  tidyDesk,
  type DeskLayout,
  type DeskThing,
} from "./layout";

const thing = (key: string, w = 100, h = 140): DeskThing => ({ key, w, h });
const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("sanitizeDesk", () => {
  it("keeps good spots, clamps numbers, and drops anything malformed", () => {
    const d = sanitizeDesk({
      v: 1,
      spots: [
        { k: "d:abc", x: 10.4, y: -5, w: 9999 },
        { k: "bad key", x: 1, y: 1 },
        { k: "f:fold", x: "1", y: 2 },
        { k: "s:stack", x: 3, y: 4, open: "yes" },
        null,
      ],
    });
    expect(d).toEqual({ v: 1, spots: [{ k: "d:abc", x: 10, y: 0, w: 520 }, { k: "s:stack", x: 3, y: 4 }] });
  });

  it("reads JSON text, lets a repeated key win and move to the top, and refuses other shapes", () => {
    const d = sanitizeDesk(JSON.stringify({ v: 1, spots: [{ k: "d:a", x: 1, y: 1 }, { k: "d:b", x: 2, y: 2 }, { k: "d:a", x: 9, y: 9, open: true }] }));
    expect(d?.spots).toEqual([{ k: "d:b", x: 2, y: 2 }, { k: "d:a", x: 9, y: 9, open: true }]);
    expect(sanitizeDesk({ v: 2, spots: [] })).toBeNull();
    expect(sanitizeDesk("not json")).toBeNull();
    expect(sanitizeDesk(null)).toBeNull();
  });
});

describe("arrangeDesk", () => {
  it("places everything without overlap when nothing has been placed yet", () => {
    const things = [thing("d:1", 236, 395), thing("d:2"), thing("d:3"), thing("d:4", 214, 262), thing("d:5")];
    const placed = arrangeDesk(things, null, 900);
    const rects = things.map((t) => ({ ...placed.get(t.key)!, w: t.w, h: t.h }));
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i], rects[j])).toBe(false);
    expect(placed.get("d:1")).toMatchObject({ x: DESK_PAD, y: DESK_PAD });
    for (const r of rects) expect(r.x + r.w).toBeLessThanOrEqual(900 - DESK_PAD);
  });

  it("never moves what the writer placed, and fits newcomers around it", () => {
    const layout: DeskLayout = { v: 1, spots: [{ k: "d:old", x: DESK_PAD, y: DESK_PAD }] };
    const placed = arrangeDesk([thing("d:old"), thing("d:new")], layout, 600);
    expect(placed.get("d:old")).toMatchObject({ x: DESK_PAD, y: DESK_PAD, z: 0 });
    const fresh = placed.get("d:new")!;
    expect(fresh.x).toBe(DESK_PAD + 100 + DESK_GAP);
    expect(fresh.z).toBe(1);
  });

  it("finds a stack where one of its versions used to sit", () => {
    const layout: DeskLayout = { v: 1, spots: [{ k: "d:v1", x: 400, y: 300 }] };
    const placed = arrangeDesk([{ key: "s:stack", w: 100, h: 140, aliases: ["d:v2", "d:v1"] }], layout, 900);
    expect(placed.get("s:stack")).toMatchObject({ x: 400, y: 300 });
  });
});

describe("firstFree", () => {
  it("drops below everything when a row is full", () => {
    const at = firstFree(200, 100, [{ x: DESK_PAD, y: DESK_PAD, w: 500, h: 100 }], 560);
    expect(at).toEqual({ x: DESK_PAD, y: DESK_PAD + 100 + DESK_GAP });
  });
});

describe("freeze, place, remove, tidy", () => {
  const things = [thing("d:a"), thing("d:b"), thing("f:x", 214, 262)];

  it("freezes everything where it sits, keeping sizes and open folders", () => {
    const layout: DeskLayout = { v: 1, spots: [{ k: "f:x", x: 500, y: 40, open: true }, { k: "d:a", x: 40, y: 40, w: 300 }] };
    const placed = arrangeDesk(things, layout, 900);
    const frozen = freezeDesk(things, placed, layout);
    expect(frozen.spots.map((s) => s.k)).toEqual(["f:x", "d:a", "d:b"]);
    expect(frozen.spots[0]).toMatchObject({ open: true });
    expect(frozen.spots[1]).toMatchObject({ w: 300 });
  });

  it("moves a thing to the top when it is placed, and can clear a size", () => {
    const layout: DeskLayout = { v: 1, spots: [{ k: "d:a", x: 1, y: 1, w: 200 }, { k: "d:b", x: 2, y: 2 }] };
    const next = placeOnDesk(layout, "d:a", { x: 50, y: 60 });
    expect(next.spots.map((s) => s.k)).toEqual(["d:b", "d:a"]);
    expect(next.spots[1]).toEqual({ k: "d:a", x: 50, y: 60, w: 200 });
    expect(placeOnDesk(next, "d:a", { w: undefined }).spots[1].w).toBeUndefined();
    expect(placeOnDesk(next, "f:new", { x: 5, y: 6, open: true }).spots[2]).toEqual({ k: "f:new", x: 5, y: 6, open: true });
    expect(removeFromDesk(next, ["d:a"]).spots.map((s) => s.k)).toEqual(["d:b"]);
  });

  it("tidies into fresh, non-overlapping places without losing sizes or open folders", () => {
    const layout: DeskLayout = { v: 1, spots: [{ k: "d:a", x: 700, y: 700, w: 150 }, { k: "f:x", x: 0, y: 0, open: true }] };
    const tidy = tidyDesk(things, layout, 900);
    expect(tidy.spots.map((s) => s.k)).toEqual(["d:a", "d:b", "f:x"]);
    expect(tidy.spots[0]).toMatchObject({ x: DESK_PAD, y: DESK_PAD, w: 150 });
    expect(tidy.spots[2].open).toBe(true);
  });
});

describe("a desk laid out for one screen, shown on another", () => {
  const things = [thing("d:a"), thing("d:b")];

  it("keeps the width it is laid out for through sync and every change", () => {
    const clean = sanitizeDesk({ v: 1, w0: 1999.6, spots: [{ k: "d:a", x: 10, y: 10 }] })!;
    expect(clean.w0).toBe(2000);
    expect(sanitizeDesk({ v: 1, w0: 99, spots: [] })!.w0).toBe(DESK_W0_MIN);
    expect(sanitizeDesk({ v: 1, w0: "wide", spots: [] })!.w0).toBeUndefined();
    expect(placeOnDesk(clean, "d:a", { x: 50 }).w0).toBe(2000);
    expect(removeFromDesk(clean, ["d:a"]).w0).toBe(2000);
    expect(freezeDesk(things, arrangeDesk(things, clean, 2000), clean).w0).toBe(2000);
    // Tidied up, it is laid out afresh for the screen it was tidied on.
    expect(tidyDesk(things, clean, 1100).w0).toBe(1100);
  });

  it("scales to fit: down on a smaller screen, up on a bigger one, within limits", () => {
    expect(deskScale(1100, 2200)).toBe(0.55);
    expect(deskScale(1500, 2000)).toBe(0.75);
    expect(deskScale(2000, 1000)).toBe(1.8);
    expect(deskScale(1500, 1000)).toBe(1.5);
    expect(deskScale(1102, 1100)).toBe(1);
  });

  it("takes a desk arranged before it had a width as made for this screen, or for its rightmost thing", () => {
    const old: DeskLayout = { v: 1, spots: [{ k: "d:a", x: 1600, y: 40 }] };
    // Its cover reaches 1600 + 100 + the edge.
    expect(designWidthOf(old, things, 1100)).toBe(1728);
    expect(designWidthOf(old, things, 2400)).toBe(2400);
    expect(designWidthOf(null, things, 1300)).toBe(1300);
    expect(designWidthOf({ ...old, w0: 1500 }, things, 900)).toBe(1500);
  });
});
