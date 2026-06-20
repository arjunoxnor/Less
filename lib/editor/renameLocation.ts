import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { TIME_OF_DAY } from "./outline";

/**
 * Rename a location everywhere it appears in a scene heading, preserving the
 * INT./EXT. prefix and the time of day. One transaction, one undo. This is the
 * "manage scene headings" half of fixing a typo across the whole script.
 */

const SLUG_PREFIX = /^\s*(INT\.?\/EXT\.?|EXT\.?\/INT\.?|I\/E\.?|INT\.?|EXT\.?|EST\.?)\b[.\s-]*/i;
const TIME_SEP = /\s+-{1,2}\s+/g;

/** The character span of the location inside a heading, or null if none. */
function locationSpan(
  heading: string
): { start: number; end: number; location: string } | null {
  const m = SLUG_PREFIX.exec(heading);
  if (!m) return null;
  const prefixEnd = m[0].length;

  let sepIdx = -1;
  let sepLen = 0;
  TIME_SEP.lastIndex = 0;
  let sep: RegExpExecArray | null;
  while ((sep = TIME_SEP.exec(heading)) !== null) {
    if (sep.index >= prefixEnd) {
      sepIdx = sep.index;
      sepLen = sep[0].length;
    }
  }
  const trailing =
    sepIdx >= 0 ? heading.slice(sepIdx + sepLen).trim().toUpperCase() : "";
  const trailingIsTime =
    sepIdx >= 0 &&
    TIME_OF_DAY.some((t) => trailing === t || trailing.startsWith(t + " "));
  const segEnd = trailingIsTime ? sepIdx : heading.length;

  const raw = heading.slice(prefixEnd, segEnd);
  const lead = raw.length - raw.trimStart().length;
  const trail = raw.length - raw.trimEnd().length;
  const start = prefixEnd + lead;
  const end = segEnd - trail;
  const location = heading.slice(start, end);
  if (!location) return null;
  return { start, end, location };
}

function elementOf(node: PMNode): string {
  return (node.attrs as { element?: string }).element ?? "action";
}

/** Count the scene headings a location rename would change. */
export function previewRenameLocation(
  doc: PMNode,
  fromName: string,
  toName: string
): number {
  const from = fromName.trim().toUpperCase();
  const to = toName.trim();
  if (!from || !to) return 0;
  let count = 0;
  doc.forEach((node) => {
    if (elementOf(node) !== "scene_heading") return;
    const span = locationSpan(node.textContent);
    if (span && span.location.toUpperCase() === from) count++;
  });
  return count;
}

/** Apply a location rename across all scene headings as one transaction. */
export function renameLocationEverywhere(
  view: EditorView,
  fromName: string,
  toName: string
): number {
  const from = fromName.trim().toUpperCase();
  const to = toName.trim().toUpperCase();
  if (!from || !to || from === to) return 0;

  const doc = view.state.doc;
  const edits: { from: number; to: number; text: string }[] = [];
  doc.forEach((node, offset) => {
    if (elementOf(node) !== "scene_heading") return;
    const span = locationSpan(node.textContent);
    if (span && span.location.toUpperCase() === from) {
      const base = offset + 1;
      edits.push({ from: base + span.start, to: base + span.end, text: to });
    }
  });
  if (edits.length === 0) return 0;

  edits.sort((a, b) => b.from - a.from);
  const tr = view.state.tr;
  for (const e of edits) tr.insertText(e.text, e.from, e.to);
  tr.setMeta("addToHistory", true);
  view.dispatch(tr);
  return edits.length;
}
