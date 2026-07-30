import { describe, it, expect, afterEach } from "vitest";
import type { Editor } from "@tiptap/core";
import { runEnterFlow } from "./keymap";
import {
  docOf,
  line,
  lineStartPos,
  linesOf,
  makeEditor,
  setCaretAtLineEnd,
} from "./testKit";

/**
 * The Enter flow (superaudit 2, B3): Enter on an EMPTY line converts it in
 * place instead of splitting, so double-Enter (the natural way out of a
 * speech) never litters the script with empty dialogue lines. Empty ACTION
 * lines keep the split behavior (blank action lines are a legitimate spacing
 * idiom), and non-empty lines split with the flow-map element as before.
 */

let editor: Editor | null = null;
const setup = (...lines: Parameters<typeof docOf>) => {
  editor = makeEditor(docOf(...lines));
  return editor;
};
afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("Enter on an empty line converts in place", () => {
  it("empty dialogue becomes action, same line, caret stays", () => {
    const ed = setup(line("character", "ANNA"), line("dialogue", ""));
    setCaretAtLineEnd(ed, 1);
    expect(runEnterFlow(ed)).toBe(true);
    expect(linesOf(ed)).toEqual([
      { element: "character", text: "ANNA", dual: false, note: "" },
      { element: "action", text: "", dual: false, note: "" },
    ]);
    // The caret did not leave the converted line.
    expect(ed.state.selection.$from.index(0)).toBe(1);
  });

  it("empty character becomes action (an abandoned cue, not dialogue)", () => {
    const ed = setup(line("character", ""));
    setCaretAtLineEnd(ed, 0);
    expect(runEnterFlow(ed)).toBe(true);
    expect(linesOf(ed)).toEqual([
      { element: "action", text: "", dual: false, note: "" },
    ]);
  });

  it("empty parenthetical becomes dialogue", () => {
    const ed = setup(line("character", "ANNA"), line("parenthetical", ""));
    setCaretAtLineEnd(ed, 1);
    runEnterFlow(ed);
    expect(linesOf(ed)[1].element).toBe("dialogue");
    expect(linesOf(ed)).toHaveLength(2);
  });

  it("a parenthetical containing only its automatic brackets becomes empty dialogue", () => {
    const ed = setup(line("character", "ANNA"), line("parenthetical", "()"));
    ed.commands.setTextSelection(lineStartPos(ed, 1) + 2);
    expect(runEnterFlow(ed)).toBe(true);
    expect(linesOf(ed)).toEqual([
      { element: "character", text: "ANNA", dual: false, note: "" },
      { element: "dialogue", text: "", dual: false, note: "" },
    ]);
    expect(ed.state.selection.$from.index(0)).toBe(1);
  });

  it("empty scene heading becomes action", () => {
    const ed = setup(line("scene_heading", ""));
    setCaretAtLineEnd(ed, 0);
    runEnterFlow(ed);
    expect(linesOf(ed)).toEqual([
      { element: "action", text: "", dual: false, note: "" },
    ]);
  });

  it("empty transition becomes a scene heading", () => {
    const ed = setup(line("transition", ""));
    setCaretAtLineEnd(ed, 0);
    runEnterFlow(ed);
    expect(linesOf(ed)[0].element).toBe("scene_heading");
    expect(linesOf(ed)).toHaveLength(1);
  });

  it("empty ACTION still splits (blank action lines are legitimate spacing)", () => {
    const ed = setup(line("action", ""));
    setCaretAtLineEnd(ed, 0);
    runEnterFlow(ed);
    expect(linesOf(ed)).toEqual([
      { element: "action", text: "", dual: false, note: "" },
      { element: "action", text: "", dual: false, note: "" },
    ]);
  });

  it("an empty dual dialogue converted in place drops the dual flag", () => {
    const ed = setup(
      line("character", "ANNA", { dual: true }),
      line("dialogue", "", { dual: true })
    );
    setCaretAtLineEnd(ed, 1);
    runEnterFlow(ed);
    const l = linesOf(ed)[1];
    expect(l.element).toBe("action");
    expect(l.dual).toBe(false);
  });

  it("a range selection anchored on an empty dialogue line still deletes the selection", () => {
    // Regression guard: the in-place conversion must only fire for a caret.
    // With a range selection starting inside an empty dialogue line and
    // reaching into the next action line, Enter must fall through to the
    // split path, which deletes the selected content first. (The bug: the
    // empty line was retyped in place and the selected text survived, so
    // Enter appeared to do nothing to the selection.)
    const ed = setup(
      line("character", "ANNA"),
      line("dialogue", ""),
      line("action", "The room is dark.")
    );
    const from = lineStartPos(ed, 1) + 1; // inside the empty dialogue line
    const to = lineStartPos(ed, 2) + 1 + "The room ".length; // mid-action
    ed.commands.setTextSelection({ from, to });
    expect(ed.state.selection.empty).toBe(false);
    expect(runEnterFlow(ed)).toBe(true);
    // The selected text is gone and the selection collapsed to a caret.
    const texts = linesOf(ed).map((l) => l.text);
    expect(texts.join("\n")).not.toContain("The room");
    expect(texts).toContain("is dark.");
    expect(ed.state.selection.empty).toBe(true);
  });

  it("the in-place conversion is one normal undoable step", () => {
    const ed = setup(line("character", "ANNA"), line("dialogue", ""));
    setCaretAtLineEnd(ed, 1);
    runEnterFlow(ed);
    expect(linesOf(ed)[1].element).toBe("action");
    expect(ed.commands.undo()).toBe(true);
    expect(linesOf(ed)[1].element).toBe("dialogue");
  });
});

