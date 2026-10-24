import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { placeAt, resolvePlace, sanitizePlace } from "./returnPlace";
import { docOf, line, lineStartPos, makeEditor } from "./testKit";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("reopening where the writer left off", () => {
  it("comes back to the same spot when nothing moved", () => {
    const ed = (editor = makeEditor(docOf(line("action", "One"), line("action", "The line I was on"), line("action", "Three"))));
    const pos = lineStartPos(ed, 1) + 5;
    expect(resolvePlace(ed.state.doc, placeAt(ed.state.doc, pos))).toBe(pos);
  });

  it("finds its line again after lines above it were added on another computer", () => {
    const ed = (editor = makeEditor(docOf(line("action", "One"), line("action", "The line I was on"))));
    const place = placeAt(ed.state.doc, lineStartPos(ed, 1) + 5);
    const later = (editor = makeEditor(
      docOf(line("action", "New opening"), line("action", "Another new line"), line("action", "One"), line("action", "The line I was on"))
    ));
    ed.destroy();
    expect(resolvePlace(later.state.doc, place)).toBe(lineStartPos(later, 3) + 5);
  });

  it("lands on the nearest line when its own is gone", () => {
    const ed = (editor = makeEditor(docOf(line("action", "Only line"))));
    const pos = resolvePlace(ed.state.doc, { pos: 9999, line: "Deleted text here", off: 3 });
    expect(ed.state.doc.resolve(pos).parent.isTextblock).toBe(true);
  });

  it("never trusts a stored place", () => {
    expect(sanitizePlace({ pos: 12.4, line: "x".repeat(90), off: -3 })).toEqual({ pos: 12, line: "x".repeat(60), off: 0 });
    expect(sanitizePlace({ pos: "12" })).toBeNull();
    expect(sanitizePlace("not json")).toBeNull();
  });
});

describe("a reading point between lines", () => {
  it("is taken as the nearest line, with its text to find it by", () => {
    const ed = (editor = makeEditor(docOf(line("action", "First"), line("action", "Second"))));
    const between = lineStartPos(ed, 1); // the boundary, not inside a line
    const place = placeAt(ed.state.doc, between);
    expect(["First", "Second"]).toContain(place.line);
  });
});
