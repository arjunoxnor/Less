import { describe, it, expect, afterEach } from "vitest";
import type { Editor } from "@tiptap/core";
import { autocompleteKey } from "./autocomplete";
import { runEnterFlow } from "./keymap";
import { docOf, line, linesOf, makeEditor, setCaretAtLineEnd, typeText } from "./testKit";

/**
 * Two autocomplete regressions pinned here:
 *
 * 1. Transition menu on a finished line (superaudit 2 fix): with the caret at
 *    the end of a complete catalog transition (CUT TO:), the fuzzy subsequence
 *    fallback used to reopen the menu (CUT TO: is a subsequence of JUMP CUT
 *    TO:), so Enter accepted a suggestion and silently rewrote the line
 *    instead of advancing the flow. A finished transition must close the menu
 *    so Enter falls through to the keymap.
 *
 * 2. Caret-arrival trap (Phase 4 fix): the plugin used to recompute the menu
 *    on EVERY transaction, so a caret that merely landed inside a matching
 *    token (arrow-walking into "INT. CORRIDOR - NIGH|T") opened the menu with
 *    no typing, and ArrowUp/ArrowDown were consumed cycling it indefinitely.
 *    Now only document-changing transactions may open or refresh the menu,
 *    and a pure selection move dismisses it.
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

const menuState = (ed: Editor) => autocompleteKey.getState(ed.state);

describe("transition menu on a complete catalog entry", () => {
  it("closes when typing finishes CUT TO:", () => {
    const ed = setup(line("scene_heading", "INT. HOUSE - DAY"), line("transition", "CUT TO"));
    setCaretAtLineEnd(ed, 1);
    typeText(ed, ":");
    expect(menuState(ed)?.open).toBe(false);
  });

  it("Enter on a finished CUT TO: advances the flow instead of rewriting", () => {
    const ed = setup(line("scene_heading", "INT. HOUSE - DAY"), line("transition", "CUT TO"));
    setCaretAtLineEnd(ed, 1);
    typeText(ed, ":");
    // The menu is closed, so the app's keydown handler falls through to the
    // keymap; drive the same path directly.
    expect(runEnterFlow(ed)).toBe(true);
    const lines = linesOf(ed);
    expect(lines[1]).toEqual({ element: "transition", text: "CUT TO:", dual: false, note: "" });
    expect(lines[2].element).toBe("scene_heading");
  });

  it("still opens by prefix while typing a partial transition", () => {
    const ed = setup(line("transition", "CU"));
    setCaretAtLineEnd(ed, 0);
    typeText(ed, "T");
    const st = menuState(ed);
    expect(st?.open).toBe(true);
    expect(st?.items.map((i) => i.text)).toContain("CUT TO:");
  });

  it("still seeds the common transitions when a retype lands on an empty transition line", () => {
    const ed = setup(line("action", ""));
    ed.commands.setTextSelection(1);
    ed.commands.setElement("transition");
    const st = menuState(ed);
    expect(st?.open).toBe(true);
    expect(st?.items.map((i) => i.text)).toContain("CUT TO:");
  });
});

describe("caret arrival alone never opens the menu (arrow-travel trap)", () => {
  it("stays closed when the caret lands inside a heading's time token", () => {
    const ed = setup(
      line("scene_heading", "INT. CORRIDOR - NIGHT"),
      line("action", "He walks.")
    );
    // Offset 20 sits between NIGH and T. The old caret-arrival compute opened
    // the menu here (prefix NIGH matches NIGHT) and the arrow keys cycled it
    // instead of moving the caret.
    ed.commands.setTextSelection(21);
    expect(menuState(ed)?.open).toBe(false);
  });

  it("stays closed when the caret lands on an empty transition line", () => {
    const ed = setup(line("action", "A beat."), line("transition", ""));
    setCaretAtLineEnd(ed, 1);
    expect(menuState(ed)?.open).toBe(false);
  });

  it("typing inside the token still opens it", () => {
    const ed = setup(line("scene_heading", "INT. CORRIDOR - NIG"));
    setCaretAtLineEnd(ed, 0);
    typeText(ed, "H");
    const st = menuState(ed);
    expect(st?.open).toBe(true);
    expect(st?.items.map((i) => i.text)).toContain("NIGHT");
  });

  it("a pure selection move dismisses an open menu", () => {
    const ed = setup(line("scene_heading", "INT. CORRIDOR - NIG"));
    setCaretAtLineEnd(ed, 0);
    typeText(ed, "H");
    expect(menuState(ed)?.open).toBe(true);
    ed.commands.setTextSelection(1);
    expect(menuState(ed)?.open).toBe(false);
  });
});
