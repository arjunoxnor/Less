import { describe, it, expect, afterEach } from "vitest";
import type { Editor } from "@tiptap/core";
import { autocompleteKey } from "./autocomplete";
import { runEnterFlow } from "./keymap";
import { docOf, line, linesOf, makeEditor, setCaretAtLineEnd } from "./testKit";

/**
 * Transition autocomplete on a finished line (superaudit 2 fix): with the
 * caret at the end of a complete catalog transition (CUT TO:), the fuzzy
 * subsequence fallback used to reopen the menu (CUT TO: is a subsequence of
 * JUMP CUT TO:), so Enter accepted a suggestion and silently rewrote the line
 * instead of advancing the flow. A finished transition must close the menu so
 * Enter falls through to the keymap.
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
  it("stays closed with the caret at the end of CUT TO:", () => {
    const ed = setup(line("scene_heading", "INT. HOUSE - DAY"), line("transition", "CUT TO:"));
    setCaretAtLineEnd(ed, 1);
    expect(menuState(ed)?.open).toBe(false);
  });

  it("Enter on a finished CUT TO: advances the flow instead of rewriting", () => {
    const ed = setup(line("scene_heading", "INT. HOUSE - DAY"), line("transition", "CUT TO:"));
    setCaretAtLineEnd(ed, 1);
    // The menu is closed, so the app's keydown handler falls through to the
    // keymap; drive the same path directly.
    expect(runEnterFlow(ed)).toBe(true);
    const lines = linesOf(ed);
    expect(lines[1]).toEqual({ element: "transition", text: "CUT TO:", dual: false, note: "" });
    expect(lines[2].element).toBe("scene_heading");
  });

  it("still opens by prefix on a partial transition", () => {
    const ed = setup(line("transition", "CUT"));
    setCaretAtLineEnd(ed, 0);
    const st = menuState(ed);
    expect(st?.open).toBe(true);
    expect(st?.items.map((i) => i.text)).toContain("CUT TO:");
  });

  it("still seeds the common transitions on an empty transition line", () => {
    const ed = setup(line("transition", ""));
    setCaretAtLineEnd(ed, 0);
    const st = menuState(ed);
    expect(st?.open).toBe(true);
    expect(st?.items.map((i) => i.text)).toContain("CUT TO:");
  });
});
