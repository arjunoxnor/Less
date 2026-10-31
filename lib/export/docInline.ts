import type { JSONContent } from "@tiptap/core";
import { docFontOf, sizeOf } from "@/lib/editor/docFonts";
import { cleanHex } from "./styleRuns";

/**
 * A document's text as the Word and PDF exporters read it: each stretch with
 * its looks (bold, a font of its own, a highlight, a link), and hard breaks
 * and tabs called out, so neither exporter has to know about marks.
 */
export interface InlineRun {
  text: string;
  /** A line break instead of text. */
  br?: true;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  /** "#rrggbb". */
  color?: string;
  highlight?: string;
  /** The label of one of the document fonts (DOC_FONTS). */
  font?: string;
  /** Size in points. */
  sizePt?: number;
  href?: string;
}

export const pxToPt = (px: number) => px * 0.75;

/** A link only leaves the document if it is one a reader can safely follow. */
export function safeHref(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const url = v.trim();
  return /^(https?:|mailto:)/i.test(url) ? url : undefined;
}

export function inlineRuns(node: JSONContent): InlineRun[] {
  const out: InlineRun[] = [];
  const visit = (n: JSONContent) => {
    if (n.type === "hardBreak") {
      out.push({ text: "", br: true });
      return;
    }
    if (n.type !== "text") {
      n.content?.forEach(visit);
      return;
    }
    if (!n.text) return;
    const run: InlineRun = { text: n.text };
    for (const m of n.marks ?? []) {
      if (m.type === "bold") run.bold = true;
      else if (m.type === "italic") run.italic = true;
      else if (m.type === "underline") run.underline = true;
      else if (m.type === "strike") run.strike = true;
      else if (m.type === "code") run.code = true;
      else if (m.type === "highlight") run.highlight = cleanHex(m.attrs?.color) ?? "#fff1a8";
      else if (m.type === "link") run.href = safeHref(m.attrs?.href);
      else if (m.type === "textStyle") {
        const color = cleanHex(m.attrs?.color);
        if (color) run.color = color;
        const font = docFontOf(m.attrs?.fontFamily as string | null | undefined);
        if (font) run.font = font.label;
        const px = sizeOf(m.attrs?.fontSize as string | null | undefined);
        if (px) run.sizePt = pxToPt(px);
      }
    }
    out.push(run);
  };
  node.content?.forEach(visit);
  return out;
}

/** The line about a voice note still waiting to be transcribed. */
export function pendingVoiceLine(): string {
  return "[Voice note, not transcribed yet]";
}
