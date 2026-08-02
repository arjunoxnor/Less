// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import type { Folder } from "./folders";
import {
  canStartLibraryDrag,
  nearestCardGridGap,
  nextThemeChoice,
  planFolderCardDrop,
} from "./libraryInteraction";

const folder = (
  id: string,
  parentId: string | undefined,
  order: number
): Folder => ({
  id,
  name: id,
  color: "#378ADD",
  stage: "in_progress",
  parentId,
  order,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
});

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

describe("folder card drops", () => {
  const folders = [
    folder("first-section", undefined, 0),
    folder("second-section", undefined, 1),
    folder("alpha", "first-section", 0),
    folder("bravo", "first-section", 1),
    folder("charlie", "first-section", 2),
    folder("delta", "second-section", 0),
    folder("echo", "second-section", 1),
    folder("descendant", "alpha", 0),
  ];

  it("places a card before a sibling", () => {
    expect(
      planFolderCardDrop(
        "charlie",
        {
          kind: "gap",
          parentId: "first-section",
          siblingIds: ["alpha", "bravo", "charlie"],
          slot: 0,
        },
        folders
      )
    ).toEqual({ orderedIds: ["charlie", "alpha", "bravo"] });
  });

  it("places a card after a sibling", () => {
    expect(
      planFolderCardDrop(
        "alpha",
        {
          kind: "gap",
          parentId: "first-section",
          siblingIds: ["alpha", "bravo", "charlie"],
          slot: 2,
        },
        folders
      )
    ).toEqual({ orderedIds: ["bravo", "alpha", "charlie"] });
  });

  it("keeps a card body drop as nesting", () => {
    expect(
      planFolderCardDrop(
        "bravo",
        { kind: "body", folderId: "alpha" },
        folders
      )
    ).toEqual({ parentId: "alpha" });
  });

  it("lands a card at the chosen slot in another section", () => {
    expect(
      planFolderCardDrop(
        "bravo",
        {
          kind: "gap",
          parentId: "second-section",
          siblingIds: ["delta", "echo"],
          slot: 1,
        },
        folders
      )
    ).toEqual({
      parentId: "second-section",
      orderedIds: ["delta", "bravo", "echo"],
    });
  });

  it("returns no writes for a no-op slot", () => {
    expect(
      planFolderCardDrop(
        "bravo",
        {
          kind: "gap",
          parentId: "first-section",
          siblingIds: ["alpha", "bravo", "charlie"],
          slot: 2,
        },
        folders
      )
    ).toBeNull();
  });

  it("rejects a body or gap inside the source descendant", () => {
    expect(
      planFolderCardDrop(
        "alpha",
        { kind: "body", folderId: "descendant" },
        folders
      )
    ).toBeNull();
    expect(
      planFolderCardDrop(
        "alpha",
        {
          kind: "gap",
          parentId: "descendant",
          siblingIds: [],
          slot: 0,
        },
        folders
      )
    ).toBeNull();
  });
});

describe("card grid gap hit testing", () => {
  const cards = [
    { id: "alpha", left: 0, top: 0, right: 100, bottom: 80 },
    { id: "bravo", left: 120, top: 0, right: 220, bottom: 80 },
    { id: "charlie", left: 0, top: 100, right: 100, bottom: 180 },
  ];

  it("finds the nearest gap across both grid axes", () => {
    expect(nearestCardGridGap(112, 40, cards)?.at).toBe(1);
    expect(nearestCardGridGap(110, 90, cards)?.at).toBe(2);
  });
});

describe("one-click theme choice", () => {
  it("flips explicit light and dark choices", () => {
    expect(nextThemeChoice("light", false)).toBe("dark");
    expect(nextThemeChoice("dark", true)).toBe("light");
  });

  it("flips away from either resolved system theme", () => {
    expect(nextThemeChoice("system", false)).toBe("dark");
    expect(nextThemeChoice("system", true)).toBe("light");
  });
});
