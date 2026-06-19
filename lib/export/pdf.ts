import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { ScriptLine } from "@/types/screenplay";
import { PAGE_W, PAGE_H, RIGHT_EDGE, PAGENO_Y, CHAR_W } from "./layout";
import { paginate } from "./paginate";

/**
 * Spec-accurate screenplay PDF, generated client-side with pdf-lib.
 *
 * This is now a thin renderer: all of the layout, wrapping, and rule-aware
 * pagination (orphan control, (MORE)/(CONT'D) dialogue splits) lives in the
 * pure engine at lib/export/paginate.ts, which both this exporter and the
 * on-screen page count consume so the two always agree. Here we just draw each
 * page's positioned instructions with pdf-lib's built-in Courier (a true 10
 * chars/inch monospace, so no font file or fontkit is needed) and stamp the
 * page numbers.
 */

// Re-exported for back-compat; the geometry now lives in layout.ts.
export { PAGE_GEOMETRY } from "./layout";

export async function exportPdf(lines: ScriptLine[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Courier);

  const { pages } = paginate(lines);
  for (const p of pages) {
    const page = pdf.addPage([PAGE_W, PAGE_H]);
    for (const op of p.ops) {
      page.drawText(op.text, { x: op.x, y: op.y, size: 12, font, color: rgb(0, 0, 0) });
    }
    // Page numbers: top-right, "N.", omitted on page 1 by convention.
    if (p.number > 1) {
      const label = `${p.number}.`;
      page.drawText(label, {
        x: RIGHT_EDGE - label.length * CHAR_W,
        y: PAGENO_Y,
        size: 12,
        font,
        color: rgb(0, 0, 0),
      });
    }
  }

  return pdf.save();
}
