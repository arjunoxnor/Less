// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import type { JSONContent } from "@tiptap/core";
import type { ScriptLine } from "@/types/screenplay";
import { docxParts, plainToDocx } from "./docx";
import { docxToPlainDoc } from "./docxImport";
import { paginate } from "./paginate";
import { PAGE_H, PAGE_W, CHAR_W } from "./layout";
import { looksLikeScreenplay, pdfToPlainDoc, pdfToScript, type PdfPage } from "./pdfImport";

const text = (t: string, marks?: JSONContent["marks"]) => ({ type: "text", text: t, ...(marks ? { marks } : {}) });
const para = (...content: JSONContent[]) => ({ type: "paragraph", content });

describe("Word files keep their structure", () => {
  const original: JSONContent = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [text("Title")] },
      { type: "heading", attrs: { level: 3 }, content: [text("Small")] },
      { type: "paragraph", attrs: { textAlign: "center" }, content: [text("Hi "), text("bold", [{ type: "bold" }]), text(" "), text("link", [{ type: "link", attrs: { href: "https://example.com/" } }])] },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              para(text("One")),
              { type: "orderedList", content: [{ type: "listItem", content: [para(text("Inner a"))] }, { type: "listItem", content: [para(text("Inner b"))] }] },
            ],
          },
          { type: "listItem", content: [para(text("Two"))] },
        ],
      },
      para(text("Between.")),
      { type: "orderedList", content: [{ type: "listItem", content: [para(text("Fresh list"))] }] },
      {
        type: "table",
        content: [
          { type: "tableRow", content: [{ type: "tableHeader", content: [para(text("H"))] }, { type: "tableHeader", content: [para(text("I"))] }] },
          { type: "tableRow", content: [{ type: "tableCell", attrs: { colspan: 2 }, content: [para(text("Wide"))] }] },
        ],
      },
      para(text("End", [{ type: "highlight", attrs: { color: "#c2e0ff" } }, { type: "italic" }])),
    ],
  };

  it("reads back what the Word export writes", async () => {
    const bytes = await plainToDocx(original, { font: "Calibri", sizePx: 16 });
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const doc = await docxToPlainDoc(buf);
    const kinds = doc.content!.map((n) => n.type);
    expect(kinds).toEqual(["heading", "heading", "paragraph", "bulletList", "paragraph", "orderedList", "table", "paragraph"]);
    expect(doc.content![0].attrs?.level).toBe(1);
    expect(doc.content![1].attrs?.level).toBe(3);
    expect(doc.content![2].attrs?.textAlign).toBe("center");
    const marks = doc.content![2].content!.map((n) => n.marks?.[0]?.type);
    expect(marks).toEqual([undefined, "bold", undefined, "link"]);
    expect(doc.content![2].content![3].marks?.[0].attrs?.href).toBe("https://example.com/");
    const bullets = doc.content![3];
    expect(bullets.content).toHaveLength(2);
    const nested = bullets.content![0].content![1];
    expect(nested.type).toBe("orderedList");
    expect(nested.content).toHaveLength(2);
    const table = doc.content![6];
    expect(table.content![0].content![0].type).toBe("tableHeader");
    expect(table.content![1].content![0].attrs?.colspan).toBe(2);
    const end = doc.content![7].content![0];
    expect(end.marks?.map((m) => m.type).sort()).toEqual(["highlight", "italic"]);
  });

  it("takes the file's parts even if some are missing", async () => {
    const { strToU8, zipSync } = await import("fflate");
    const parts = docxParts({ type: "doc", content: [para(text("Only."))] }, { font: "Arial", sizePx: 16 });
    const bytes = zipSync({ "word/document.xml": strToU8(parts["word/document.xml"]) });
    const doc = await docxToPlainDoc(bytes.buffer.slice(0) as ArrayBuffer);
    expect(doc.content).toEqual([para(text("Only."))]);
  });
});

/** A script as a PDF reader would see it: every printed row, at its place. */
function asPdf(lines: ScriptLine[], opts?: Parameters<typeof paginate>[1]): PdfPage[] {
  return paginate(lines, opts).pages.map((page) => ({
    width: PAGE_W,
    height: PAGE_H,
    words: [
      ...page.ops.map((op) => ({ str: op.text, x: op.x, y: op.y, w: op.text.length * CHAR_W, size: 12 })),
      ...(page.number > 1 ? [{ str: `${page.number}.`, x: 500, y: 744, w: 20, size: 12 }] : []),
    ],
  }));
}

