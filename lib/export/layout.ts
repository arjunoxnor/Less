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
export const TOP_BASELINE = PAGE_H - 1 * PT_PER_IN; // 720 (1in top margin)
export const BOTTOM_LIMIT = 1 * PT_PER_IN + LINE; // 84: last baseline stays >= ~1in
export const PAGENO_Y = PAGE_H - 0.5 * PT_PER_IN; // 756 (0.5in from top)

/**
 * Printed line-slots per page. Every text row, every blank spaceBefore row, and
 * the (MORE) marker consume exactly one slot (a 12pt y-advance). Derived from
 * the geometry so the engine and the PDF agree by construction: the industry
 * quote is ~55 lines, but 54 is the exact capacity these 1in/1in margins yield,
 * which is what the renderer already produces.
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
  /** Right-align to the right margin instead of using x (transitions). */
  rightAlign?: boolean;
}

// x values mirror globals.css: character margin-left 2in (-> 3.5in from edge),
// parenthetical 1.5in (-> 3.0in), dialogue 1in (-> 2.5in), all inside the 1.5in
// left margin. Vertical spaceBefore mirrors the CSS margin-top (16px == 1 line).
export const LAYOUT: Record<ElementType, Layout> = {
  scene_heading: { x: LEFT, maxChars: 60, spaceBefore: 2 },
  action: { x: LEFT, maxChars: 60, spaceBefore: 1 },
  character: { x: LEFT + 2 * PT_PER_IN, maxChars: 40, spaceBefore: 1 },
  parenthetical: { x: LEFT + 1.5 * PT_PER_IN, maxChars: 25, spaceBefore: 0 },
  dialogue: { x: LEFT + 1 * PT_PER_IN, maxChars: 35, spaceBefore: 0 },
  transition: { x: LEFT, maxChars: 60, spaceBefore: 1, rightAlign: true },
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

/** Greedy word wrap to a monospaced column of `maxChars`. */
export function wrap(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let cur = "";
  for (let w of words) {
    while (w.length > maxChars) {
      if (cur) {
        lines.push(cur);
        cur = "";
      }
      lines.push(w.slice(0, maxChars));
      w = w.slice(maxChars);
    }
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= maxChars) cur += ` ${w}`;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

/** Right-aligned x for a line of `text` (used by transitions). */
export function rightAlignX(text: string): number {
  return Math.max(LEFT, RIGHT_EDGE - text.length * CHAR_W);
}
