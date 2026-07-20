import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
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
  sanitizeLoose,
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
 * positioned instructions, optionally prepend an unnumbered title page, and
 * stamp the page numbers.
 *
 * Fonts: Courier Prime (Regular for body, Bold for scene headings), embedded
 * with subsetting from the OFL-licensed TTFs vendored under public/fonts/, so
 * screen and print share the same face. Courier Prime is metrically Courier
 * compatible (10 cpi at 12pt), so NONE of the geometry in layout.ts changes.
 * If the font asset fails to load or embed, the export falls back to pdf-lib's
 * built-in Courier / Courier-Bold, with the CP1252 sanitize() applied as
 * before.
 */

// Re-exported for back-compat; the geometry now lives in layout.ts.
export { PAGE_GEOMETRY } from "./layout";

const BLACK = rgb(0, 0, 0);

/** Warn once per session when falling back to the built-in Courier. */
let warnedFallback = false;

interface Faces {
  regular: PDFFont;
  bold: PDFFont;
  /** True when Courier Prime embedded (text passes through un-sanitized). */
  embedded: boolean;
}

async function fetchFontBytes(path: string): Promise<Uint8Array> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`font asset ${path}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function loadFaces(pdf: PDFDocument): Promise<Faces> {
  try {
    pdf.registerFontkit(fontkit);
    const [regularBytes, boldBytes] = await Promise.all([
      fetchFontBytes("/fonts/CourierPrime-Regular.ttf"),
      fetchFontBytes("/fonts/CourierPrime-Bold.ttf"),
    ]);
    const regular = await pdf.embedFont(regularBytes, { subset: true });
    const bold = await pdf.embedFont(boldBytes, { subset: true });
    return { regular, bold, embedded: true };
  } catch (err) {
    if (!warnedFallback) {
      warnedFallback = true;
      console.warn("Courier Prime unavailable; exporting with built-in Courier.", err);
    }
    const regular = await pdf.embedFont(StandardFonts.Courier);
    const bold = await pdf.embedFont(StandardFonts.CourierBold);
    return { regular, bold, embedded: false };
  }
}

/**
 * Draw one line, tolerating missing glyphs: a subset font throws at draw time
 * for a character it lacks, in which case the CP1252-sanitized string (whose
 * fallbacks every Courier carries) is drawn instead. An export can never crash
 * on an unusual character.
 */
function drawText(page: PDFPage, font: PDFFont, text: string, x: number, y: number) {
  try {
    page.drawText(text, { x, y, size: 12, font, color: BLACK });
  } catch {
    try {
      page.drawText(sanitize(text), { x, y, size: 12, font, color: BLACK });
    } catch {
      // Give up on this one line rather than the whole document.
    }
  }
}

function drawCentered(page: PDFPage, font: PDFFont, text: string, y: number) {
  drawText(page, font, text, (PAGE_W - text.length * CHAR_W) / 2, y);
}

/**
 * The unnumbered title page: title block centered about a third down, the
 * contact and copyright lower-left, and the draft date lower-right.
 */
function drawTitlePage(
  pdf: PDFDocument,
  font: PDFFont,
  tp: TitlePage,
  clean: (text: string) => string
) {
  const page = pdf.addPage([PAGE_W, PAGE_H]);

  // Draw a (possibly wrapped) centered field; returns the y below it.
  const centered = (text: string | undefined, y: number) => {
    if (!text) return y;
    for (const row of wrap(clean(text), 58)) {
      drawCentered(page, font, row, y);
      y -= LINE;
    }
    return y;
  };
  // Draw a (possibly wrapped) left-aligned field; returns the y below it.
  const leftBlock = (text: string | undefined, y: number) => {
    if (!text) return y;
    for (const ln of text.split("\n")) {
      for (const row of wrap(clean(ln), 58)) {
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
    const t = clean(tp.draftDate);
    drawText(page, font, t, Math.max(LEFT, RIGHT_EDGE - t.length * CHAR_W), 1.6 * 72);
  }
}

export async function exportPdf(
  lines: ScriptLine[],
  titlePage?: TitlePage | null,
  opts?: { sceneNumbers?: boolean; autoContd?: boolean; lock?: PageLock | null }
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const faces = await loadFaces(pdf);
  // With Courier Prime embedded, the subsetter covers the glyphs, so the
  // CP1252 "?" substitution is skipped; the built-in fallback keeps it.
  const clean = faces.embedded ? sanitizeLoose : sanitize;

  if (hasTitlePage(titlePage)) drawTitlePage(pdf, faces.regular, titlePage!, clean);

  const { pages } = paginate(lines, { ...opts, keepUnicode: faces.embedded });
  // When locked, page numbers are frozen: inserted material takes A-page letters
  // (42, 42A, 42B...) instead of renumbering. Locking never changes the layout.
  const lockLabels = opts?.lock ? labelLockedPages(pages, lines, opts.lock) : null;
  for (const p of pages) {
    const page = pdf.addPage([PAGE_W, PAGE_H]);
    for (const op of p.ops) {
      drawText(page, op.bold ? faces.bold : faces.regular, op.text, op.x, op.y);
    }
    // Page numbers: top-right, "N.", omitted on the unnumbered first page unless
    // a lock has assigned it a letter (a rare A-page before page 1 stays shown).
    const numText = lockLabels?.get(p.number) ?? String(p.number);
    if (p.number > 1 || (lockLabels && numText !== "1")) {
      const label = `${numText}.`;
      drawText(page, faces.regular, label, RIGHT_EDGE - label.length * CHAR_W, PAGENO_Y);
    }
  }

  return pdf.save();
}
