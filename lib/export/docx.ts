import type { JSONContent } from "@tiptap/core";
import { pendingVoiceLine, inlineRuns, pxToPt, type InlineRun } from "./docInline";

/**
 * A document as a Word file (.docx), written by hand: a .docx is a zip of a
 * few XML parts, and fflate (already used to read them) writes the zip. It
 * carries real Word structure, not just looks: heading styles, real lists,
 * tables, links, so the file keeps working as a document in Word.
 */

export interface DocxOptions {
  /** The document's base font (a DOC_FONTS label). */
  font: string;
  sizePx: number;
}

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const FORBIDDEN = /[^\u0009\u000A\u000D -퟿-�\u{10000}-\u{10FFFF}]/gu;
const esc = (s: string) =>
  s
    .replace(FORBIDDEN, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const hex = (color: string) => color.slice(1).toUpperCase();

function runProps(run: InlineRun, extra?: Partial<InlineRun>): string {
  const r = { ...extra, ...run };
  let x = "";
  const font = r.code ? "Courier New" : r.font;
  if (font) x += `<w:rFonts w:ascii="${esc(font)}" w:hAnsi="${esc(font)}" w:cs="${esc(font)}"/>`;
  if (r.bold) x += "<w:b/><w:bCs/>";
  if (r.italic) x += "<w:i/><w:iCs/>";
  if (r.strike) x += "<w:strike/>";
  if (r.color) x += `<w:color w:val="${hex(r.color)}"/>`;
  else if (r.href) x += '<w:color w:val="0563C1"/>';
  if (r.sizePt) x += `<w:sz w:val="${Math.round(r.sizePt * 2)}"/><w:szCs w:val="${Math.round(r.sizePt * 2)}"/>`;
  if (r.underline || r.href) x += '<w:u w:val="single"/>';
  if (r.highlight) x += `<w:shd w:val="clear" w:color="auto" w:fill="${hex(r.highlight)}"/>`;
  return x ? `<w:rPr>${x}</w:rPr>` : "";
}

/** One run's text, tabs as Word's own tab. */
function runBody(text: string): string {
  return text
    .split("\t")
    .map((piece) => (piece ? `<w:t xml:space="preserve">${esc(piece)}</w:t>` : ""))
    .join("<w:tab/>");
}

class Writer {
  rels: string[] = [];
  /** Numbered lists each restart at their own number (w:num). */
  numbered: number[] = [];
  constructor(private opts: DocxOptions) {}

  /** The space after a paragraph, 0.8 of the text size (as on the page), in twips. */
  private get after() {
    return Math.round(pxToPt(this.opts.sizePx) * 0.8 * 20);
  }

  private link(href: string): string {
    this.rels.push(href);
    return `rId${this.rels.length + 10}`;
  }

  runs(runs: InlineRun[], extra?: Partial<InlineRun>): string {
    return runs
      .map((run) => {
        if (run.br) return "<w:r><w:br/></w:r>";
        const body = `<w:r>${runProps(run, extra)}${runBody(run.text)}</w:r>`;
        return run.href ? `<w:hyperlink r:id="${this.link(run.href)}">${body}</w:hyperlink>` : body;
      })
      .join("");
  }

  /** A paragraph's own settings, in the order the Word schema requires. */
  private pPr(node: JSONContent | null, o: { style?: string; num?: [number, number]; ind?: number; hanging?: number; quote?: boolean; after?: number }) {
    let x = "";
    if (o.style) x += `<w:pStyle w:val="${o.style}"/>`;
    if (o.num) x += `<w:numPr><w:ilvl w:val="${o.num[1]}"/><w:numId w:val="${o.num[0]}"/></w:numPr>`;
    if (o.quote) x += '<w:pBdr><w:left w:val="single" w:sz="18" w:space="10" w:color="BBBBBB"/></w:pBdr>';
    const spacing = node?.attrs?.lineSpacing;
    const line = typeof spacing === "number" ? ` w:line="${Math.round((spacing / 1.2) * 240)}" w:lineRule="auto"` : "";
    x += `<w:spacing w:after="${o.after ?? this.after}"${line}/>`;
    if (o.ind != null) x += `<w:ind w:left="${o.ind}"${o.hanging ? ` w:hanging="${o.hanging}"` : ""}/>`;
    const align = node?.attrs?.textAlign;
    if (align === "center" || align === "right") x += `<w:jc w:val="${align}"/>`;
    else if (align === "justify") x += '<w:jc w:val="both"/>';
    return `<w:pPr>${x}</w:pPr>`;
  }

  paragraph(node: JSONContent, o: Parameters<Writer["pPr"]>[1] = {}, extra?: Partial<InlineRun>): string {
    return `<w:p>${this.pPr(node, o)}${this.runs(inlineRuns(node), extra)}</w:p>`;
  }

  list(node: JSONContent, depth: number, quote: boolean): string {
    let numId = 1;
    if (node.type === "orderedList") {
      const start = Number(node.attrs?.start);
      this.numbered.push(Number.isFinite(start) && start > 0 ? Math.trunc(start) : 1);
      numId = this.numbered.length + 1;
    }
    const ind = 360 * (depth + 1);
    let out = "";
    for (const item of node.content ?? []) {
      let first = true;
      for (const child of item.content ?? []) {
        if (child.type === "bulletList" || child.type === "orderedList" || child.type === "taskList") {
          out += this.list(child, depth + 1, quote);
        } else if (child.type === "paragraph" && first) {
          out +=
            node.type === "taskList"
              ? `<w:p>${this.pPr(child, { ind, hanging: 360, quote, after: 40 })}${this.runs([
                  { text: item.attrs?.checked === true ? "☑ " : "☐ " },
                  ...inlineRuns(child),
                ])}</w:p>`
              : this.paragraph(child, { num: [numId, Math.min(depth, 2)], quote, after: 40 });
        } else {
          out += this.block(child, ind, quote);
        }
        first = false;
      }
    }
    return out;
  }

  table(node: JSONContent): string {
    const rows = node.content ?? [];
    const span = (c: JSONContent) => Math.max(1, Number(c.attrs?.colspan) || 1);
    const cols = Math.max(1, ...rows.map((r) => (r.content ?? []).reduce((n, c) => n + span(c), 0)));
    const cw = Math.floor(9360 / cols);
    const border = (n: string) => `<w:${n} w:val="single" w:sz="4" w:space="0" w:color="BBBBBB"/>`;
    let x =
      '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>' +
      ["top", "left", "bottom", "right", "insideH", "insideV"].map(border).join("") +
      "</w:tblBorders></w:tblPr><w:tblGrid>" +
      `<w:gridCol w:w="${cw}"/>`.repeat(cols) +
      "</w:tblGrid>";
    for (const row of rows) {
      const header = (row.content ?? []).every((c) => c.type === "tableHeader");
      x += `<w:tr>${header ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}`;
      for (const cell of row.content ?? []) {
        const n = span(cell);
        x += `<w:tc><w:tcPr><w:tcW w:w="${cw * n}" w:type="dxa"/>${n > 1 ? `<w:gridSpan w:val="${n}"/>` : ""}${
          cell.type === "tableHeader" ? '<w:shd w:val="clear" w:color="auto" w:fill="EEEEEE"/>' : ""
        }</w:tcPr>`;
        let inner = "";
        for (const child of cell.content ?? []) {
          inner +=
            child.type === "paragraph"
              ? this.paragraph(child, { after: 0 }, cell.type === "tableHeader" ? { bold: true } : undefined)
              : this.block(child, 0, false);
        }
        // Word requires every cell to end in a paragraph.
        x += `${inner}${inner.endsWith("</w:p>") ? "" : "<w:p/>"}</w:tc>`;
      }
      x += "</w:tr>";
    }
    return `${x}</w:tbl><w:p><w:pPr><w:spacing w:after="${this.after}"/></w:pPr></w:p>`;
  }

  block(node: JSONContent, ind: number | undefined = undefined, quote = false): string {
    switch (node.type) {
      case "heading": {
        const level = Math.min(3, Math.max(1, Number(node.attrs?.level) || 1));
        return this.paragraph(node, { style: `Heading${level}`, ind, quote });
      }
      case "paragraph":
        return this.paragraph(node, { ind, quote });
      case "bulletList":
      case "orderedList":
      case "taskList":
        return this.list(node, 0, quote);
      case "blockquote":
        return (node.content ?? []).map((c) => this.block(c, (ind ?? 0) + 280, true)).join("");
      case "codeBlock":
        return (inlineRuns(node).map((r) => r.text).join("") || "")
          .split("\n")
          .map(
            (line) =>
              `<w:p>${this.pPr(null, { ind, after: 0 })}<w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/><w:shd w:val="clear" w:color="auto" w:fill="EEEEEE"/></w:rPr>${runBody(line)}</w:r></w:p>`
          )
          .join("");
      case "horizontalRule":
        return `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="AAAAAA"/></w:pBdr><w:spacing w:after="${this.after}"/></w:pPr></w:p>`;
      case "table":
        return this.table(node);
      case "voiceNote":
        return (node.content ?? []).map((c) => this.block(c, ind, quote)).join("");
      case "voicePending":
        return `<w:p>${this.pPr(null, { ind })}<w:r><w:rPr><w:i/></w:rPr>${runBody(pendingVoiceLine())}</w:r></w:p>`;
      default:
        return node.content?.length ? `<w:p>${this.pPr(node, { ind })}${this.runs(inlineRuns(node))}</w:p>` : "";
    }
  }
}

function stylesXml(opts: DocxOptions): string {
  const pt = pxToPt(opts.sizePx);
  const half = Math.round(pt * 2);
  const heading = (n: number, scale: number) =>
    `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>` +
    `<w:pPr><w:keepNext/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="${Math.round(half * scale)}"/><w:szCs w:val="${Math.round(half * scale)}"/></w:rPr></w:style>`;
  const font = esc(opts.font);
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr>` +
    `<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}" w:eastAsia="${font}"/><w:sz w:val="${half}"/><w:szCs w:val="${half}"/></w:rPr></w:rPrDefault>` +
    // The page's own rhythm: lines at 1.7, in Word's terms (240 is single, about 1.2).
    '<w:pPrDefault><w:pPr><w:spacing w:line="340" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    heading(1, 1.75) +
    heading(2, 1.4) +
    heading(3, 1.15) +
    "</w:styles>"
  );
}

