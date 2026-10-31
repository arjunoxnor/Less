// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import type { JSONContent } from "@tiptap/core";
import { docxParts, plainToDocx } from "./docx";
import { plainToPdf } from "./docPdf";
import { plainToMarkdown, plainToText } from "./plainExport";

const text = (t: string, marks?: JSONContent["marks"]) => ({ type: "text", text: t, ...(marks ? { marks } : {}) });
const para = (...content: JSONContent[]) => ({ type: "paragraph", content });
const look = { font: "Georgia", sizePx: 16 };

const doc: JSONContent = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [text("Act <One> & more")] },
    {
      type: "paragraph",
      attrs: { textAlign: "center", lineSpacing: 2.4 },
      content: [
        text("She "),
        text("runs", [{ type: "bold" }, { type: "italic" }]),
        text(" fast", [{ type: "highlight", attrs: { color: "#fff1a8" } }, { type: "underline" }]),
        { type: "hardBreak" },
        text("site", [{ type: "link", attrs: { href: "https://example.com/?a=1&b=2" } }]),
        text(" big", [{ type: "textStyle", attrs: { fontFamily: "Arial", fontSize: "24px", color: "#d83a3a" } }]),
      ],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            para(text("One")),
            { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [para(text("Nested"))] }] },
          ],
        },
      ],
    },
    { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [para(text("Done"))] }] },
    { type: "blockquote", content: [para(text("Quoted."))] },
    { type: "codeBlock", content: [text("a\nb")] },
    { type: "horizontalRule" },
    {
      type: "table",
      content: [
        { type: "tableRow", content: [{ type: "tableHeader", content: [para(text("H1"))] }, { type: "tableHeader", content: [para(text("H2"))] }] },
        { type: "tableRow", content: [{ type: "tableCell", attrs: { colspan: 2 }, content: [para(text("Wide"))] }] },
      ],
    },
    { type: "voicePending", attrs: {} },
  ],
};

describe("Word export", () => {
  const parts = docxParts(doc, look);
  const xml = parts["word/document.xml"];

  it("writes well-formed parts", () => {
    for (const [name, body] of Object.entries(parts)) {
      const parsed = new DOMParser().parseFromString(body, "application/xml");
      expect(parsed.querySelector("parsererror"), name).toBeNull();
    }
  });

  it("uses real Word structure", () => {
    expect(xml).toContain('<w:pStyle w:val="Heading1"/>');
    expect(xml).toContain("Act &lt;One&gt; &amp; more");
    expect(xml).toContain('<w:jc w:val="center"/>');
    expect(xml).toContain('w:line="480"');
    expect(xml).toContain("<w:b/><w:bCs/><w:i/><w:iCs/>");
    expect(xml).toContain('w:fill="FFF1A8"');
    expect(xml).toContain('<w:u w:val="single"/>');
    expect(xml).toContain("<w:r><w:br/></w:r>");
    expect(xml).toContain('<w:hyperlink r:id="rId11">');
    expect(parts["word/_rels/document.xml.rels"]).toContain('Target="https://example.com/?a=1&amp;b=2"');
    expect(xml).toContain('w:ascii="Arial"');
    expect(xml).toContain('<w:sz w:val="36"/>');
    expect(xml).toContain('<w:color w:val="D83A3A"/>');
    // A bullet list, with a numbered list inside it that starts at 3.
    expect(xml).toContain('<w:ilvl w:val="0"/><w:numId w:val="1"/>');
    expect(xml).toContain('<w:ilvl w:val="1"/><w:numId w:val="2"/>');
    expect(parts["word/numbering.xml"]).toContain('<w:startOverride w:val="3"/>');
    expect(xml).toContain("☑ ");
    expect(xml).toContain("<w:tblHeader/>");
    expect(xml).toContain('<w:gridSpan w:val="2"/>');
    expect(parts["word/styles.xml"]).toContain('w:ascii="Georgia"');
  });

  it("zips into a file with the parts Word looks for", async () => {
    const files = unzipSync(await plainToDocx(doc, look));
    expect(Object.keys(files).sort()).toEqual(Object.keys(parts).sort());
    expect(strFromU8(files["word/document.xml"])).toBe(xml);
  });

  it("drops a link that is not safe to follow", () => {
    const risky = docxParts(
      { type: "doc", content: [para(text("x", [{ type: "link", attrs: { href: "javascript:alert(1)" } }]))] },
      look
    );
    expect(risky["word/document.xml"]).not.toContain("hyperlink");
    expect(risky["word/_rels/document.xml.rels"]).not.toContain("javascript");
  });
});

describe("PDF export", () => {
  it("makes a real PDF of every kind of block", async () => {
    const { bytes, pages, missing } = await plainToPdf(doc, look);
    expect(bytes.length).toBeGreaterThan(1000);
    expect(pages).toBe(1);
    expect(missing).toBe(0);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("flows long documents and long tables onto more pages", async () => {
    const long = Array.from({ length: 120 }, (_, i) => para(text(`Paragraph ${i} `.repeat(30))));
    expect((await plainToPdf({ type: "doc", content: long }, look)).pages).toBeGreaterThan(3);
    const table = {
      type: "table",
      content: Array.from({ length: 80 }, (_, i) => ({
        type: "tableRow",
        content: [{ type: "tableCell", content: [para(text(`Row ${i}`))] }],
      })),
    };
    expect((await plainToPdf({ type: "doc", content: [table] }, look)).pages).toBeGreaterThan(1);
  });

  it("counts what the built-in fonts cannot print, and never fails on it", async () => {
    const { missing } = await plainToPdf({ type: "doc", content: [para(text("Hello नमस्ते"))] }, look);
    expect(missing).toBe(6);
  });

  it("survives an empty document and a word wider than the page", async () => {
    expect((await plainToPdf({ type: "doc", content: [] }, look)).pages).toBe(1);
    expect((await plainToPdf({ type: "doc", content: [para(text("x".repeat(900)))] }, look)).pages).toBe(1);
  });
});

describe("tables in Markdown and plain text", () => {
  it("come out as tables", () => {
    expect(plainToMarkdown(doc)).toContain("| H1 | H2 |\n| --- | --- |\n| Wide |  |");
    expect(plainToText(doc)).toContain("H1\tH2\nWide");
  });
});