describe("Enter on a non-empty line still splits by the flow map", () => {
  const splits: [string, ReturnType<typeof line>, string][] = [
    ["character -> dialogue", line("character", "ANNA"), "dialogue"],
    ["dialogue -> action", line("dialogue", "Hello there."), "action"],
    ["parenthetical -> dialogue", line("parenthetical", "(soft)"), "dialogue"],
    ["scene heading -> action", line("scene_heading", "INT. HOUSE - DAY"), "action"],
    ["transition -> scene heading", line("transition", "CUT TO:"), "scene_heading"],
    ["action -> action", line("action", "She waits."), "action"],
  ];
  for (const [name, src, next] of splits) {
    it(name, () => {
      const ed = setup(src);
      setCaretAtLineEnd(ed, 0);
      expect(runEnterFlow(ed)).toBe(true);
      const lines = linesOf(ed);
      expect(lines).toHaveLength(2);
      expect(lines[0].element).toBe(src.attrs!.element);
      expect(lines[1].element).toBe(next);
      expect(lines[1].text).toBe("");
      // The caret moved into the new line.
      expect(ed.state.selection.$from.index(0)).toBe(1);
    });
  }

  it("keeps dual inside the dialogue cluster (cue -> dialogue)", () => {
    const ed = setup(line("character", "ANNA", { dual: true }));
    setCaretAtLineEnd(ed, 0);
    runEnterFlow(ed);
    const lines = linesOf(ed);
    expect(lines[1].element).toBe("dialogue");
    expect(lines[1].dual).toBe(true);
  });

  it("drops dual when the flow leaves the cluster (dialogue -> action)", () => {
    const ed = setup(
      line("character", "ANNA", { dual: true }),
      line("dialogue", "Hi.", { dual: true })
    );
    setCaretAtLineEnd(ed, 1);
    runEnterFlow(ed);
    const lines = linesOf(ed);
    expect(lines[2].element).toBe("action");
    expect(lines[2].dual).toBe(false);
  });

  it("never carries a script note onto the new line", () => {
    const ed = setup(line("action", "She waits.", { note: "check timing" }));
    setCaretAtLineEnd(ed, 0);
    runEnterFlow(ed);
    const lines = linesOf(ed);
    expect(lines[0].note).toBe("check timing");
    expect(lines[1].note).toBe("");
  });
});
