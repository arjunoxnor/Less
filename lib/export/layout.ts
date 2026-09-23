import type { ElementType } from "@/lib/editor/elements";

/**
 * Shared screenplay page geometry, the per-element layout table, and the text
 * helpers (sanitize + monospace wrap). Both the pagination engine
 * (lib/export/paginate.ts) and the PDF renderer (lib/export/pdf.ts) import from
 * here so the numbers are defined exactly once. Framework-free: no pdf-lib, no
 * React, no DOM.
 *
 * All measurements are in PDF points (72pt/inch). Courier at 12pt is exactly 10
 * characters per inch (7.2pt/char) and 6 lines per inch (12pt advance).
 */

const PT_PER_IN = 72;
export const CHAR_W = PT_PER_IN / 10; // 7.2pt per glyph at 10 cpi
export const LINE = 12; // 12pt line advance == 6 lines/inch

export const PAGE_W = 8.5 * PT_PER_IN; // 612
export const PAGE_H = 11 * PT_PER_IN; // 792
export const LEFT = 1.5 * PT_PER_IN; // 108 (1.5in left margin)
export const RIGHT_EDGE = PAGE_W - 1 * PT_PER_IN; // 540 (1in right margin)
// Final Draft and Arc Studio measure the 1in top margin to the top of the
// first line; that line's baseline sits one line (12pt) lower. Rendered side
// by side with Arjun's Arc Studio export at 288dpi, every glyph, including the
// page number, lands on the same pixel row.
export const TOP_BASELINE = PAGE_H - 1 * PT_PER_IN - LINE; // 708
export const BOTTOM_LIMIT = 1 * PT_PER_IN; // 72: the 54th baseline sits on the 1in bottom margin
export const PAGENO_Y = PAGE_H - 0.5 * PT_PER_IN - LINE; // 744 (the line 0.5in from the top)

/**
 * Printed line-slots per page. Every text row and every blank spaceBefore row
 * consumes exactly one slot (a 12pt y-advance): 54 lines between 1in margins,
 * as Final Draft and Arc Studio set them. A broken speech's (MORE) prints on
 * the line just below the 54th, inside the bottom margin, so it needs no slot.
 */
export const LINES_PER_PAGE = Math.floor((TOP_BASELINE - BOTTOM_LIMIT) / LINE) + 1; // 54

export const PAGE_GEOMETRY = Object.freeze({
  PAGE_W,
  PAGE_H,
  LEFT,
  RIGHT_EDGE,
  TOP_BASELINE,
  BOTTOM_LIMIT,
  LINE,
  CHAR_W,
  LINES_PER_PAGE,
});

export interface Layout {
  /** Left x in points, from the page's left edge. */
  x: number;
  /** Max characters per line at 10 cpi (drives word wrap). */
  maxChars: number;
  /** Blank lines before this element, mirroring the CSS margin-top. */
  spaceBefore: number;
  /** Right-align to this x (points from the page's left edge) instead of
      starting at x (transitions). */
  rightEdge?: number;
  /** Characters every wrapped line after the first is indented by, so a
      parenthetical's second line sits under its first letter, not under the
      bracket (Final Draft and Arc Studio both hang it by one). */
  hang?: number;
}

// The Final Draft / Arc Studio defaults, measured from Arjun's Arc Studio PDF
// (inches from the page's left edge): action and scene headings 1.5 to 7.5,
// character 3.5 to 7.25, parenthetical 3.0 to 5.5 (continuation lines hang one
// character), dialogue 2.5 to 6.0, transitions right-aligned to 7.1. One blank
// line before a scene heading, as Arc Studio sets it. globals.css mirrors every
// number here (16px == one line).
export const LAYOUT: Record<ElementType, Layout> = {
  scene_heading: { x: LEFT, maxChars: 60, spaceBefore: 1 },
  action: { x: LEFT, maxChars: 60, spaceBefore: 1 },
  character: { x: LEFT + 2 * PT_PER_IN, maxChars: 37, spaceBefore: 1 },
  parenthetical: { x: LEFT + 1.5 * PT_PER_IN, maxChars: 25, spaceBefore: 0, hang: 1 },
  dialogue: { x: LEFT + 1 * PT_PER_IN, maxChars: 35, spaceBefore: 0 },
  transition: { x: LEFT, maxChars: 56, spaceBefore: 1, rightEdge: 7.1 * PT_PER_IN },
};

// pdf-lib's built-in Courier uses WinAnsi (CP1252) encoding. These are the
// CP1252-only code points (smart quotes, dashes, ellipsis, etc.) that are valid
// beyond Latin-1; anything outside ASCII + Latin-1 + this set is replaced with
// "?" so an unusual character can never crash an export.
const CP1252_EXTRA = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
  0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

export function sanitize(text: string): string {
  let out = "";
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (c === 9) {
      out += "    "; // tab -> 4 spaces
    } else if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || CP1252_EXTRA.has(c)) {
      out += ch;
    } else {
      out += "?";
    }
  }
  return out;
}

/**
 * Minimal cleanup for the embedded-font path (Courier Prime with subsetting):
 * the subsetter handles glyph coverage, so text passes through untouched apart
 * from tab expansion and stripping control characters. The CP1252 sanitize()
 * above remains the rule for the built-in Courier fallback, and the renderer
 * still falls back to sanitize() per line if a glyph is missing at draw time.
 */
export function sanitizeLoose(text: string): string {
  let out = "";
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (c === 9) out += "    "; // tab -> 4 spaces
    else if (c < 0x20 || c === 0x7f) continue; // control chars
    else out += ch;
  }
  return out;
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Screenplay columns count user-perceived characters, never UTF-16 halves. */
export function graphemes(text: string): string[] {
  return Array.from(graphemeSegmenter.segment(text), (part) => part.segment);
}

export function columnLength(text: string): number {
  let count = 0;
  for (const _part of graphemeSegmenter.segment(text)) count++;
  return count;
}

const ASCII = /^[\x00-\x7f]*$/;

/** Columns a word takes: one per character, counted as graphemes only when
    the word has any non-ASCII in it (the segmenter is the slow path). */
function wordColumns(word: string): number {
  return ASCII.test(word) ? word.length : columnLength(word);
}

/**
 * Greedy word wrap to a monospaced column of `maxChars`. With a `hang`, every
 * line after the first is that many characters narrower (it starts that much
 * further right), which is how a parenthetical wraps. A word longer than the
 * column is cut at the column's width.
 */
export function wrap(text: string, maxChars: number, hang = 0): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  const width = () => Math.max(1, lines.length === 0 ? maxChars : maxChars - hang);
  let cur = "";
  let curLen = 0;
  for (const word of words) {
    let w = word;
    let len = wordColumns(w);
    if (len > width()) {
      let units = graphemes(w);
      while (units.length > width()) {
        if (cur) {
          lines.push(cur);
          cur = "";
          curLen = 0;
        }
        const take = width();
        lines.push(units.slice(0, take).join(""));
        units = units.slice(take);
      }
      w = units.join("");
      len = units.length;
    }
    if (!cur) {
      cur = w;
      curLen = len;
    } else if (curLen + 1 + len <= width()) {
      cur += ` ${w}`;
      curLen += 1 + len;
    } else {
      lines.push(cur);
      cur = w;
      curLen = len;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

/** Right-aligned x for a line of `text` ending at `edge` (transitions). */
export function rightAlignX(text: string, edge: number = RIGHT_EDGE): number {
  return Math.max(LEFT, edge - columnLength(text) * CHAR_W);
}
