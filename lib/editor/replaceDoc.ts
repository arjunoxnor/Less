import type { Editor, JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";

/**
 * Put `content` into the editor by replacing only the stretch that differs
 * from what is already there.
 *
 * Swapping the whole document (TipTap's setContent) throws away everything the
 * view knows: the caret lands at the end of the script, every page break and
 * (MORE) marker is deleted until the pages are measured again, and the scroll
 * position is left pointing at a layout that no longer exists. When a newer
 * copy arrives from another tab or device it usually differs from the open one
 * in a sentence or two, so a single replace step over just that stretch keeps
 * the caret on the same words (ProseMirror maps it through the step), keeps
 * every page break outside the change, and keeps the view where it was.
 *
 * The edit is not undoable (it is not the writer's own), does not fire
 * 'update' (so it is not re-saved as a local edit), and is a no-op when the
 * content is identical. Anything the schema rejects falls back to setContent.
 */
export function replaceDocInPlace(editor: Editor, content: JSONContent): void {
  if (editor.isDestroyed) return;
  const { state } = editor;
  let next: PMNode;
  try {
    next = state.schema.nodeFromJSON(content);
    next.check();
  } catch {
    editor.commands.setContent(content, { emitUpdate: false });
    return;
  }
  const start = state.doc.content.findDiffStart(next.content);
  if (start == null) return; // identical: nothing to do, nothing to move
  const end = state.doc.content.findDiffEnd(next.content);
  let endA = end?.a ?? state.doc.content.size;
  let endB = end?.b ?? next.content.size;
  // A change inside a repeated run makes the two scans overlap; widen both
  // ends by the overlap so the replaced range stays well formed.
  const overlap = start - Math.min(endA, endB);
  if (overlap > 0) {
    endA += overlap;
    endB += overlap;
  }
  const tr = state.tr
    .replace(start, endA, next.slice(start, endB))
    .setMeta("addToHistory", false)
    .setMeta("preventUpdate", true);
  editor.view.dispatch(tr);
}
