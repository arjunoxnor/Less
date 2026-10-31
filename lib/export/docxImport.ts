import type { JSONContent } from "@tiptap/core";
import { safeHref } from "./docInline";
import { cleanHex } from "./styleRuns";

/**
 * A Word file as a LESS document, keeping what it was built from: headings,
 * bullet and numbered lists (nested), tables, bold, italic, underline, strike,
 * text colour, highlights, links and alignment. Fonts and sizes stay with the
 * document's own, so an imported page looks like the writer's other pages.
 * (A screenplay in a .docx goes through docImport.ts instead.)
 */

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PR = "http://schemas.openxmlformats.org/package/2006/relationships";

/** Word's named highlight colours, as the soft washes documents use. */
const NAMED_HIGHLIGHT: Record<string, string> = {
  yellow: "#fff1a8",
  green: "#c6f6c2",
  cyan: "#c2e0ff",
  blue: "#c2e0ff",
  magenta: "#ffc9e0",
  red: "#ffc9e0",
  lightgray: "#e8e8e8",
  darkyellow: "#fff1a8",
};

const child = (el: Element, name: string) => {
  for (const c of Array.from(el.children)) if (c.localName === name && c.namespaceURI === W) return c;
  return null;
};
const children = (el: Element, name: string) =>
  Array.from(el.children).filter((c) => c.localName === name && c.namespaceURI === W);
const val = (el: Element | null) => el?.getAttributeNS(W, "val") ?? null;
/** A toggle like <w:b/>, on unless it says off. */
const on = (el: Element | null) => !!el && !["0", "false", "none"].includes(val(el) ?? "");

function parse(xml: string | undefined | null): Document | null {
  if (!xml) return null;
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return doc.querySelector("parsererror") ? null : doc;
}

interface Ctx {
  styles: Map<string, string>;
  /** numId to the format of each level ("bullet", "decimal", ...), and starts. */
  numbering: Map<string, { formats: string[]; starts: number[] }>;
  links: Map<string, string>;
}

function readContext(files: Record<string, string | undefined>): Ctx {
  const styles = new Map<string, string>();
  for (const s of Array.from(parse(files.styles)?.getElementsByTagNameNS(W, "style") ?? [])) {
    const id = s.getAttributeNS(W, "styleId");
    const name = val(child(s, "name"));
    if (id && name) styles.set(id, name.toLowerCase());
  }
  const numbering = new Map<string, { formats: string[]; starts: number[] }>();
  const numDoc = parse(files.numbering);
  if (numDoc) {
    const abstract = new Map<string, { formats: string[]; starts: number[] }>();
    for (const a of Array.from(numDoc.getElementsByTagNameNS(W, "abstractNum"))) {
      const formats: string[] = [];
      const starts: number[] = [];
      for (const lvl of children(a, "lvl")) {
        const i = Number(lvl.getAttributeNS(W, "ilvl")) || 0;
        formats[i] = val(child(lvl, "numFmt")) ?? "bullet";
        starts[i] = Number(val(child(lvl, "start"))) || 1;
      }
      abstract.set(a.getAttributeNS(W, "abstractNumId") ?? "", { formats, starts });
    }
    for (const n of Array.from(numDoc.getElementsByTagNameNS(W, "num"))) {
      const base = abstract.get(val(child(n, "abstractNumId")) ?? "");
      if (base) numbering.set(n.getAttributeNS(W, "numId") ?? "", base);
    }
  }
  const links = new Map<string, string>();
  for (const r of Array.from(parse(files.rels)?.getElementsByTagNameNS(PR, "Relationship") ?? [])) {
    const href = safeHref(r.getAttribute("Target"));
    if (href && /hyperlink$/.test(r.getAttribute("Type") ?? "")) links.set(r.getAttribute("Id") ?? "", href);
  }
  return { styles, numbering, links };
}

