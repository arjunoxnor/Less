// @vitest-environment jsdom

// The fingerprints have to agree across writers. A body written straight to the
// database by an outside tool may leave attribute defaults out or order its keys
// differently; once the real schema has read it, it must fingerprint the same as
// what the editor itself reports, or an unchanged open document would look
// "changed" and a routine update would turn into a conflict.

import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { makeEditor } from "@/lib/editor/testKit";
import { isBlankDoc, syncFingerprint } from "./syncBaseline";

const outsideWriter: JSONContent = {
  content: [
    // Keys in a different order, and the dual/note/revised defaults left out.
    { content: [{ text: "EXT. GRASSY FIELD - DAY", type: "text" }], attrs: { element: "scene_heading" }, type: "screenplayLine" },
    { type: "screenplayLine", attrs: { element: "action" }, content: [{ type: "text", text: "Open on a horse. Panting." }] },
    { type: "screenplayLine", attrs: { element: "character" }, content: [{ type: "text", text: "FATHER" }] },
    { type: "screenplayLine", attrs: { element: "dialogue" }, content: [{ type: "text", text: "OK." }] },
  ],
  type: "doc",
};

describe("fingerprints against the real screenplay schema", () => {
  it("an outside writer's body matches the editor's own report of it", () => {
    const editor = makeEditor(outsideWriter);
    const asHeld = editor.schema.nodeFromJSON(outsideWriter).toJSON() as JSONContent;

    expect(syncFingerprint(asHeld, null)).toBe(syncFingerprint(editor.getJSON(), null));
    // And the raw spelling alone would NOT have matched, which is why the hook
    // passes cloud bodies through the schema before comparing.
    expect(syncFingerprint(outsideWriter, null)).not.toBe(
      syncFingerprint(editor.getJSON(), null)
    );
    editor.destroy();
  });

  it("a brand-new empty screenplay is blank, however the editor spells it", () => {
    const editor = makeEditor({ type: "doc", content: [{ type: "screenplayLine", attrs: { element: "scene_heading" } }] });
    expect(isBlankDoc(editor.getJSON())).toBe(true);
    editor.destroy();
  });

  it("replacing the body leaves the caret restorable and fires no update", () => {
    const editor = makeEditor(outsideWriter);
    let updates = 0;
    editor.on("update", () => updates++);
    editor.commands.setTextSelection(30);
    const caret = editor.state.selection.from;
    editor.commands.setContent(
      { type: "doc", content: [{ type: "screenplayLine", attrs: { element: "action" }, content: [{ type: "text", text: "Short." }] }] },
      { emitUpdate: false }
    );
    editor.commands.setTextSelection(Math.min(caret, editor.state.doc.content.size));
    expect(updates).toBe(0); // a pulled body must never mark the document dirty
    expect(editor.state.selection.from).toBeLessThanOrEqual(editor.state.doc.content.size);
    editor.destroy();
  });
});
