import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { ScriptLine } from "@/types/screenplay";
import {
  PAGE_W,
  PAGE_H,
  LEFT,
  RIGHT_EDGE,
  PAGENO_Y,
  CHAR_W,
  LINE,
  sanitize,
  wrap,
} from "./layout";
import { paginate } from "./paginate";
import { hasTitlePage, type TitlePage } from "./titlePage";
import { labelLockedPages, type PageLock } from "./pageLock";

/**
 * Spec-accurate screenplay PDF, generated client-side with pdf-lib.
 *
 * A thin renderer: all of the layout, wrapping, and rule-aware pagination lives
 * in the pure engine at lib/export/paginate.ts. Here we draw each page's
 * positioned instructions with pdf-lib's built-in Courier, optionally prepend an
 * unnumbered title page, and stamp the page numbers.
 */

// Re-exported for back-compat; the geometry now lives in layout.ts.
export { PAGE_GEOMETRY } from "./layout";

const BLACK = rgb(0, 0, 0);

function drawText(page: PDFPage, font: PDFFont, text: string, x: number, y: number) {
  page.drawText(text, { x, y, size: 12, font, color: BLACK });
}

function drawCentered(page: PDFPage, font: PDFFont, text: string, y: number) {
  drawText(page, font, text, (PAGE_W - text.length * CHAR_W) / 2, y);
}

/**
 * The unnumbered title page: title block centered about a third down, the
 * contact and copyright lower-left, and the draft date lower-right.
 */
function drawTitlePage(pdf: PDFDocument, font: PDFFont, tp: TitlePage) {
  const page = pdf.addPage([PAGE_W, PAGE_H]);

  // Draw a (possibly wrapped) centered field; returns the y below it.
  const centered = (text: string | undefined, y: number) => {
    if (!text) return y;
    for (const row of wrap(sanitize(text), 58)) {
      drawCentered(page, font, row, y);
      y -= LINE;
    }
    return y;
  };
  // Draw a (possibly wrapped) left-aligned field; returns the y below it.
  const leftBlock = (text: string | undefined, y: number) => {
    if (!text) return y;
    for (const ln of text.split("\n")) {
      for (const row of wrap(sanitize(ln), 58)) {
        drawText(page, font, row, LEFT, y);
        y -= LINE;
      }
    }
    return y;
  };

  let y = PAGE_H * 0.62;
  y = centered(tp.title?.toUpperCase(), y);
  y -= LINE * 2;
  y = centered(tp.credit, y);
  y = centered(tp.author, y);
  if (tp.source) {
    y -= LINE;
    y = centered(tp.source, y);
  }

  // Lower-left: contact (possibly multi-line) then copyright.
  let by = 1.6 * 72;
  by = leftBlock(tp.contact, by);
  leftBlock(tp.copyright, by);

  // Lower-right: draft date, clamped so a long value never runs off the left.
  if (tp.draftDate) {
    const t = sanitize(tp.draftDate);
    drawText(page, font, t, Math.max(LEFT, RIGHT_EDGE - t.length * CHAR_W), 1.6 * 72);
  }
}

export async function exportPdf(
  lines: ScriptLine[],
  titlePage?: TitlePage | null,
  opts?: { sceneNumbers?: boolean; autoContd?: boolean; lock?: PageLock | null }
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Courier);

  if (hasTitlePage(titlePage)) drawTitlePage(pdf, font, titlePage!);

  const { pages } = paginate(lines, opts);
  // When locked, page numbers are frozen: inserted material takes A-page letters
  // (42, 42A, 42B...) instead of renumbering. Locking never changes the layout.
  const lockLabels = opts?.lock ? labelLockedPages(pages, lines, opts.lock) : null;
  for (const p of pages) {
    const page = pdf.addPage([PAGE_W, PAGE_H]);
    for (const op of p.ops) drawText(page, font, op.text, op.x, op.y);
    // Page numbers: top-right, "N.", omitted on the unnumbered first page unless
    // a lock has assigned it a letter (a rare A-page before page 1 stays shown).
    const numText = lockLabels?.get(p.number) ?? String(p.number);
    if (p.number > 1 || (lockLabels && numText !== "1")) {
      const label = `${numText}.`;
      drawText(page, font, label, RIGHT_EDGE - label.length * CHAR_W, PAGENO_Y);
    }
  }

  return pdf.save();
}
