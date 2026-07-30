import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import {
  acceptAutocomplete,
  autocompleteKey,
  rescanAutocomplete,
} from "./autocomplete";
import { buildExtensions } from "./buildExtensions";
import { EMPTY_OUTLINE } from "./outline";
import type { Outline } from "@/types/screenplay";
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

function markMenuRendered(ed: Editor) {
  ed.view.coordsAtPos = () => ({
    left: 120,
    right: 120,
    top: 100,
    bottom: 116,
  });
  ed.view.dispatch(ed.state.tr.setMeta("addToHistory", false));
}

function press(ed: Editor, key: string, init: KeyboardEventInit = {}): boolean {
  const event = new KeyboardEvent("keydown", { key, ...init });
  let handled = false;
  ed.view.someProp("handleKeyDown", (handler) => {
    if (handler(ed.view, event)) {
      handled = true;
      return true;
    }
    return false;
  });
  return handled;
}

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

  it("stays closed when a retype lands on an empty transition line", () => {
    const ed = setup(line("action", ""));
    ed.commands.setTextSelection(1);
    ed.commands.setElement("transition");
    expect(menuState(ed)?.open).toBe(false);
  });

  it("stays closed when a retype lands on an empty character line", () => {
    const ed = setup(line("action", ""));
    ed.commands.setTextSelection(1);
    ed.commands.setElement("character");
    expect(menuState(ed)?.open).toBe(false);
  });

  it("an attribute-only retype does not open suggestions for existing text", () => {
    const ed = setup(line("action", "CU"));
    setCaretAtLineEnd(ed, 0);
    ed.commands.setElement("transition");
    expect(menuState(ed)?.open).toBe(false);
    typeText(ed, "T");
    expect(menuState(ed)?.items.map((i) => i.text)).toContain("CUT TO:");
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

describe("autocomplete refresh integrity", () => {
  it("refreshes an open menu when the debounced outline changes", () => {
    let outline: Outline = {
      ...EMPTY_OUTLINE,
      characters: [{ name: "ANNA", lines: 4, lastIndex: 2 }],
    };
    const ed = (editor = new Editor({
      element: document.createElement("div"),
      extensions: buildExtensions({ getOutline: () => outline }),
      content: docOf(line("character", "")),
    }));
    ed.commands.setTextSelection(1);
    typeText(ed, "AN");
    expect(menuState(ed)?.items.map((item) => item.text)).toContain("ANNA");

    outline = {
      ...EMPTY_OUTLINE,
      characters: [{ name: "ANDY", lines: 2, lastIndex: 3 }],
    };
    rescanAutocomplete(ed.view);
    expect(menuState(ed)?.items.map((item) => item.text)).toEqual(["ANDY"]);
  });

  it("an outline refresh never reopens a dismissed menu", () => {
    const ed = setup(line("character", ""));
    ed.commands.setTextSelection(1);
    typeText(ed, "AN");
    ed.commands.setTextSelection(1);
    expect(menuState(ed)?.open).toBe(false);
    rescanAutocomplete(ed.view);
    expect(menuState(ed)?.open).toBe(false);
  });
});

describe("autocomplete keyboard ownership", () => {
  it("Tab accepts the rendered transition suggestion", () => {
    const ed = setup(line("transition", ""));
    ed.commands.setTextSelection(1);
    typeText(ed, "CUT");
    markMenuRendered(ed);
    expect(press(ed, "Tab")).toBe(true);
    expect(linesOf(ed)[0]).toEqual({
      element: "transition",
      text: "CUT TO:",
      dual: false,
      note: "",
    });
    expect(menuState(ed)?.open).toBe(false);
  });

  it("Enter accepts a rendered character and advances to dialogue", () => {
    const outline: Outline = {
      ...EMPTY_OUTLINE,
      characters: [{ name: "ANNA", lines: 4, lastIndex: 2 }],
    };
    const ed = (editor = new Editor({
      element: document.createElement("div"),
      extensions: buildExtensions({ getOutline: () => outline }),
      content: docOf(line("character", "")),
    }));
    ed.commands.setTextSelection(1);
    typeText(ed, "AN");
    markMenuRendered(ed);
    expect(press(ed, "Enter")).toBe(true);
    expect(linesOf(ed)).toEqual([
      { element: "character", text: "ANNA", dual: false, note: "" },
      { element: "dialogue", text: "", dual: false, note: "" },
    ]);
  });

  it("Escape closes a rendered menu without changing the document", () => {
    const ed = setup(line("transition", ""));
    ed.commands.setTextSelection(1);
    typeText(ed, "CUT");
    markMenuRendered(ed);
    const before = JSON.stringify(ed.getJSON());
    expect(press(ed, "Escape")).toBe(true);
    expect(JSON.stringify(ed.getJSON())).toBe(before);
    expect(menuState(ed)?.open).toBe(false);
  });

  it("Shift+Tab bypasses the menu and cycles the element backward", () => {
    const ed = setup(line("transition", ""));
    ed.commands.setTextSelection(1);
    typeText(ed, "CUT");
    markMenuRendered(ed);
    expect(press(ed, "Tab", { shiftKey: true })).toBe(true);
    expect(linesOf(ed)[0].element).toBe("parenthetical");
    expect(linesOf(ed)[0].text).toBe("CUT");
    expect(menuState(ed)?.open).toBe(false);
  });

  it("refuses a stale acceptance after the line stops matching", () => {
    const ed = setup(line("transition", ""));
    ed.commands.setTextSelection(1);
    typeText(ed, "CUT");
    expect(menuState(ed)?.open).toBe(true);
    ed.commands.setTextSelection({ from: 1, to: 4 });
    ed.commands.insertContent("XYZ");
    expect(menuState(ed)?.open).toBe(false);
    expect(acceptAutocomplete(ed.view, 0)).toBe(false);
    expect(linesOf(ed)[0].text).toBe("XYZ");
  });
});
