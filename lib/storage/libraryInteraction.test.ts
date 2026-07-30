// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { canStartLibraryDrag } from "./libraryInteraction";

describe("library drag start targets", () => {
  it("does not begin a row drag from a rename input or action button", () => {
    const row = document.createElement("div");
    const input = document.createElement("input");
    const button = document.createElement("button");
    row.append(input, button);
    expect(canStartLibraryDrag(input)).toBe(false);
    expect(canStartLibraryDrag(button)).toBe(false);
  });

  it("still begins from the row body", () => {
    const title = document.createElement("span");
    expect(canStartLibraryDrag(title)).toBe(true);
  });
});
