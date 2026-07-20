import { describe, it, expect, afterEach } from "vitest";
import type { Editor } from "@tiptap/core";
import { docOf, line, linesOf, makeEditor, setCaretAtLineEnd } from "./testKit";

/**
 * setElement dual normalization (superaudit 2, B5): retyping a line OUT of a
 * dialogue cluster must drop the dual (side-by-side) flag, otherwise an
 * everyday edit (turning a speech into action) leaves a mis-indented
 * half-width line whose cause is invisible to the writer. Retyping WITHIN the
 * cluster (dialogue, parenthetical, character) keeps the flag.
 */

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

const dualCluster = () =>
  docOf(
    line("character", "ANNA", { dual: true }),
    line("dialogue", "Not now.", { dual: true })
  );

describe("setElement dual normalization", () => {
  it("clears dual when a dual dialogue is retyped to action", () => {
    const ed = (editor = makeEditor(dualCluster()));
    setCaretAtLineEnd(ed, 1);
    expect(ed.commands.setElement("action")).toBe(true);
    const l = linesOf(ed)[1];
    expect(l.element).toBe("action");
    expect(l.dual).toBe(false);
  });

  it("keeps dual when a dual dialogue is retyped to parenthetical", () => {
    const ed = (editor = makeEditor(dualCluster()));
    setCaretAtLineEnd(ed, 1);
    expect(ed.commands.setElement("parenthetical")).toBe(true);
    const l = linesOf(ed)[1];
    expect(l.element).toBe("parenthetical");
    expect(l.dual).toBe(true);
  });

  it("keeps dual when a dual dialogue is retyped to a character cue", () => {
    const ed = (editor = makeEditor(dualCluster()));
    setCaretAtLineEnd(ed, 1);
    expect(ed.commands.setElement("character")).toBe(true);
    const l = linesOf(ed)[1];
    expect(l.element).toBe("character");
    expect(l.dual).toBe(true);
  });

  it("clears dual even when the element type itself is unchanged elsewhere in a selection", () => {
    // Select across both lines and retype everything to action: both lose dual.
    const ed = (editor = makeEditor(dualCluster()));
    ed.commands.setTextSelection({ from: 1, to: ed.state.doc.content.size - 1 });
    expect(ed.commands.setElement("action")).toBe(true);
    for (const l of linesOf(ed)) {
      expect(l.element).toBe("action");
      expect(l.dual).toBe(false);
    }
  });

  it("leaves non-dual lines alone (no needless transaction)", () => {
    const ed = (editor = makeEditor(docOf(line("action", "She waits."))));
    setCaretAtLineEnd(ed, 0);
    // Same element, no dual: nothing to change, command reports false.
    expect(ed.commands.setElement("action")).toBe(false);
  });
});
