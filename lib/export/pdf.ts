import { PDFDocument, StandardFonts, rgb, type PDFPage } from "pdf-lib";
import type { ElementType } from "@/lib/editor/elements";
import type { ScriptLine } from "@/types/screenplay";

/**
 * Spec-accurate screenplay PDF, generated client-side with pdf-lib.
 *
 * Screenplay layout is rigidly positional, which is exactly what a low-level
 * "draw text at (x, y)" PDF API is good at. We use pdf-lib's built-in
 * StandardFonts.Courier (a true 10-characters-per-inch monospace, the canonical
 * screenplay metric) so the export is fully self-contained: no font file to
 * ship, no fontkit dependency.
 *
 * The geometry is deliberately matched to the on-screen page in globals.css
 * (1in top/bottom, 1.5in left, 1in right; per-element indents; the vertical
 * spacing that the CSS margins create) so the exported page count tracks the
 * live page estimate the writer sees while typing. Industry margins and the
 * app's own layout agree to within rounding here, so this is both WYSIWYG and
 * standards-compliant.
 *
 * Rule-aware pagination (MORE / CONT'D, orphan and widow control) is Phase 5;
 * this does correct per-element layout, simple page breaks, and page numbers.
 */

const PT_PER_IN = 72;
const CHAR_W = PT_PER_IN / 10; // 7.2pt: Courier is exactly 10 chars/inch at 12pt
const LINE = 12; // 12pt line advance == 6 lines/inch, matching the screen

const PAGE_W = 8.5 * PT_PER_IN; // 612
const PAGE_H = 11 * PT_PER_IN; // 792
const LEFT = 1.5 * PT_PER_IN; // 108
const RIGHT_EDGE = PAGE_W - 1 * PT_PER_IN; // 540 (1in right margin)
const TOP_BASELINE = PAGE_H - 1 * PT_PER_IN; // 720 (1in top margin)
const BOTTOM_LIMIT = 1 * PT_PER_IN + LINE; // 84: keep the last baseline >= ~1in
const PAGENO_Y = PAGE_H - 0.5 * PT_PER_IN; // 756 (0.5in from top)

export const PAGE_GEOMETRY = Object.freeze({
  PAGE_W,
  PAGE_H,
  LEFT,
  RIGHT_EDGE,
  TOP_BASELINE,
  BOTTOM_LIMIT,
  LINE,
  CHAR_W,
});

interface Layout {
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
const LAYOUT: Record<ElementType, Layout> = {
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

function sanitize(text: string): string {
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

/** Greedy word wrap to a monospaced column of `maxChars`. */
function wrap(text: string, maxChars: number): string[] {
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

export async function exportPdf(lines: ScriptLine[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Courier);

  let page: PDFPage = pdf.addPage([PAGE_W, PAGE_H]);
  let y = TOP_BASELINE;

  const newPage = () => {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    y = TOP_BASELINE;
  };

  const drawAt = (text: string, x: number) => {
    if (y < BOTTOM_LIMIT) newPage();
    page.drawText(text, { x, y, size: 12, font, color: rgb(0, 0, 0) });
    y -= LINE;
  };

  let first = true;
  for (const ln of lines) {
    const layout = LAYOUT[ln.element] ?? LAYOUT.action;

    // Vertical space before the element (skipped at the very top of a page).
    if (!first) {
      for (let s = 0; s < layout.spaceBefore && y > BOTTOM_LIMIT; s++) y -= LINE;
    }
    first = false;

    const text = sanitize(ln.text ?? "");

    if (layout.rightAlign) {
      // Wrap, then right-align each line to the right margin, so a long
      // transition breaks onto multiple lines instead of bleeding off the page.
      for (const w of wrap(text, layout.maxChars)) {
        drawAt(w, Math.max(LEFT, RIGHT_EDGE - w.length * CHAR_W));
      }
    } else {
      for (const w of wrap(text, layout.maxChars)) drawAt(w, layout.x);
    }
  }

  // Page numbers: top-right, "N.", omitted on page 1 by convention.
  const pages = pdf.getPages();
  for (let i = 1; i < pages.length; i++) {
    const label = `${i + 1}.`;
    pages[i].drawText(label, {
      x: RIGHT_EDGE - label.length * CHAR_W,
      y: PAGENO_Y,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });
  }

  return pdf.save();
}
