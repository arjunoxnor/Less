import type { JSONContent } from "@tiptap/core";
import { PDFDocument, PDFString, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { sanitize } from "./layout";
import { inlineRuns, pendingVoiceLine, pxToPt, type InlineRun } from "./docInline";

/**
 * A document as a PDF: US Letter with 1 inch margins, the page's own sizes and
 * spacing, and real text (selectable, with live links). Calibri and the other
 * fonts on offer are the reader's own, so they can't be embedded here: the
 * sans-serif ones print in Helvetica, the serif ones in Times, and Courier
 * Prime as itself. Those built-in faces cover Western text; a character they
 * lack prints as "?" and is counted, so the app can say so.
 */

export interface DocPdfOptions {
  /** The document's base font (a DOC_FONTS label). */
  font: string;
  sizePx: number;
}

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 72;
const INK = rgb(0.1, 0.1, 0.1);

type Family = "sans" | "serif" | "mono";
const familyOf = (label: string | undefined, base: Family): Family =>
  !label ? base : /times|georgia/i.test(label) ? "serif" : /courier/i.test(label) ? "mono" : "sans";

const colorOf = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

/** Something to place: a line of text, a rule, a table row. */
interface Item {
  h: number;
  /** Space above it, unless it opens a page. */
  gap: number;
  /** Stay on one page with the next item (a heading with what follows it). */
  keep?: boolean;
  /** Space below it, before the next block. */
  after?: number;
  draw: (page: PDFPage, x: number, top: number) => void;
}

interface Piece {
  text: string;
  w: number;
  size: number;
  font: PDFFont;
  run: InlineRun;
}

class Layout {
  missing = 0;
  private cache = new Map<string, PDFFont>();
  private monoBytes: Uint8Array[] | null = null;

  constructor(private pdf: PDFDocument, private base: Family, private sizePt: number) {}

  async prepare() {
    try {
      this.pdf.registerFontkit(fontkit);
      const names = ["Regular", "Bold", "Italic", "BoldItalic"];
      this.monoBytes = await Promise.all(
        names.map(async (n) => {
          const res = await fetch(`/fonts/CourierPrime-${n}.ttf`);
          if (!res.ok) throw new Error(String(res.status));
          return new Uint8Array(await res.arrayBuffer());
        })
      );
    } catch {
      this.monoBytes = null; // the built-in Courier does
    }
  }

  private async face(family: Family, bold: boolean, italic: boolean): Promise<PDFFont> {
    const key = `${family}${bold ? "b" : ""}${italic ? "i" : ""}`;
    const had = this.cache.get(key);
    if (had) return had;
    const std = {
      sans: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
      serif: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
      mono: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
    }[family];
    const i = (bold ? 1 : 0) + (italic ? 2 : 0);
    const bytes = family === "mono" ? this.monoBytes?.[i] : undefined;
    const font = await (bytes ? this.pdf.embedFont(bytes, { subset: true }) : this.pdf.embedFont(std[i]));
    this.cache.set(key, font);
    return font;
  }

  /** Text the font can draw: the built-in faces are Western only. */
  private clean(text: string): string {
    const flat = text.replace(/\n/g, " ");
    let out = "";
    for (const ch of flat) {
      const printed = sanitize(ch);
      if (printed === "?" && ch !== "?") this.missing++;
      out += printed;
    }
    return out;
  }

  /** Wrap a paragraph's runs to a width: one Item per printed line. */
  async lines(
    runs: InlineRun[],
    width: number,
    o: {
      size?: number;
      factor: number;
      bold?: boolean;
      color?: string;
      align?: unknown;
      after: number;
      keep?: boolean;
      fill?: string;
      /** Drawn beside the first line (a list marker). */
      marker?: { text: string; x: number };
    }
  ): Promise<Item[]> {
    const baseSize = o.size ?? this.sizePt;
    const rows: { pieces: Piece[]; w: number; forced: boolean }[] = [{ pieces: [], w: 0, forced: false }];
    const push = (p: Piece) => {
      const row = rows[rows.length - 1];
      row.pieces.push(p);
      row.w += p.w;
    };
    const newRow = (forced: boolean) => {
      rows[rows.length - 1].forced = forced;
      const row = rows[rows.length - 1];
      // A space at the end of a wrapped line takes no room.
      while (!forced && row.pieces.length && !row.pieces[row.pieces.length - 1].text.trim()) {
        row.w -= row.pieces.pop()!.w;
      }
      rows.push({ pieces: [], w: 0, forced: false });
    };
    for (const run of runs) {
      if (run.br) {
        newRow(true);
        continue;
      }
      const size = (run.sizePt ?? baseSize) * (run.code ? 0.9 : 1);
      const family = run.code ? "mono" : familyOf(run.font, this.base);
      const font = await this.face(family, !!run.bold || !!o.bold, !!run.italic);
      for (const token of this.clean(run.text).split(/(\s+)/)) {
        if (!token) continue;
        let w = font.widthOfTextAtSize(token, size);
        const blank = !token.trim();
        if (blank && rows[rows.length - 1].pieces.length === 0 && rows.length > 1 && !rows[rows.length - 2].forced) continue;
        if (!blank && rows[rows.length - 1].w + w > width && rows[rows.length - 1].w > 0) newRow(false);
        let rest = token;
        // A word wider than the line is cut to fit.
        while (w > width && rest.length > 1) {
          let n = rest.length - 1;
          while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), size) > width) n--;
          const head = rest.slice(0, n);
          push({ text: head, w: font.widthOfTextAtSize(head, size), size, font, run });
          newRow(false);
          rest = rest.slice(n);
          w = font.widthOfTextAtSize(rest, size);
        }
        push({ text: rest, w, size, font, run });
      }
    }
    const markerFont = o.marker ? await this.face(this.base, false, false) : null;
    return rows.map((row, index) => {
      const size = Math.max(baseSize, ...row.pieces.map((p) => p.size));
      const h = size * o.factor;
      const last = index === rows.length - 1;
      const spare = Math.max(0, width - row.w);
      const start = o.align === "center" ? spare / 2 : o.align === "right" ? spare : 0;
      const spaces = row.pieces.filter((p) => !p.text.trim()).length;
      const extra = o.align === "justify" && !last && !row.forced && spaces > 0 ? spare / spaces : 0;
      return {
        h,
        gap: 0,
        // No first or last line alone at a page edge.
        keep: o.keep || (rows.length > 1 && (index === 0 || index === rows.length - 2)),
        after: last ? o.after : 0,
        draw: (page: PDFPage, x: number, top: number) => {
          const baseline = top - (h - size) / 2 - size * 0.8;
          if (o.fill) page.drawRectangle({ x, y: top - h, width, height: h, color: colorOf(o.fill) });
          if (index === 0 && o.marker && markerFont) {
            page.drawText(o.marker.text, { x: x + o.marker.x, y: baseline, size: baseSize, font: markerFont, color: INK });
          }
          let at = x + start;
          for (const p of row.pieces) {
            const w = p.w + (!p.text.trim() ? extra : 0);
            if (p.run.highlight) page.drawRectangle({ x: at, y: top - h + (h - size) / 2 - size * 0.05, width: w, height: size * 1.1, color: colorOf(p.run.highlight) });
            const color = p.run.color ?? (p.run.href ? "#0563c1" : o.color);
            if (p.text.trim()) page.drawText(p.text, { x: at, y: baseline, size: p.size, font: p.font, color: color ? colorOf(color) : INK });
            if (p.run.underline || p.run.href) page.drawLine({ start: { x: at, y: baseline - p.size * 0.12 }, end: { x: at + w, y: baseline - p.size * 0.12 }, thickness: p.size * 0.05, color: color ? colorOf(color) : INK });
            if (p.run.strike) page.drawLine({ start: { x: at, y: baseline + p.size * 0.28 }, end: { x: at + w, y: baseline + p.size * 0.28 }, thickness: p.size * 0.05, color: INK });
            if (p.run.href) this.linkOn(page, at, baseline - p.size * 0.2, w, p.size * 1.1, p.run.href);
            at += w;
          }
        },
      };
    });
  }

  private linkOn(page: PDFPage, x: number, y: number, w: number, h: number, href: string) {
    const ctx = this.pdf.context;
    const annot = ctx.register(
      ctx.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [x, y, x + w, y + h],
        Border: [0, 0, 0],
        A: { Type: "Action", S: "URI", URI: PDFString.of(href) },
      })
    );
    page.node.addAnnot(annot);
  }

  private get after() {
    return this.sizePt * 0.8;
  }

  /** Every item a run of blocks makes, in a column this wide. */
  async blocks(nodes: JSONContent[], width: number, x = 0): Promise<Item[]> {
    const items: Item[] = [];
    let pendingGap = 0;
    for (const node of nodes) {
      const made = await this.block(node, width);
      if (made.length === 0) continue;
      made[0].gap = Math.max(made[0].gap, pendingGap);
      pendingGap = made[made.length - 1].after ?? this.after;
      for (const item of made) {
        items.push(x ? { ...item, draw: (p, px, top) => item.draw(p, px + x, top) } : item);
      }
    }
    return items;
  }

  private spacing(node: JSONContent, fallback: number) {
    const v = node.attrs?.lineSpacing;
    return typeof v === "number" ? v : fallback;
  }

  private async block(node: JSONContent, width: number): Promise<Item[]> {
    switch (node.type) {
      case "heading": {
        const level = Math.min(3, Math.max(1, Number(node.attrs?.level) || 1));
        const scale = [1.75, 1.4, 1.15][level - 1];
        const lh = [1.25, 1.3, 1.4][level - 1];
        const items = await this.lines(inlineRuns(node), width, {
          size: this.sizePt * scale,
          factor: this.spacing(node, lh),
          bold: true,
          align: node.attrs?.textAlign,
          after: this.after,
        });
        items.forEach((i) => (i.keep = true));
        return items;
      }
      case "paragraph":
        return this.lines(inlineRuns(node), width, {
          factor: this.spacing(node, 1.7),
          align: node.attrs?.textAlign,
          after: this.after,
        });
      case "bulletList":
      case "orderedList":
      case "taskList":
        return this.list(node, width, 0);
      case "blockquote": {
        const inner = await this.blocks(node.content ?? [], width - 14, 14);
        return inner.map((item) => ({
          ...item,
          draw: (p, x, top) => {
            item.draw(p, x, top);
            p.drawRectangle({ x, y: top - item.h, width: 2.2, height: item.h, color: rgb(0.75, 0.75, 0.75) });
          },
        }));
      }
      case "codeBlock": {
        const text = inlineRuns(node).map((r) => r.text).join("");
        const out: Item[] = [];
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const made = await this.lines([{ text: lines[i] || " ", code: true }], width, {
            factor: 1.5,
            fill: "#eeeeee",
            after: i === lines.length - 1 ? this.after : 0,
          });
          out.push(...made);
        }
        return out;
      }
      case "horizontalRule":
        return [
          {
            h: this.sizePt,
            gap: 0,
            draw: (p, x, top) =>
              p.drawLine({ start: { x, y: top - this.sizePt / 2 }, end: { x: x + width, y: top - this.sizePt / 2 }, thickness: 0.6, color: rgb(0.65, 0.65, 0.65) }),
          },
        ];
      case "table":
        return this.table(node, width);
      case "voiceNote":
        return this.blocks(node.content ?? [], width);
      case "voicePending":
        return this.lines([{ text: pendingVoiceLine(), italic: true }], width, { factor: 1.7, after: this.after });
      default:
        return node.content?.length
          ? this.lines(inlineRuns(node), width, { factor: 1.7, after: this.after })
          : [];
    }
  }

  private async list(node: JSONContent, width: number, depth: number): Promise<Item[]> {
    const ordered = node.type === "orderedList";
    const task = node.type === "taskList";
    const start = Number(node.attrs?.start);
    let number = Number.isFinite(start) && start > 0 ? Math.trunc(start) : 1;
    const indent = this.sizePt * 1.5;
    const out: Item[] = [];
    const add = (made: Item[]) => {
      if (made.length && out.length) made[0].gap = Math.max(made[0].gap, out[out.length - 1].after ?? 0);
      out.push(...made.map((i) => ({ ...i, draw: (p: PDFPage, x: number, top: number) => i.draw(p, x + indent, top) })));
    };
    for (const item of node.content ?? []) {
      let first = true;
      for (const child of item.content ?? []) {
        if (child.type === "bulletList" || child.type === "orderedList" || child.type === "taskList") {
          add(await this.list(child, width - indent, depth + 1));
        } else {
          const marker = first
            ? {
                text: task ? (item.attrs?.checked === true ? "[x]" : "[ ]") : ordered ? `${number}.` : depth === 0 ? "•" : "-",
                x: task ? -indent - 1 : -indent * 0.8,
              }
            : undefined;
          const made =
            child.type === "paragraph"
              ? await this.lines(inlineRuns(child), width - indent, {
                  factor: this.spacing(child, 1.7),
                  align: child.attrs?.textAlign,
                  after: this.sizePt * 0.2,
                  marker,
                })
              : await this.block(child, width - indent);
          add(made);
        }
        first = false;
      }
      number++;
    }
    if (out.length) out[out.length - 1].after = this.after;
    return out;
  }

  private async table(node: JSONContent, width: number): Promise<Item[]> {
    const rows = node.content ?? [];
    const span = (c: JSONContent) => Math.max(1, Number(c.attrs?.colspan) || 1);
    const cols = Math.max(1, ...rows.map((r) => (r.content ?? []).reduce((n, c) => n + span(c), 0)));
    const unit = width / cols;
    const pad = 5;
    const out: Item[] = [];
    for (const row of rows) {
      let col = 0;
      const cells: { x: number; w: number; items: Item[]; h: number; head: boolean }[] = [];
      for (const cell of row.content ?? []) {
        const w = unit * span(cell);
        const head = cell.type === "tableHeader";
        const content = head
          ? (cell.content ?? []).map((c) => ({
              ...c,
              content: (c.content ?? []).map((t) => (t.type === "text" ? { ...t, marks: [...(t.marks ?? []), { type: "bold" }] } : t)),
            }))
          : cell.content ?? [];
        const items = await this.blocks(content, w - pad * 2);
        const h = items.reduce((sum, i) => sum + i.gap + i.h, 0);
        cells.push({ x: col * unit, w, items, h, head });
        col += span(cell);
      }
      const h = Math.max(this.sizePt * 1.7, ...cells.map((c) => c.h)) + pad;
      out.push({
        h,
        gap: 0,
        draw: (p, x, top) => {
          for (const c of cells) {
            p.drawRectangle({
              x: x + c.x,
              y: top - h,
              width: c.w,
              height: h,
              borderColor: rgb(0.72, 0.72, 0.72),
              borderWidth: 0.6,
              ...(c.head ? { color: rgb(0.93, 0.93, 0.93) } : {}),
            });
            let y = top - pad / 2;
            for (const i of c.items) {
              y -= i.gap;
              i.draw(p, x + c.x + pad, y);
              y -= i.h;
            }
          }
        },
      });
    }
    if (out.length) out[out.length - 1].after = this.after;
    return out;
  }
}

export async function plainToPdf(
  doc: JSONContent,
  opts: DocPdfOptions
): Promise<{ bytes: Uint8Array; missing: number; pages: number }> {
  const pdf = await PDFDocument.create();
  const layout = new Layout(pdf, familyOf(opts.font, "sans"), pxToPt(opts.sizePx));
  await layout.prepare();
  const items = await layout.blocks(doc.content ?? [], PAGE_W - 2 * MARGIN);

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  const bottom = MARGIN;
  const atTop = () => y === PAGE_H - MARGIN;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const gap = atTop() ? 0 : item.gap;
    // What must stay with it: a heading, and the first line of what follows.
    let need = gap + item.h;
    for (let j = i; items[j]?.keep && items[j + 1]; j++) need += items[j + 1].gap + items[j + 1].h;
    if (y - need < bottom && !atTop()) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    } else {
      y -= gap;
    }
    item.draw(page, MARGIN, y);
    y -= item.h;
  }
  return { bytes: await pdf.save(), missing: layout.missing, pages: pdf.getPageCount() };
}