function runMarks(rPr: Element | null, href: string | undefined): NonNullable<JSONContent["marks"]> {
  const marks: NonNullable<JSONContent["marks"]> = [];
  if (href) marks.push({ type: "link", attrs: { href } });
  if (!rPr) return marks;
  if (on(child(rPr, "b"))) marks.push({ type: "bold" });
  if (on(child(rPr, "i"))) marks.push({ type: "italic" });
  if (on(child(rPr, "u"))) marks.push({ type: "underline" });
  if (on(child(rPr, "strike"))) marks.push({ type: "strike" });
  const color = cleanHex(`#${val(child(rPr, "color")) ?? ""}`);
  // A link's colour is the link's; black is just the page's ink.
  if (color && color !== "#000000" && !href) marks.push({ type: "textStyle", attrs: { color } });
  const named = val(child(rPr, "highlight"));
  const fill = cleanHex(`#${child(rPr, "shd")?.getAttributeNS(W, "fill") ?? ""}`);
  const highlight = (named && named !== "none" ? NAMED_HIGHLIGHT[named.toLowerCase()] : undefined) ?? (fill && fill !== "#ffffff" ? fill : undefined);
  if (highlight) marks.push({ type: "highlight", attrs: { color: highlight } });
  return marks;
}

/** A paragraph's text as editor nodes. */
function inline(p: Element, ctx: Ctx): JSONContent[] {
  const out: JSONContent[] = [];
  const addText = (text: string, marks: NonNullable<JSONContent["marks"]>) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last?.type === "text" && JSON.stringify(last.marks ?? []) === JSON.stringify(marks)) last.text += text;
    else out.push(marks.length ? { type: "text", text, marks } : { type: "text", text });
  };
  const walk = (el: Element, href?: string) => {
    for (const c of Array.from(el.children)) {
      if (c.namespaceURI !== W) continue;
      if (c.localName === "hyperlink") {
        walk(c, ctx.links.get(c.getAttributeNS(R, "id") ?? "") ?? href);
      } else if (c.localName === "r") {
        const marks = runMarks(child(c, "rPr"), href);
        for (const piece of Array.from(c.children)) {
          if (piece.namespaceURI !== W) continue;
          if (piece.localName === "t") addText(piece.textContent ?? "", marks);
          else if (piece.localName === "tab") addText("\t", marks);
          else if (piece.localName === "br" && piece.getAttributeNS(W, "type") !== "page") out.push({ type: "hardBreak" });
        }
      } else if (c.localName === "ins" || c.localName === "smartTag" || c.localName === "sdt" || c.localName === "sdtContent") {
        walk(c, href); // tracked insertions and content controls hold real runs
      }
    }
  };
  walk(p);
  return out;
}

function paragraphAttrs(pPr: Element | null): Record<string, unknown> | undefined {
  const jc = val(pPr ? child(pPr, "jc") : null);
  const align = jc === "center" ? "center" : jc === "right" || jc === "end" ? "right" : jc === "both" ? "justify" : null;
  return align ? { textAlign: align } : undefined;
}

function headingLevel(style: string | undefined): number | null {
  if (!style) return null;
  if (style === "title") return 1;
  if (style === "subtitle") return 2;
  const m = /^heading\s*(\d)/.exec(style);
  return m ? Math.min(3, Number(m[1])) : null;
}

const block = (type: string, content: JSONContent[], attrs?: Record<string, unknown>): JSONContent => ({
  type,
  ...(attrs ? { attrs } : {}),
  ...(content.length ? { content } : {}),
});

