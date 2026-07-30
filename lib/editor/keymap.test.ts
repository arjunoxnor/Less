import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { autocompleteKey } from "./autocomplete";
import {
  docOf,
  line,
  linesOf,
  makeEditor,
  setCaretAtLineEnd,
  typeText,
} from "./testKit";

let editor: Editor | null = null;

function setup(...lines: Parameters<typeof docOf>): Editor {
  editor = makeEditor(docOf(...lines));
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("screenplay keyboard cycling", () => {
  it("repeated Tab makes a lossless full cycle on an empty line", () => {
    const ed = setup(line("action", ""));
    ed.commands.setTextSelection(1);
    const expected = [
      "character",
      "dialogue",
      "parenthetical",
      "transition",
      "scene_heading",
      "action",
    ];
    for (const element of expected) {
      expect(ed.commands.keyboardShortcut("Tab")).toBe(true);
      expect(linesOf(ed)[0].element).toBe(element);
      expect(linesOf(ed)[0].text).toBe("");
      expect(autocompleteKey.getState(ed.state)?.open).toBe(false);
    }
  });

  it("a full Tab cycle does not uppercase action text", () => {
    const ed = setup(line("action", "Sentence case."));
    setCaretAtLineEnd(ed, 0);
    for (let i = 0; i < 6; i++) {
      expect(ed.commands.keyboardShortcut("Tab")).toBe(true);
    }
    expect(linesOf(ed)[0]).toEqual({
      element: "action",
      text: "Sentence case.",
      dual: false,
      note: "",
    });
  });

  it("Shift+Tab cycles backward without changing text", () => {
    const ed = setup(line("action", "A quiet beat."));
    setCaretAtLineEnd(ed, 0);
    expect(ed.commands.keyboardShortcut("Shift-Tab")).toBe(true);
    expect(linesOf(ed)[0]).toEqual({
      element: "scene_heading",
      text: "A quiet beat.",
      dual: false,
      note: "",
    });
  });

  it("a number shortcut retypes every line touched by a range", () => {
    const ed = setup(
      line("action", "One"),
      line("dialogue", "Two"),
      line("transition", "THREE")
    );
    ed.commands.setTextSelection({ from: 1, to: ed.state.doc.content.size - 1 });
    expect(ed.commands.keyboardShortcut("Mod-5")).toBe(true);
    expect(linesOf(ed).map((row) => row.element)).toEqual([
      "parenthetical",
      "parenthetical",
      "parenthetical",
    ]);
    expect(linesOf(ed).map((row) => row.text)).toEqual(["One", "Two", "THREE"]);
  });

  it("retyping a dual body to action drops only the dual layout flag", () => {
    const ed = setup(
      line("character", "ANNA"),
      line("dialogue", "Left."),
      line("character", "BEN", { dual: true }),
      line("dialogue", "Right.", { dual: true })
    );
    setCaretAtLineEnd(ed, 3);
    expect(ed.commands.keyboardShortcut("Mod-2")).toBe(true);
    expect(linesOf(ed)[3]).toEqual({
      element: "action",
      text: "Right.",
      dual: false,
      note: "",
    });
  });
});

describe("screenplay boundary keys", () => {
  it("Backspace at the start of the first line is a no-op", () => {
    const ed = setup(line("action", "First"));
    ed.commands.setTextSelection(1);
    expect(ed.commands.keyboardShortcut("Backspace")).toBe(true);
    expect(linesOf(ed).map((row) => row.text)).toEqual(["First"]);
  });

  it("Backspace joins adjacent action lines without losing text", () => {
    const ed = setup(line("action", "First "), line("action", "second"));
    ed.commands.setTextSelection(ed.state.doc.child(0).nodeSize + 1);
    expect(ed.commands.keyboardShortcut("Backspace")).toBe(true);
    expect(linesOf(ed)).toEqual([
      { element: "action", text: "First second", dual: false, note: "" },
    ]);
  });

  it("a pure selection move closes autocomplete before another key acts", () => {
    const ed = setup(line("transition", ""));
    ed.commands.setTextSelection(1);
    typeText(ed, "CUT");
    expect(autocompleteKey.getState(ed.state)?.open).toBe(true);
    ed.commands.setTextSelection(2);
    expect(autocompleteKey.getState(ed.state)?.open).toBe(false);
  });
});
