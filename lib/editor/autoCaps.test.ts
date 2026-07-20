import { describe, it, expect, afterEach } from "vitest";
import type { Editor } from "@tiptap/core";
import { docOf, line, linesOf, makeEditor, typeText } from "./testKit";

/**
 * AutoCaps (superaudit 2, B7): uppercasing rewrites the stored text of scene
 * headings, cues, and transitions, but only when toUpperCase() preserves the
 * run's length. The German eszett grows ("STRAßE".toUpperCase() is
 * "STRASSE"), which would shift every later document position, so such runs
 * are left as typed and the element's CSS displays them uppercased.
 */

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("AutoCaps length guard", () => {
  it("leaves a text run containing an eszett untouched", () => {
    const ed = (editor = makeEditor(docOf(line("scene_heading", ""))));
    ed.commands.setTextSelection(1);
    // One dispatch, like a paste: the run's uppercase form is longer, so the
    // rewrite is skipped and the stored text keeps its typed form.
    ed.view.dispatch(ed.view.state.tr.insertText("straße"));
    expect(linesOf(ed)[0].text).toBe("straße");
  });

  it("still uppercases ordinary lowercase on an uppercase element", () => {
    const ed = (editor = makeEditor(docOf(line("character", ""))));
    ed.commands.setTextSelection(1);
    typeText(ed, "anna");
    expect(linesOf(ed)[0].text).toBe("ANNA");
  });

  it("never touches lowercase elements", () => {
    const ed = (editor = makeEditor(docOf(line("dialogue", ""))));
    ed.commands.setTextSelection(1);
    typeText(ed, "hello");
    expect(linesOf(ed)[0].text).toBe("hello");
  });

  it("does not rewrite while an IME composition is in flight", () => {
    // Rewriting the text node mid-composition cancels the composition and
    // eats CJK / accented input, so AutoCaps must stand down until it ends.
    const ed = (editor = makeEditor(docOf(line("character", ""))));
    ed.commands.setTextSelection(1);
    Object.defineProperty(ed.view, "composing", {
      get: () => true,
      configurable: true,
    });
    ed.view.dispatch(ed.view.state.tr.insertText("anna"));
    expect(linesOf(ed)[0].text).toBe("anna");
    // Composition over: the next document change uppercases the whole line
    // (AutoCaps scans the document, so the earlier text is fixed up too).
    Object.defineProperty(ed.view, "composing", {
      get: () => false,
      configurable: true,
    });
    ed.view.dispatch(ed.view.state.tr.insertText("b"));
    expect(linesOf(ed)[0].text).toBe("ANNAB");
  });
});
