import { describe, expect, it } from "vitest";
import { positionAutocompleteMenu } from "./autocompletePosition";

describe("autocomplete viewport positioning", () => {
  it("flips above a caret near the bottom", () => {
    expect(
      positionAutocompleteMenu(
        { left: 300, top: 700, bottom: 716 },
        { width: 200, height: 180 },
        { width: 1000, height: 768 }
      )
    ).toEqual({ left: 300, top: 518 });
  });

  it("clamps both axes when neither side has enough room", () => {
    expect(
      positionAutocompleteMenu(
        { left: 290, top: 4, bottom: 20 },
        { width: 320, height: 240 },
        { width: 300, height: 220 }
      )
    ).toEqual({ left: 8, top: 8 });
  });
});
