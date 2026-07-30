import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { autocompleteKey } from "./autocomplete";
import { runEnterFlow } from "./keymap";
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

function typeWithTextInput(ed: Editor, text: string): void {
  for (const char of text) {
    const { from, to } = ed.state.selection;
    let handled = false;
    ed.view.someProp("handleTextInput", (handler) => {
      if (handler(ed.view, from, to, char, () => ed.state.tr.insertText(char, from, to))) {
        handled = true;
        return true;
      }
      return false;
    });
    if (!handled) ed.view.dispatch(ed.state.tr.insertText(char, from, to));
  }
}

function pressKey(
  ed: Editor,
  key: string,
  modifiers: { shiftKey?: boolean; modKey?: boolean } = {}
): boolean {
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const event = new KeyboardEvent("keydown", {
    key,
    shiftKey: modifiers.shiftKey,
    metaKey: modifiers.modKey && isMac,
    ctrlKey: modifiers.modKey && !isMac,
    bubbles: true,
    cancelable: true,
  });
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

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("screenplay keyboard cycling", () => {
  it("repeated Tab makes a lossless full cycle on an empty line", () => {
    const ed = setup(line("action", ""));
    ed.commands.setTextSelection(1);
    const expected = [
      ["character", ""],
      ["dialogue", ""],
      ["parenthetical", "()"],
      ["transition", ""],
      ["scene_heading", ""],
      ["action", ""],
    ];
    for (const [element, text] of expected) {
      expect(pressKey(ed, "Tab")).toBe(true);
      expect(linesOf(ed)[0].element).toBe(element);
      expect(linesOf(ed)[0].text).toBe(text);
      expect(autocompleteKey.getState(ed.state)?.open).toBe(false);
    }
  });

  it("a full Tab cycle does not uppercase action text", () => {
    const ed = setup(line("action", "Sentence case."));
    setCaretAtLineEnd(ed, 0);
    for (let i = 0; i < 6; i++) {
      expect(pressKey(ed, "Tab")).toBe(true);
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

  it("Tab inserts an empty parenthetical and puts the caret between its brackets", () => {
    const ed = setup(line("dialogue", ""));
    ed.commands.setTextSelection(1);
    expect(pressKey(ed, "Tab")).toBe(true);
    expect(linesOf(ed)[0].text).toBe("()");
    expect(ed.state.selection.$from.parentOffset).toBe(1);
  });

  it("Shift+Tab inserts an empty parenthetical and puts the caret between its brackets", () => {
    const ed = setup(line("transition", ""));
    ed.commands.setTextSelection(1);
    expect(pressKey(ed, "Tab", { shiftKey: true })).toBe(true);
    expect(linesOf(ed)[0].text).toBe("()");
    expect(ed.state.selection.$from.parentOffset).toBe(1);
  });

  it("Mod+5 inserts an empty parenthetical and puts the caret between its brackets", () => {
    const ed = setup(line("action", ""));
    ed.commands.setTextSelection(1);
    expect(pressKey(ed, "5", { modKey: true })).toBe(true);
    expect(linesOf(ed)[0].text).toBe("()");
    expect(ed.state.selection.$from.parentOffset).toBe(1);
  });

  it("the character Enter flow followed by Tab opens a parenthetical at the caret", () => {
    const ed = setup(line("character", "ANNA"));
    setCaretAtLineEnd(ed, 0);
    expect(runEnterFlow(ed)).toBe(true);
    expect(linesOf(ed)[1].element).toBe("dialogue");
    expect(pressKey(ed, "Tab")).toBe(true);
    expect(linesOf(ed)[1].text).toBe("()");
    expect(ed.state.selection.$from.parentOffset).toBe(1);
  });

  it("wraps existing text and places the caret before the closing bracket", () => {
    const ed = setup(line("dialogue", "quietly"));
    setCaretAtLineEnd(ed, 0);
    expect(pressKey(ed, "5", { modKey: true })).toBe(true);
    expect(linesOf(ed)[0].text).toBe("(quietly)");
    expect(ed.state.selection.$from.parentOffset).toBe("(quietly".length);
  });

  it("does not double-wrap text that already opens and closes with brackets", () => {
    const ed = setup(line("dialogue", "(quietly)"));
    setCaretAtLineEnd(ed, 0);
    expect(pressKey(ed, "5", { modKey: true })).toBe(true);
    expect(linesOf(ed)[0].text).toBe("(quietly)");
    expect(ed.state.selection.$from.parentOffset).toBe("(quietly".length);
  });

  it("keeps typing and End before the automatic closing bracket", () => {
    const ed = setup(line("action", ""));
    ed.commands.setTextSelection(1);
    pressKey(ed, "5", { modKey: true });
    typeText(ed, "quietly");
    expect(linesOf(ed)[0].text).toBe("(quietly)");

    expect(pressKey(ed, "End")).toBe(true);
    expect(ed.state.selection.$from.parentOffset).toBe("(quietly".length);
    typeText(ed, " now");
    typeWithTextInput(ed, ")");
    expect(linesOf(ed)[0].text).toBe("(quietly now)");

    setCaretAtLineEnd(ed, 0);
    typeWithTextInput(ed, "!");
    typeWithTextInput(ed, ")");
    expect(linesOf(ed)[0].text).toBe("(quietly now!)");

    setCaretAtLineEnd(ed, 0);
    expect(pressKey(ed, "Backspace")).toBe(true);
    expect(linesOf(ed)[0].text).toBe("(quietly now)");
    expect(pressKey(ed, "Delete")).toBe(true);
    expect(linesOf(ed)[0].text).toBe("(quietly now)");
  });

  it("Backspace clears an empty bracket pair instead of doing nothing", () => {
    // A writer who reaches a parenthetical by accident must be able to back out
    // with the key they will actually press. Swallowing Backspace on () left
    // them stuck with a bracket pair they could not remove.
    const ed = setup(line("action", ""));
    ed.commands.setTextSelection(1);
    pressKey(ed, "5", { modKey: true });
    expect(linesOf(ed)[0].text).toBe("()");

    // Do NOT reposition the caret: Mod+5 parks it between the brackets, and
    // that is the position a real writer presses Backspace from.
    expect(pressKey(ed, "Backspace")).toBe(true);
    expect(linesOf(ed)[0].text).toBe("");
    // With the scaffold gone the line is ordinary again, so the next Backspace
    // is handled by the normal empty-line path rather than being eaten here.
    expect(linesOf(ed)[0].element).toBe("parenthetical");

    // The same must hold from the far edge, where the browser can leave the
    // caret after a click.
    pressKey(ed, "5", { modKey: true });
    expect(linesOf(ed)[0].text).toBe("()");
    setCaretAtLineEnd(ed, 0);
    expect(pressKey(ed, "Backspace")).toBe(true);
    expect(linesOf(ed)[0].text).toBe("");
  });

  it("treats the untouched bracket scaffold as blank for placeholder and autocomplete", () => {
    const ed = setup(line("action", ""));
    ed.commands.setTextSelection(1);
    pressKey(ed, "5", { modKey: true });
    const paragraph = ed.view.dom.querySelector(".sp-parenthetical");
    expect(paragraph?.classList.contains("is-empty")).toBe(true);
    expect(paragraph?.querySelector(".parenthetical-placeholder")?.textContent).toBe(
      "how they say it"
    );
    expect(autocompleteKey.getState(ed.state)?.open).toBe(false);
  });

  it("a number shortcut retypes every line touched by a range", () => {
    const ed = setup(
      line("action", "One"),
      line("dialogue", "Two"),
      line("transition", "THREE")
    );
    ed.commands.setTextSelection({ from: 1, to: ed.state.doc.content.size - 1 });
    expect(pressKey(ed, "5", { modKey: true })).toBe(true);
    expect(linesOf(ed).map((row) => row.element)).toEqual([
      "parenthetical",
      "parenthetical",
      "parenthetical",
    ]);
    expect(linesOf(ed).map((row) => row.text)).toEqual([
      "(One)",
      "(Two)",
      "(THREE)",
    ]);
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