function numberingXml(starts: number[]): string {
  const levels = (fmt: string, texts: string[]) =>
    texts
      .map(
        (text, i) =>
          `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${360 * (i + 1)}" w:hanging="360"/></w:pPr></w:lvl>`
      )
      .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${NS}>` +
    `<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${levels("bullet", ["•", "◦", "▪"])}</w:abstractNum>` +
    `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${levels("decimal", ["%1.", "%2.", "%3."])}</w:abstractNum>` +
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
    starts
      .map(
        (start, i) =>
          `<w:num w:numId="${i + 2}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="${start}"/></w:lvlOverride></w:num>`
      )
      .join("") +
    "</w:numbering>"
  );
}

/** The parts of the file, by their paths inside the zip. */
export function docxParts(doc: JSONContent, opts: DocxOptions): Record<string, string> {
  const w = new Writer(opts);
  const body = (doc.content ?? []).map((n) => w.block(n)).join("");
  const links = w.rels
    .map(
      (href, i) =>
        `<Relationship Id="rId${i + 11}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(href)}" TargetMode="External"/>`
    )
    .join("");
  const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  return {
    "[Content_Types].xml":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>',
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/styles" Target="styles.xml"/><Relationship Id="rId2" Type="${REL}/numbering" Target="numbering.xml"/>${links}</Relationships>`,
    "word/styles.xml": stylesXml(opts),
    "word/numbering.xml": numberingXml(w.numbered),
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`,
  };
}

export async function plainToDocx(doc: JSONContent, opts: DocxOptions): Promise<Uint8Array> {
  const { strToU8, zipSync } = await import("fflate");
  const parts = docxParts(doc, opts);
  return zipSync(Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, strToU8(v)])));
}
