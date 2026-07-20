import { describe, it, expect, afterEach } from "vitest";
import type { Editor } from "@tiptap/core";
import { docOf, line, linesOf, makeEditor, setCaretAtLineEnd, typeText } from "./testKit";

/**
 * AutoElement (superaudit 2, B8): typing a slug opener or a known transition
 * on an action line converts the line, but ONLY when the line just became
 * matching, so a manual revert (the writer retypes the line back to action)
 * is respected and never re-converted. The revert check compares against the
 * line's text in the PREVIOUS state, found by mapping the line's position
 * back through the inverse of the batch's transactions. The old code looked
 * the line up by top-level child index instead, so a transaction that also
 * inserted a line above the caret read the WRONG old line and re-converted
 * a reverted slug (the B8 bug this file pins).
 */

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("AutoElement conversion", () => {
  it("typing a slug opener on an action line converts it to a scene heading", () => {
    const ed = (editor = makeEditor(docOf(line("action", ""))));
    ed.commands.setTextSelection(1);
    typeText(ed, "int. b");
    const l = linesOf(ed)[0];
    expect(l.element).toBe("scene_heading");
    expect(l.text).toBe("INT. B"); // AutoCaps then uppercases the heading
  });

  it("typing a catalog transition on an action line converts it", () => {
    const ed = (editor = makeEditor(docOf(line("action", ""))));
    ed.commands.setTextSelection(1);
    typeText(ed, "CUT TO:");
    expect(linesOf(ed)[0].element).toBe("transition");
  });

  it("never touches non-action lines", () => {
    const ed = (editor = makeEditor(docOf(line("dialogue", ""))));
    ed.commands.setTextSelection(1);
    typeText(ed, "int. house");
    expect(linesOf(ed)[0].element).toBe("dialogue");
  });
});

describe("AutoElement revert detection", () => {
  it("a manually reverted slug line is not re-converted by further typing", () => {
    const ed = (editor = makeEditor(docOf(line("action", ""))));
    ed.commands.setTextSelection(1);
    typeText(ed, "int. house");
    expect(linesOf(ed)[0].element).toBe("scene_heading");
    // The writer says "no, this is prose" and retypes it back to action.
    expect(ed.commands.setElement("action")).toBe(true);
    // Typing on: the line already matched in the old state, so it stays put.
    typeText(ed, " x");
    expect(linesOf(ed)[0].element).toBe("action");
  });

  it("stays reverted when the same transaction inserts a line above the caret (B8)", () => {
    // A single transaction both inserts a new line ABOVE the reverted slug
    // and edits the slug line itself. The line's top-level index shifts by
    // one, so an index-based lookup into the old document reads the wrong
    // line (which does not match), concludes the slug "just became" matching,
    // and wrongly re-converts it. The inverse-mapping lookup must keep it as
    // the action line the writer chose.
    const ed = (editor = makeEditor(
      docOf(line("action", "INT. HOUSE - DAY")) // manually reverted slug
    ));
    setCaretAtLineEnd(ed, 0);
    const { state } = ed.view;
    const lineType = state.schema.nodes.screenplayLine;
    const tr = state.tr;
    tr.insert(0, lineType.create({ element: "action" }, state.schema.text("She waits.")));
    // Touch the reverted line in the same transaction (caret maps with it).
    tr.insertText(" X", tr.mapping.map(state.selection.from));
    ed.view.dispatch(tr);
    expect(linesOf(ed)).toEqual([
      { element: "action", text: "She waits.", dual: false, note: "" },
      { element: "action", text: "INT. HOUSE - DAY X", dual: false, note: "" },
    ]);
  });
});
