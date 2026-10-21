import type { Mark } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import type { DocFontChoice } from "@/lib/storage/localStore";

/**
 * Fonts and sizes in a plain document.
 *
 * A writer sets a default font and size (the base every document is written
 * in), and can give any stretch of text its own: select a line or two and
 * pick a font, and only those words change. A font or size on text is a
 * textStyle mark (FontFamily, FontSize), so it saves, syncs and undoes like
 * bold or a text color.
 */

export interface DocFont {
  key: DocFontChoice;
  label: string;
  /** The CSS family list a mark carries: the real font first, then look-alikes. */
  stack: string;
}

/** The fonts on offer. The two licensed ones fall back to self-hosted look-alikes. */
export const DOC_FONTS: readonly DocFont[] = [
  { key: "calibri", label: "Calibri", stack: 'Calibri, "Segoe UI", system-ui, -apple-system, sans-serif' },
  { key: "arial", label: "Arial", stack: 'Arial, "Helvetica Neue", Helvetica, sans-serif' },
  { key: "times", label: "Times New Roman", stack: '"Times New Roman", Times, serif' },
  { key: "georgia", label: "Georgia", stack: 'Georgia, "Times New Roman", serif' },
  { key: "verdana", label: "Verdana", stack: "Verdana, Geneva, Tahoma, sans-serif" },
  {
    key: "proxima",
    label: "Proxima Nova",
    stack: '"Proxima Nova", "proxima-nova", var(--font-montserrat), "Segoe UI", sans-serif',
  },
  { key: "futura", label: "Futura", stack: 'Futura, "Futura PT", var(--font-jost), "Century Gothic", sans-serif' },
  {
    key: "courier-prime",
    label: "Courier Prime",
    stack: '"Courier Prime", var(--font-courier-prime), "Courier New", monospace',
  },
];

/** Text sizes on offer, in px (the default is 16). */
export const DOC_SIZES: readonly number[] = [11, 12, 13, 14, 16, 18, 20, 24, 28, 32];

const firstFamily = (stack: string) =>
  stack
    .split(",")[0]
    .trim()
    .replace(/^["']|["']$/g, "")
    .toLowerCase();

/** Which of our fonts a font-family value is, by its stack or by the font it names first. */
export function docFontOf(fontFamily: string | null | undefined): DocFont | null {
  if (!fontFamily) return null;
  const exact = DOC_FONTS.find((f) => f.stack === fontFamily);
  if (exact) return exact;
  const name = firstFamily(fontFamily);
  return DOC_FONTS.find((f) => f.label.toLowerCase() === name || firstFamily(f.stack) === name) ?? null;
}

/** A font-size value ("18px", or a pasted "13.5pt") as whole px, or null. */
export function sizeOf(fontSize: string | null | undefined): number | null {
  if (!fontSize) return null;
  const m = /^([\d.]+)\s*(px|pt)?$/i.exec(fontSize.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(m[2]?.toLowerCase() === "pt" ? (n * 4) / 3 : n);
}

/**
 * One textStyle attribute across what is selected: the value it has there
 * (null for none of its own), or mixed when the selection holds more than one.
 * With nothing selected, what the caret will type with.
 */
export function styleAt(
  state: EditorState,
  attr: "fontFamily" | "fontSize"
): { value: string | null; mixed: boolean } {
  const read = (marks: readonly Mark[]) =>
    (marks.find((m) => m.type.name === "textStyle")?.attrs[attr] as string | null | undefined) ?? null;
  const { from, to, empty, $from } = state.selection;
  if (empty) return { value: read(state.storedMarks ?? $from.marks()), mixed: false };
  const seen = new Set<string | null>();
  state.doc.nodesBetween(from, to, (node) => {
    if (node.isText) seen.add(read(node.marks));
  });
  if (seen.size > 1) return { value: null, mixed: true };
  return { value: seen.size === 1 ? [...seen][0] : null, mixed: false };
}

const WORD = /[\p{L}\p{N}_'’-]/u;

/**
 * The word the caret sits inside, if any (letters on both sides of it): a font
 * picked with nothing selected changes that word, the way a word processor
 * does. At the edge of a word, or between words, it is null, and the font
 * applies to what is typed next instead.
 */
export function wordAround(state: EditorState): { from: number; to: number } | null {
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.isTextblock) return null;
  const text = $from.parent.textBetween(0, $from.parent.content.size, undefined, "￼");
  const at = $from.parentOffset;
  if (!WORD.test(text[at - 1] ?? "") || !WORD.test(text[at] ?? "")) return null;
  let start = at;
  let end = at;
  while (start > 0 && WORD.test(text[start - 1])) start--;
  while (end < text.length && WORD.test(text[end])) end++;
  const base = $from.start();
  return { from: base + start, to: base + end };
}

/**
 * Text pasted from another app keeps its bold, italics and colors, but not
 * that app's font and size (Google Docs and Word put Arial 11pt on every
 * line, and black text on a dark page would vanish): pasted words take on
 * the document's own look. Text copied inside LESS keeps everything.
 */
export function cleanPastedHTML(html: string): string {
  if (html.includes("data-pm-slice") || typeof DOMParser === "undefined") return html;
  if (!/font-family|font-size|color/i.test(html)) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.body.querySelectorAll<HTMLElement>("[style]").forEach((el) => {
    el.style.removeProperty("font-family");
    el.style.removeProperty("font-size");
    const color = el.style.getPropertyValue("color").replace(/\s+/g, "").toLowerCase();
    if (["#000", "#000000", "black", "rgb(0,0,0)", "windowtext"].includes(color)) el.style.removeProperty("color");
    if (!el.getAttribute("style")?.trim()) el.removeAttribute("style");
  });
  doc.body.querySelectorAll("font[face], font[size]").forEach((el) => {
    el.removeAttribute("face");
    el.removeAttribute("size");
  });
  return doc.body.innerHTML;
}
