// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import {
  duetCopyHasText,
  duetCopyType,
  duetMirrorsToLibrary,
  planDuetCopy,
  readDuetCopyRecord,
  uniqueCopyTitle,
  writeDuetCopyRecord,
} from "./duetCopy";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, String(value));
    },
  };
}

const screenplay = (text: string): JSONContent => ({
  type: "doc",
  content: [
    {
      type: "screenplayLine",
      attrs: { element: "scene_heading" },
      content: [{ type: "text", text }],
    },
  ],
});

const prose = (text: string): JSONContent => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

describe("What a guest's copy is made of", () => {
  it("keeps the shared document's own kind", () => {
    expect(duetCopyType(screenplay("INT. ROOM - DAY"))).toBe("screenplay");
    expect(duetCopyType(prose("A note"))).toBe("plain");
    expect(duetCopyType({ type: "doc" })).toBe("plain");
  });

  it("refuses to save a room that has nothing in it yet", () => {
    expect(duetCopyHasText(screenplay("INT. ROOM - DAY"))).toBe(true);
    expect(duetCopyHasText({ type: "doc", content: [{ type: "screenplayLine" }] })).toBe(
      false
    );
    expect(duetCopyHasText(null)).toBe(false);
  });

  it("names the copy after the shared title, and falls back when there is none", () => {
    const content = screenplay("INT. ROOM - DAY");
    expect(planDuetCopy({ content, sharedTitle: "  Nightfall  ", existingTitles: [] }).title)
      .toBe("Nightfall");
    expect(planDuetCopy({ content, sharedTitle: null, existingTitles: [] }).title).toBe(
      "Shared screenplay"
    );
    expect(planDuetCopy({ content, sharedTitle: "   ", existingTitles: [] }).title).toBe(
      "Shared screenplay"
    );
  });

  it("carries the shared text through untouched", () => {
    const content = screenplay("INT. ROOM - DAY");
    const plan = planDuetCopy({ content, sharedTitle: "Nightfall", existingTitles: [] });
    expect(plan.content).toBe(content);
    expect(plan.type).toBe("screenplay");
    expect(plan.previous).toBeNull();
  });
});

describe("Saving the same shared script twice", () => {
  it("never proposes a title the library is already using", () => {
    expect(uniqueCopyTitle("Nightfall", [])).toBe("Nightfall");
    expect(uniqueCopyTitle("Nightfall", ["Nightfall"])).toBe("Nightfall (2)");
    expect(uniqueCopyTitle("Nightfall", ["nightfall ", "Nightfall (2)"])).toBe(
      "Nightfall (3)"
    );
  });

  it("keeps a very long title inside the library's name limit", () => {
    const long = "x".repeat(400);
    const first = uniqueCopyTitle(long, []);
    const second = uniqueCopyTitle(long, [first]);
    expect(first).toHaveLength(200);
    expect(second).toHaveLength(200);
    expect(second.endsWith(" (2)")).toBe(true);
    expect(second).not.toBe(first);
  });

  it("plans a distinguishable title when a copy of the link is already filed", () => {
    const plan = planDuetCopy({
      content: screenplay("INT. ROOM - DAY"),
      sharedTitle: "Nightfall",
      existingTitles: ["Nightfall"],
      previous: { projectId: "p1", title: "Nightfall", savedAt: "2026-01-01T00:00:00.000Z" },
    });
    expect(plan.title).toBe("Nightfall (2)");
    expect(plan.previous?.projectId).toBe("p1");
  });
});

describe("Remembering where a link was saved", () => {
  const token = "t".repeat(43);

  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: memoryStorage(),
    });
  });

  it("reads back the project a link was saved into", () => {
    expect(
      writeDuetCopyRecord(token, {
        projectId: "p1",
        title: "Nightfall",
        savedAt: "2026-01-01T00:00:00.000Z",
      })
    ).toBe(true);

    expect(readDuetCopyRecord(token, () => true)).toEqual({
      projectId: "p1",
      title: "Nightfall",
      savedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("forgets a copy the writer has since deleted", () => {
    writeDuetCopyRecord(token, { projectId: "p1", title: "Nightfall", savedAt: "" });
    expect(readDuetCopyRecord(token, () => false)).toBeNull();
  });

  it("treats a corrupt or missing record as no copy at all", () => {
    expect(readDuetCopyRecord(token, () => true)).toBeNull();
    window.localStorage.setItem(`less:duet:copy:${token}`, "{not json");
    expect(readDuetCopyRecord(token, () => true)).toBeNull();
    window.localStorage.setItem(`less:duet:copy:${token}`, JSON.stringify({ title: "x" }));
    expect(readDuetCopyRecord(token, () => true)).toBeNull();
  });

  it("keeps each link's copy separate", () => {
    const other = "u".repeat(43);
    writeDuetCopyRecord(token, { projectId: "p1", title: "One", savedAt: "" });
    writeDuetCopyRecord(other, { projectId: "p2", title: "Two", savedAt: "" });
    expect(readDuetCopyRecord(token, () => true)?.projectId).toBe("p1");
    expect(readDuetCopyRecord(other, () => true)?.projectId).toBe("p2");
  });
});

describe("A guest's room is not a library project", () => {
  it("mirrors an ordinary project and an owner's room, never a guest's", () => {
    expect(duetMirrorsToLibrary(null)).toBe(true);
    expect(duetMirrorsToLibrary({ owner: true })).toBe(true);
    expect(duetMirrorsToLibrary({ owner: false })).toBe(false);
  });
});
