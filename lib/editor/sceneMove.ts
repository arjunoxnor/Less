import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";

/**
 * Scenes as ranges of the document, and moving one whole scene to a new place.
 *
 * A scene runs from its heading up to the next heading, so the transition at
 * its end (CUT TO:) travels with it. Whatever comes before the first heading
 * (a cold open with no slugline, FADE IN:) belongs to no scene and stays at
 * the top. Empty lines at the very end of the script belong to no scene
 * either: they are where the writer is about to type, and they stay last.
 */

export interface SceneRange {
  /** Position of the heading line (the start of the scene). */
  from: number;
  /** End of the scene: the next heading, or the end of the script's text. */
  to: number;
}

const isEmptyLine = (node: PMNode) => node.textContent.trim() === "";

/** Every scene's range, in order. */
export function sceneRanges(doc: PMNode): SceneRange[] {
  const starts: number[] = [];
  doc.forEach((node, offset) => {
    if (node.attrs.element === "scene_heading") starts.push(offset);
  });
  if (starts.length === 0) return [];
  // Where the script's text ends: before any run of empty lines at the end.
  let textEnd = doc.content.size;
  for (let i = doc.childCount - 1; i >= 0; i--) {
    const node = doc.child(i);
    if (!isEmptyLine(node)) break;
    textEnd -= node.nodeSize;
  }
  return starts.map((from, i) => ({
    from,
    to: i + 1 < starts.length ? starts[i + 1] : Math.max(textEnd, from + doc.nodeAt(from)!.nodeSize),
  }));
}

/**
 * Move scene `from` so it lands before the scene now at `slot` (0 to n, where
 * n means after the last scene). One undo step. A caret inside the moved
 * scene moves with it. Returns null when nothing would change.
 */
export function moveSceneTr(state: EditorState, from: number, slot: number): Transaction | null {
  const ranges = sceneRanges(state.doc);
  const source = ranges[from];
  if (!source) return null;
  const count = ranges.length;
  const at = Math.max(0, Math.min(Math.trunc(slot), count));
  if (at === from || at === from + 1) return null;

  const insertAt = at < count ? ranges[at].from : ranges[count - 1].to;
  const content = state.doc.slice(source.from, source.to).content;
  const { selection } = state;
  const carried = selection.from >= source.from && selection.to <= source.to;

  const tr = state.tr;
  tr.delete(source.from, source.to);
  const target = tr.mapping.map(insertAt, -1);
  tr.insert(target, content);
  if (carried) {
    const shift = target - source.from;
    tr.setSelection(
      selection instanceof TextSelection
        ? TextSelection.create(tr.doc, selection.from + shift, selection.to + shift)
        : TextSelection.near(tr.doc.resolve(Math.min(target + 1, tr.doc.content.size)))
    );
  }
  tr.setMeta("sceneMove", { from, to: at });
  return tr;
}

/** Where scene `from` ends up after moving it to `slot`: its new index. */
export function sceneIndexAfterMove(from: number, slot: number): number {
  return slot > from ? slot - 1 : slot;
}
