import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";

import { moveSceneTr, sceneIndexAfterMove, sceneRanges } from "./sceneMove";
import { docOf, line, lineStartPos, linesOf, makeEditor } from "./testKit";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function script() {
  return docOf(
    line("action", "FADE IN:"),
    line("scene_heading", "INT. KITCHEN - DAY"),
    line("action", "Mara makes tea."),
    line("transition", "CUT TO:"),
    line("scene_heading", "EXT. STREET - NIGHT"),
    line("character", "JONAH"),
    line("dialogue", "Where is she?"),
    line("scene_heading", "INT. CAVE - DAY"),
    line("action", "Darkness."),
    line("action", ""),
    line("action", "")
  );
}

const headings = (ed: Editor) =>
  linesOf(ed)
    .filter((l) => l.element === "scene_heading")
    .map((l) => l.text);

function move(ed: Editor, from: number, slot: number): boolean {
  const tr = moveSceneTr(ed.state, from, slot);
  if (!tr) return false;
  ed.view.dispatch(tr);
  return true;
}

describe("moving a scene", () => {
  it("moves a whole scene, transition and all, before another", () => {
    editor = makeEditor(script());
    expect(move(editor, 0, 2)).toBe(true);
    expect(headings(editor)).toEqual(["EXT. STREET - NIGHT", "INT. KITCHEN - DAY", "INT. CAVE - DAY"]);
    const texts = linesOf(editor).map((l) => l.text);
    expect(texts.slice(0, 8)).toEqual([
      "FADE IN:",
      "EXT. STREET - NIGHT",
      "JONAH",
      "Where is she?",
      "INT. KITCHEN - DAY",
      "Mara makes tea.",
      "CUT TO:",
      "INT. CAVE - DAY",
    ]);
  });

  it("keeps the opening lines on top and the empty lines at the end", () => {
    editor = makeEditor(script());
    move(editor, 2, 0);
    const lines = linesOf(editor);
    expect(lines[0].text).toBe("FADE IN:");
    expect(lines[1].text).toBe("INT. CAVE - DAY");
    expect(lines[2].text).toBe("Darkness.");
    expect(lines.slice(-2).map((l) => l.text)).toEqual(["", ""]);

    // And back to the end: after the last scene's text, before the empties.
    move(editor, 0, 3);
    const after = linesOf(editor);
    expect(headings(editor)).toEqual(["INT. KITCHEN - DAY", "EXT. STREET - NIGHT", "INT. CAVE - DAY"]);
    expect(after.slice(-3).map((l) => l.text)).toEqual(["Darkness.", "", ""]);
  });

  it("does nothing for a drop onto its own place", () => {
    editor = makeEditor(script());
    expect(moveSceneTr(editor.state, 1, 1)).toBeNull();
    expect(moveSceneTr(editor.state, 1, 2)).toBeNull();
    expect(moveSceneTr(editor.state, 7, 0)).toBeNull();
  });

  it("carries the caret with the scene it is in", () => {
    editor = makeEditor(script());
    // Caret after "Mara" in the kitchen scene.
    editor.commands.setTextSelection(lineStartPos(editor, 2) + 1 + 4);
    move(editor, 0, 3);
    const { $from } = editor.state.selection;
    expect($from.parent.textContent).toBe("Mara makes tea.");
    expect($from.parentOffset).toBe(4);
  });

  it("is one undo step", () => {
    editor = makeEditor(script());
    const before = linesOf(editor);
    move(editor, 1, 0);
    expect(headings(editor)[0]).toBe("EXT. STREET - NIGHT");
    editor.commands.undo();
    expect(linesOf(editor)).toEqual(before);
  });

  it("reports the scene's new index", () => {
    expect(sceneIndexAfterMove(0, 2)).toBe(1);
    expect(sceneIndexAfterMove(2, 0)).toBe(0);
    expect(sceneIndexAfterMove(1, 3)).toBe(2);
  });

  it("finds no scenes in a script without headings", () => {
    editor = makeEditor(docOf(line("action", "Just a note.")));
    expect(sceneRanges(editor.state.doc)).toEqual([]);
  });
});