const script: ScriptLine[] = [
  { element: "scene_heading", text: "INT. KITCHEN - NIGHT" },
  { element: "action", text: "Mara stands at the sink, watching the rain come down the window, and she does not turn when the door opens behind her." },
  { element: "character", text: "JO" },
  { element: "parenthetical", text: "(quietly)" },
  { element: "dialogue", text: "You came back. I did not think you would, after everything that was said on that pier." },
  { element: "character", text: "MARA (V.O.)" },
  { element: "dialogue", text: "Neither did I." },
  { element: "transition", text: "CUT TO:" },
  { element: "scene_heading", text: "EXT. PIER - DAY" },
  { element: "action", text: "Gulls." },
];

describe("a screenplay PDF", () => {
  it("comes back line for line", () => {
    const pages = asPdf(script);
    expect(looksLikeScreenplay(pages)).toBe(true);
    expect(pdfToScript(pages).lines).toEqual(script);
  });

  it("ignores page numbers and margin scene numbers, across pages", () => {
    const long: ScriptLine[] = [];
    for (let i = 1; i <= 40; i++) {
      long.push({ element: "scene_heading", text: `INT. ROOM ${i} - DAY` });
      long.push({ element: "action", text: `Something happens in room ${i}.` });
      long.push({ element: "character", text: "ANNA" });
      long.push({ element: "dialogue", text: `This is line ${i}.` });
    }
    const pages = asPdf(long, { sceneNumbers: true });
    expect(pages.length).toBeGreaterThan(2);
    expect(pdfToScript(pages).lines).toEqual(long);
  });

  it("joins a speech that (MORE) and (CONT'D) carried over a page", () => {
    const filler: ScriptLine[] = [{ element: "scene_heading", text: "INT. HALL - DAY" }];
    for (let i = 0; i < 22; i++) filler.push({ element: "action", text: `Beat ${i}.` });
    const speech = Array.from({ length: 12 }, (_, i) => `This is sentence number ${i} of a very long speech.`).join(" ");
    const lines: ScriptLine[] = [...filler, { element: "character", text: "ANNA" }, { element: "dialogue", text: speech }];
    const pages = asPdf(lines);
    expect(pages.length).toBe(2);
    expect(pages[1].words.some((w) => w.str === "ANNA (CONT'D)")).toBe(true);
    expect(pdfToScript(pages).lines).toEqual(lines);
  });

  it("reads a title page off the first page", () => {
    const pages: PdfPage[] = [
      {
        width: PAGE_W,
        height: PAGE_H,
        words: [
          { str: "THE LIGHTHOUSE", x: 256, y: 480, w: 100, size: 12 },
          { str: "written by", x: 270, y: 440, w: 72, size: 12 },
          { str: "Arjun Gupte", x: 266, y: 420, w: 80, size: 12 },
          { str: "contact@example.com", x: 108, y: 100, w: 140, size: 12 },
        ],
      },
      ...asPdf(script),
    ];
    const r = pdfToScript(pages);
    expect(r.titlePage).toEqual({
      title: "THE LIGHTHOUSE",
      credit: "written by",
      author: "Arjun Gupte",
      contact: "contact@example.com",
    });
    expect(r.lines).toEqual(script);
  });
});

describe("a prose PDF", () => {
  const row = (str: string, y: number, size = 12) => ({ str, x: 72, y, w: str.length * 6, size });
  const pages: PdfPage[] = [
    {
      width: PAGE_W,
      height: PAGE_H,
      words: [
        row("A Treatment", 700, 22),
        row("The first paragraph runs across", 660),
        row("two lines of the page.", 646),
        row("The second one stands apart.", 610),
        row("Beats", 575, 16),
        row("• One beat", 550),
        row("• Another beat", 535),
        row("3", 40),
      ],
    },
  ];

  it("is not taken for a screenplay", () => {
    expect(looksLikeScreenplay(pages)).toBe(false);
  });

  it("becomes headings and paragraphs", () => {
    const doc = pdfToPlainDoc(pages);
    expect(doc.content!.map((n) => [n.type, n.attrs?.level, n.content?.[0].text])).toEqual([
      ["heading", 1, "A Treatment"],
      ["paragraph", undefined, "The first paragraph runs across two lines of the page."],
      ["paragraph", undefined, "The second one stands apart."],
      ["heading", 2, "Beats"],
      ["paragraph", undefined, "• One beat"],
      ["paragraph", undefined, "• Another beat"],
    ]);
  });
});
