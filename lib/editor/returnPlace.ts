import type { Node as PMNode } from "@tiptap/pm/model";

/**
 * Where the writer was in a document, so it reopens there: page 27 stays page
 * 27, on this computer or another one, however long ago. A place is the caret
 * position plus the start of the line it was on and how far along it, so the
 * same line is found again even after the text above it was edited elsewhere.
 * Pure (no editor needed), so the API sanitizes places with the same code.
 */
export interface Place {
  /** A document position. */
  pos: number;
  /** The start of the line the caret was on (up to 60 characters). */
  line: string;
  /** How far into that line. */
  off: number;
}

const MAX_POS = 10_000_000;

/** A place read from storage or the network: shape-checked, never trusted. */
export function sanitizePlace(value: unknown): Place | null {
  let v = value;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const pos = typeof r.pos === "number" && Number.isFinite(r.pos) ? Math.round(r.pos) : null;
  if (pos === null || pos < 0 || pos > MAX_POS) return null;
  const line = typeof r.line === "string" ? r.line.slice(0, 60) : "";
  const off = typeof r.off === "number" && Number.isFinite(r.off) ? Math.max(0, Math.min(MAX_POS, Math.round(r.off))) : 0;
  return { pos, line, off };
}

/** The place for a position in a document. */
export function placeAt(doc: PMNode, pos: number): Place {
  let at = Math.max(0, Math.min(doc.content.size, pos));
  // Between lines (the reading point can land there): the nearest line.
  if (!doc.resolve(at).parent.isTextblock) at = resolvePlace(doc, { pos: at, line: "", off: 0 });
  const $p = doc.resolve(at);
  const text = $p.parent.isTextblock ? $p.parent.textContent : "";
  return { pos: at, line: text.slice(0, 60), off: $p.parent.isTextblock ? $p.parentOffset : 0 };
}

/**
 * The position a saved place points to in the document as it is now: the
 * same spot if its line is still there, else that line found wherever it
 * moved to (the nearest copy), else as close to the old position as the
 * document allows. Always a position inside a text line.
 */
export function resolvePlace(doc: PMNode, place: Place): number {
  const size = doc.content.size;
  const clamp = (n: number) => Math.max(0, Math.min(size, n));
  const key = place.line.slice(0, 40);
  const at = clamp(place.pos);
  const $at = doc.resolve(at);
  if ($at.parent.isTextblock && (key === "" || $at.parent.textContent.startsWith(key))) return at;
  // Find the line where it went: the copy nearest to where it used to be.
  let best: number | null = null;
  if (key.length >= 3) {
    doc.descendants((node, pos) => {
      if (!node.isTextblock) return true;
      if (node.textContent.startsWith(key)) {
        const p = pos + 1 + Math.min(place.off, node.content.size);
        if (best === null || Math.abs(p - at) < Math.abs(best - at)) best = p;
      }
      return false;
    });
  }
  if (best !== null) return best;
  // Gone: the nearest line to the old spot.
  let near: number | null = null;
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const start = pos + 1;
    const end = start + node.content.size;
    const p = at < start ? start : at > end ? end : at;
    if (near === null || Math.abs(p - at) < Math.abs(near - at)) near = p;
    return false;
  });
  return near ?? clamp(1);
}