/** Runs of body elements as document blocks; neighbouring list paragraphs become one list. */
function blocks(els: Element[], ctx: Ctx): JSONContent[] {
  const out: JSONContent[] = [];
  /** The lists open now, outermost first. */
  let open: { numId: string; level: number; list: JSONContent; last: JSONContent | null }[] = [];

  for (const el of els) {
    if (el.localName === "tbl") {
      open = [];
      out.push(tableOf(el, ctx));
      continue;
    }
    if (el.localName === "sdt") {
      const inner = child(el, "sdtContent");
      if (inner) out.push(...blocks(Array.from(inner.children).filter((c) => c.namespaceURI === W), ctx));
      continue;
    }
    if (el.localName !== "p") continue;

    const pPr = child(el, "pPr");
    const styleId = val(pPr ? child(pPr, "pStyle") : null);
    const style = styleId ? ctx.styles.get(styleId) ?? styleId.toLowerCase() : undefined;
    const numPr = pPr ? child(pPr, "numPr") : null;
    const numId = val(numPr ? child(numPr, "numId") : null);
    const level = Number(val(numPr ? child(numPr, "ilvl") : null)) || 0;
    const content = inline(el, ctx);
    const heading = headingLevel(style);

    if (numId && numId !== "0" && !heading) {
      const def = ctx.numbering.get(numId);
      const format = def?.formats[level] ?? "bullet";
      const ordered = format !== "bullet" && format !== "none";
      const item: JSONContent = { type: "listItem", content: [block("paragraph", content)] };
      while (open.length && open[open.length - 1].level > level) open.pop();
      const top = open[open.length - 1];
      if (top && top.level === level && top.numId === numId) {
        top.list.content!.push(item);
        top.last = item;
      } else {
        if (top && top.level === level) open.pop();
        const start = def?.starts[level] ?? 1;
        const list: JSONContent = {
          type: ordered ? "orderedList" : "bulletList",
          ...(ordered && start !== 1 ? { attrs: { start } } : {}),
          content: [item],
        };
        const parent = open[open.length - 1];
        if (parent?.last) parent.last.content!.push(list);
        else out.push(list);
        open.push({ numId, level, list, last: item });
      }
      continue;
    }

    open = [];
    // The empty paragraph Word needs after a table is not writing.
    if (!heading && content.length === 0 && out[out.length - 1]?.type === "table") continue;
    if (heading) out.push(block("heading", content, { level: heading, ...paragraphAttrs(pPr) }));
    else if (/^(quote|intense quote|block text)$/.test(style ?? "")) {
      out.push(block("blockquote", [block("paragraph", content)]));
    } else out.push(block("paragraph", content, paragraphAttrs(pPr)));
  }
  return out;
}

function tableOf(tbl: Element, ctx: Ctx): JSONContent {
  const rows: JSONContent[] = [];
  for (const tr of children(tbl, "tr")) {
    const trPr = child(tr, "trPr");
    const header = !!trPr && on(child(trPr, "tblHeader"));
    const cells: JSONContent[] = [];
    for (const tc of children(tr, "tc")) {
      const tcPr = child(tc, "tcPr");
      const colspan = Number(val(tcPr ? child(tcPr, "gridSpan") : null)) || 1;
      const inner = blocks(Array.from(tc.children).filter((c) => c.namespaceURI === W), ctx);
      cells.push({
        type: header ? "tableHeader" : "tableCell",
        ...(colspan > 1 ? { attrs: { colspan } } : {}),
        content: inner.length ? inner : [{ type: "paragraph" }],
      });
    }
    if (cells.length) rows.push({ type: "tableRow", content: cells });
  }
  return { type: "table", content: rows };
}

export async function docxToPlainDoc(buf: ArrayBuffer): Promise<JSONContent> {
  const { strFromU8, unzipSync } = await import("fflate");
  const zip = unzipSync(new Uint8Array(buf));
  const read = (path: string) => (zip[path] ? strFromU8(zip[path]) : undefined);
  const ctx = readContext({
    styles: read("word/styles.xml"),
    numbering: read("word/numbering.xml"),
    rels: read("word/_rels/document.xml.rels"),
  });
  const doc = parse(read("word/document.xml"));
  const body = doc?.getElementsByTagNameNS(W, "body")[0];
  const content = body ? blocks(Array.from(body.children).filter((c) => c.namespaceURI === W), ctx) : [];
  // Word ends every section with an empty paragraph it does not show.
  while (content.length > 1 && content[content.length - 1].type === "paragraph" && !content[content.length - 1].content) content.pop();
  // A table cannot be the last thing in a document the caret has to leave.
  if (content[content.length - 1]?.type === "table") content.push({ type: "paragraph" });
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}
