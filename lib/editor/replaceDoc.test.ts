import { afterEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/core";
import { docOf, line, makeEditor } from "./testKit";
import { replaceDocInPlace } from "./replaceDoc";

/**
 * A newer copy of the open document (another tab, another device, a restore)
 * is written in by replacing only the stretch that differs. These pin what
 * that buys the writer: the caret stays on the same words, nothing becomes
 * undoable that the writer did not do, and the result is exactly the copy.
 */

let editor: Editor | null = null;
/** The copy as the schema holds it (default attributes filled in). */
const normal = (json: ReturnType<typeof docOf>) => editor!.schema.nodeFromJSON(json).toJSON();
afterEach(() => {
  editor?.destroy();
  editor = null;
});

const script = (middle: string) =>
  docOf(
    line("scene_heading", "INT. KITCHEN - NIGHT"),
    line("action", "Rain against the window."),
    line("character", "MARA"),
    line("dialogue", middle),
    line("action", "She sets the cup down and listens."),
    line("action", "Nothing."),
  );

describe("replaceDocInPlace", () => {
  it("does nothing at all when the copy is identical", () => {
    editor = makeEditor(script("Did you hear that?"));
    const dispatch = vi.spyOn(editor.view, "dispatch");
    replaceDocInPlace(editor, script("Did you hear that?"));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("lands exactly on the new copy and keeps the caret on the same words", () => {
    editor = makeEditor(script("Did you hear that?"));
    // Caret inside the last action line ("Nothing.").
    const last = editor.state.doc.content.size - 3;
    editor.commands.setTextSelection(last);
    const before = editor.state.doc.textBetween(last - 4, last);

    const next = script("Did you hear that? Someone is on the stairs.");
    replaceDocInPlace(editor, next);

    expect(editor.getJSON()).toEqual(normal(next));
    const head = editor.state.selection.head;
    expect(editor.state.doc.textBetween(head - 4, head)).toBe(before);
  });

  it("is not something the writer can undo, and is not saved as their edit", () => {
    editor = makeEditor(script("Did you hear that?"));
    const onUpdate = vi.fn();
    editor.on("update", onUpdate);
    const next = script("Somebody is here.");
    replaceDocInPlace(editor, next);
    expect(onUpdate).not.toHaveBeenCalled();
    editor.commands.undo();
    expect(editor.getJSON()).toEqual(normal(next));
  });

  it("replaces a completely different document", () => {
    editor = makeEditor(script("Did you hear that?"));
    const other = docOf(line("scene_heading", "EXT. FIELD - DAY"), line("action", "Wind."));
    replaceDocInPlace(editor, other);
    expect(editor.getJSON()).toEqual(normal(other));
  });
});
