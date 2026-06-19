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

  let y = PAGE_H * 0.62;
  if (tp.title) {
    for (const row of wrap(sanitize(tp.title.toUpperCase()), 58)) {
      drawCentered(page, font, row, y);
      y -= LINE;
    }
  }
  y -= LINE * 2;
  if (tp.credit) {
    drawCentered(page, font, sanitize(tp.credit), y);
    y -= LINE;
  }
  if (tp.author) {
    drawCentered(page, font, sanitize(tp.author), y);
    y -= LINE;
  }
  if (tp.source) {
    y -= LINE;
    for (const row of wrap(sanitize(tp.source), 58)) {
      drawCentered(page, font, row, y);
      y -= LINE;
    }
  }

  // Lower-left: contact (possibly multi-line) then copyright.
  let by = 1.6 * 72;
  if (tp.contact) {
    for (const ln of tp.contact.split("\n")) {
      drawText(page, font, sanitize(ln), LEFT, by);
      by -= LINE;
    }
  }
  if (tp.copyright) {
    drawText(page, font, sanitize(tp.copyright), LEFT, by);
  }

  // Lower-right: draft date.
  if (tp.draftDate) {
    const t = sanitize(tp.draftDate);
    drawText(page, font, t, RIGHT_EDGE - t.length * CHAR_W, 1.6 * 72);
  }
}

export async function exportPdf(
  lines: ScriptLine[],
  titlePage?: TitlePage | null
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Courier);

  if (hasTitlePage(titlePage)) drawTitlePage(pdf, font, titlePage!);

  const { pages } = paginate(lines);
  for (const p of pages) {
    const page = pdf.addPage([PAGE_W, PAGE_H]);
    for (const op of p.ops) drawText(page, font, op.text, op.x, op.y);
    // Page numbers: top-right, "N.", omitted on page 1 (and on the title page).
    if (p.number > 1) {
      const label = `${p.number}.`;
      drawText(page, font, label, RIGHT_EDGE - label.length * CHAR_W, PAGENO_Y);
    }
  }

  return pdf.save();
}
