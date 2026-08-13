// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { strToU8, zipSync } from "fflate";
import type { JSONContent } from "@tiptap/core";
import type { ScriptLine } from "@/types/screenplay";
import { docToLines, linesToDoc } from "./flatten";
import { docxToLines, odtToLines, rtfToLines } from "./docImport";
import { parseFdx, toFdx } from "./fdx";
import { parseFountain, toFountain } from "./fountain";
import { importFile } from "./index";
import {
  BOTTOM_LIMIT,
  LEFT,
  PAGE_W,
  RIGHT_EDGE,
  columnLength,
  wrap,
} from "./layout";
import { paginate } from "./paginate";
import { exportPdf, titlePageLineData } from "./pdf";
import type { TitlePage } from "./titlePage";

const fixture = (name: string): Buffer =>
  readFileSync(resolve(process.cwd(), "lib/export/fixtures", name));
const arrayBuffer = (bytes: Uint8Array): ArrayBuffer => Uint8Array.from(bytes).buffer;
const fixtureText = (name: string): string =>
  new TextDecoder("utf-8", { fatal: true }).decode(fixture(name));

const sixUnicodeLines: ScriptLine[] = [
  { element: "scene_heading", text: "INT. CAFÉ 東京 - DAY" },
  { element: "action", text: "Le café attend — שקט." },
  { element: "character", text: "ÉLODIE" },
  { element: "parenthetical", text: "(très calme)" },
  { element: "dialogue", text: "مرحبا 你好 👩‍🚀 e\u0301." },
  { element: "transition", text: "CUT TO:" },
];

describe("real adversarial format fixtures", () => {
  it("reads a BOM and mixed CRLF/lone-CR Fountain file without changing Unicode", () => {
    const parsed = parseFountain(fixtureText("unicode-hostile.fountain"));
    expect(parsed.titlePage).toEqual({
      title: "Café 東京",
      author: "Élodie O’Connor",
    });
    expect(parsed.lines).toEqual([
      { element: "scene_heading", text: "INT. CAFÉ 東京 - DAY #12#" },
      { element: "action", text: "Le café attend — שקט." },
      { element: "character", text: "ÉLODIE" },
      { element: "parenthetical", text: "(très calme)" },
      { element: "dialogue", text: "مرحبا 你好 👩‍🚀 e\u0301." },
      { element: "character", text: "MÅRTEN", dual: true },
      { element: "dialogue", text: "Ja, déjà.", dual: true },
      { element: "action", text: "CENTERED BEAT" },
    ]);
    expect(parseFountain("\uFEFFINT. ROOM - DAY\r\rAction.\r").lines[0]).toEqual({
      element: "scene_heading",
      text: "INT. ROOM - DAY",
    });
  });

  it("walks a 256-level FDX wrapper iteratively and preserves a dual pair", () => {
    const parsed = parseFdx(fixtureText("unicode-hostile.fdx")).lines;
    expect(parsed).toEqual([
      { element: "scene_heading", text: "INT. CAFÉ 東京 - DAY" },
      { element: "action", text: "Le café attend — שקט." },
      { element: "character", text: "ÉLODIE" },
      { element: "dialogue", text: "مرحبا 你好 👩‍🚀 é." },
      { element: "character", text: "MÅRTEN", dual: true },
      { element: "dialogue", text: "Ja, déjà.", dual: true },
    ]);
    // The source Paragraph carries Number="A12". Final Draft scene numbers are
    // not part of the six-element schema, so they are dropped on import rather
    // than smuggled into the heading text: text is what the editor, the scene
    // navigator, find/replace and the Fountain exporter all read, and a
    // synthetic " #A12#" would show up in every one of them while the PDF,
    // which numbers scenes itself, never shows it.
    expect(parsed[0].text).not.toContain("#");
    expect(toFdx(parsed)).not.toContain("#A12#");
  });

  it("reads a real DOCX with no styles.xml by using readable style ids", async () => {
    await expect(docxToLines(arrayBuffer(fixture("no-styles.docx")))).resolves.toEqual(
      sixUnicodeLines
    );
  });

  it("reads a real ODT with automatic styles and full Unicode", async () => {
    await expect(odtToLines(arrayBuffer(fixture("unicode.odt")))).resolves.toEqual(
      sixUnicodeLines
    );
  });

  it("reads a real ANSI RTF whose non-ASCII text uses Unicode escapes", () => {
    expect(rtfToLines(fixtureText("unicode.rtf"))).toEqual(sixUnicodeLines);
  });

  it("rejects malformed XML, mismatched XML, invalid ZIP XML, and unbalanced RTF", async () => {
    expect(() => parseFdx(fixtureText("malformed.fdx"))).toThrow(/valid Final Draft XML/);
    expect(() => parseFdx(fixtureText("mismatched.fdx"))).toThrow(/valid Final Draft XML/);
    expect(() => parseFdx("<NotFinalDraft><Content /></NotFinalDraft>")).toThrow(
      /not a Final Draft document/
    );
    await expect(docxToLines(arrayBuffer(fixture("invalid-utf8.docx")))).rejects.toThrow(
      /invalid UTF-8/
    );
    expect(() => rtfToLines(fixtureText("unbalanced.rtf"))).toThrow(/unbalanced braces/);
  });

  it("imports a not-quite-UTF-8 text file, and still refuses NUL bytes", async () => {
    // Word on Windows ("Save As > Plain Text") writes CP1252, where a curly
    // apostrophe is the lone byte 0x92 and is not valid UTF-8 on its own.
    // Screenwriters import exactly these files, so the decode is lenient: the
    // bad byte becomes U+FFFD and the script still opens. Only genuinely binary
    // content (NUL bytes in a text format) is refused.
    const ascii = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));
    const cp1252 = Uint8Array.from([
      ...ascii("INT. HOUSE - DAY\n\nShe won"),
      0x92,
      ...ascii("t stop."),
    ]);
    const word = await importFile(new File([arrayBuffer(cp1252)], "word.txt"));
    const flat = JSON.stringify(word.doc);
    expect(flat).toContain("INT. HOUSE - DAY");
    expect(flat).toContain("won\uFFFDt stop.");

    const invalid = new File([arrayBuffer(fixture("invalid-utf8.fountain"))], "bad.fountain");
    await expect(importFile(invalid)).resolves.toBeTruthy();

    const nul = new File([arrayBuffer(fixture("nul.fountain"))], "nul.fountain");
    await expect(importFile(nul)).rejects.toThrow(/NUL bytes/);
  });
});

describe("lossless exporter-authored text", () => {
  const hostile: ScriptLine[] = [
    { element: "scene_heading", text: ".ÉTAGE 👩‍🚀" },
    { element: "action", text: "Title: [[literal]] and /*literal*/ _ *" },
    { element: "action", text: "#1 priority" },
    { element: "action", text: "= literal synopsis marker" },
    { element: "character", text: "@ÉLODIE ^" },
    { element: "character", text: "BACKSLASH \\^" },
    { element: "dialogue", text: "A literal \\[[note]] and \\/* boneyard." },
    { element: "dialogue", text: ".45 starts this line" },
    { element: "dialogue", text: "#hashtag [[literal note]]" },
    { element: "dialogue", text: "(this is spoken text)" },
    { element: "dialogue", text: "~" },
    { element: "transition", text: "END<" },
    { element: "character", text: "LEFT" },
    { element: "dialogue", text: "Left speech." },
    { element: "character", text: "RIGHT", dual: true },
    { element: "dialogue", text: "(spoken on the right)", dual: true },
    { element: "dialogue", text: "", dual: true },
  ];

  it("round-trips leading syntax, literal comments, carets, angle brackets, and dual empties", () => {
    expect(parseFountain(toFountain(hostile)).lines).toEqual(hostile);
  });

  it("round-trips FDX leading/trailing spaces instead of trimming them", () => {
    const lines: ScriptLine[] = [
      { element: "action", text: "  spaces stay  " },
      { element: "dialogue", text: "\tindented\t" },
      { element: "action", text: "astral 𐐀 and e\u0301" },
    ];
    expect(parseFdx(toFdx(lines)).lines).toEqual(lines);
  });

  it("round-trips hostile title text instead of consuming it as notes or emphasis", () => {
    const title: TitlePage = {
      title: "[[SECRETS]] /* UNTOLD */",
      author: "A_B * C",
      contact: "東京\nשקט",
    };
    expect(parseFountain(toFountain([{ element: "action", text: "Body." }], title))).toEqual({
      lines: [{ element: "action", text: "Body." }],
      titlePage: title,
    });
    expect(parseFdx(toFdx([{ element: "action", text: "Body." }], title)).titlePage).toEqual(
      title
    );
  });

  it("strips XML 1.0 control characters and lone surrogates from an .fdx export", () => {
    // Stripping, not throwing. The only caller is a fire-and-forget export
    // action, so a throw here means "Export > Final Draft" produces no file, no
    // error and no toast, while PDF and Fountain of the same document work.
    const xml = toFdx([
      { element: "action", text: "before\0after" },
      { element: "dialogue", text: "lone \ud800 surrogate" },
      { element: "action", text: "kept: tab\tastral 𐐀 é" },
    ]);
    expect(xml).toContain("<Text>beforeafter</Text>");
    expect(xml).toContain("<Text>lone  surrogate</Text>");
    expect(xml).toContain("<Text>kept: tab\tastral 𐐀 é</Text>");
    // The point of stripping: our own importer must accept what we just wrote.
    expect(parseFdx(xml).lines[0]).toEqual({ element: "action", text: "beforeafter" });
    expect(() => parseFountain("!before\0after\n")).toThrow(/NUL bytes/);
  });

  it("preserves element order and Unicode through document bridges and both text formats", () => {
    const normalized = docToLines(linesToDoc(sixUnicodeLines));
    expect(docToLines(linesToDoc(parseFountain(toFountain(normalized)).lines))).toEqual(
      normalized
    );
    expect(docToLines(linesToDoc(parseFdx(toFdx(normalized)).lines))).toEqual(normalized);
  });
});

describe("hostile size and screenplay semantics", () => {
  it("parses a 10 MiB Fountain action without truncating it", () => {
    const value = "界".repeat(Math.ceil((10 * 1024 * 1024) / 3));
    const parsed = parseFountain(`!${value}\n`);
    expect(parsed.lines).toEqual([{ element: "action", text: value }]);
  }, 30_000);

  it("parses all 50,000 Fountain elements in order", () => {
    const text = Array.from({ length: 50_000 }, (_, i) => `!line ${i}`).join("\n\n");
    const lines = parseFountain(text).lines;
    expect(lines).toHaveLength(50_000);
    expect(lines[0].text).toBe("line 0");
    expect(lines[49_999].text).toBe("line 49999");
  }, 30_000);

  it("recognizes forced elements, dual dialogue, scene numbers, MORE, and CONT'D", () => {
    const parsed = parseFountain([
      ".A PLACE OUTSIDE TIME #A12#",
      "",
      "@ÉLODIE",
      "One.",
      "(MORE)",
      "",
      "@ÉLODIE (CONT'D)",
      "Two.",
      "",
      "@MÅRTEN ^",
      "Three.",
      "",
      ">SMASH CUT<",
      "",
    ].join("\n")).lines;
    expect(parsed).toEqual([
      { element: "scene_heading", text: "A PLACE OUTSIDE TIME #A12#" },
      { element: "character", text: "ÉLODIE" },
      { element: "dialogue", text: "One." },
      { element: "parenthetical", text: "(MORE)" },
      { element: "character", text: "ÉLODIE (CONT'D)" },
      { element: "dialogue", text: "Two." },
      { element: "character", text: "MÅRTEN", dual: true },
      { element: "dialogue", text: "Three.", dual: true },
      { element: "action", text: "SMASH CUT" },
    ]);
  });

  it("deliberately omits non-body Fountain notes, boneyards, sections, synopses, and page breaks", () => {
    const parsed = parseFountain([
      "[[note]]",
      "/* old scene */",
      "# Section",
      "= Synopsis",
      "===",
      "!Visible body",
    ].join("\n\n"));
    // The six-element screenplay schema has no portable nodes for these
    // non-body constructs. Their loss is explicit rather than an accident.
    expect(parsed.lines).toEqual([{ element: "action", text: "Visible body" }]);
  });
});

describe("PDF line-data boundaries", () => {
  it("splits a long Unicode speech with MORE and a repeated CONT'D cue", () => {
    const result = paginate(
      [
        { element: "character", text: "ÉLODIE" },
        { element: "dialogue", text: "e\u0301 👩‍🚀 你好 ".repeat(400) },
      ],
      { keepUnicode: true }
    );
    const texts = result.pages.flatMap((page) => page.ops.map((op) => op.text));
    expect(result.pageCount).toBeGreaterThan(1);
    expect(texts.filter((text) => text === "(MORE)").length).toBeGreaterThan(0);
    expect(texts.filter((text) => text === "ÉLODIE (CONT'D)").length).toBeGreaterThan(0);
    expect(
      Array.from(texts.join("")).every((char) => {
        const code = char.charCodeAt(0);
        return char.length === 2 || code < 0xd800 || code > 0xdfff;
      })
    ).toBe(true);
  });

  it("puts a transition on the final printable baseline", () => {
    const result = paginate([
      { element: "scene_heading", text: "INT. ROOM - DAY" },
      { element: "action", text: "x".repeat(60 * 50) },
      { element: "transition", text: "CUT TO:" },
    ]);
    const transition = result.pages[0].ops.find((op) => op.text === "CUT TO:");
    expect(transition?.y).toBe(BOTTOM_LIMIT);
  });

  it("numbers scenes in both margins without editing the heading a writer typed", () => {
    const page = paginate(
      [
        { element: "scene_heading", text: "INT. ROOM - DAY #A12#" },
        { element: "action", text: "She waits." },
        { element: "scene_heading", text: "EXT. STREET - NIGHT" },
      ],
      { sceneNumbers: true }
    ).pages[0];
    // Margin numbers are the renderer's own ordinal, printed left and right.
    expect(page.ops.filter((op) => op.text === "1")).toHaveLength(2);
    expect(page.ops.filter((op) => op.text === "2")).toHaveLength(2);
    // A "#...#" a writer typed is body text and is printed verbatim: the PDF
    // must not quietly delete characters that are still visible on screen.
    expect(page.ops.some((op) => op.text === "INT. ROOM - DAY #A12#")).toBe(true);
  });

  it("keeps every grapheme-safe wrapped row at or below its exact column limit", () => {
    const source = `${"👩‍🚀".repeat(59)}e\u0301 ${"界".repeat(60)}`;
    const rows = wrap(source, 60);
    expect(rows.every((row) => columnLength(row) <= 60)).toBe(true);
    expect(rows.join(" ").normalize()).toBe(source.normalize());
  });

  it("lays out empty and very long title fields inside the printable width", () => {
    expect(titlePageLineData({ title: " ", contact: "" })).toEqual([]);
    const ops = titlePageLineData({
      title: "界".repeat(400),
      author: "Élodie ".repeat(50),
      contact: "contact ".repeat(50),
      draftDate: "August fifth ".repeat(40),
    });
    expect(ops.length).toBeGreaterThan(20);
    for (const op of ops) {
      expect(columnLength(op.text)).toBeLessThanOrEqual(58);
      expect(op.x).toBeGreaterThanOrEqual(PAGE_W - RIGHT_EDGE);
      expect(op.x + columnLength(op.text) * ((RIGHT_EDGE - LEFT) / 60)).toBeLessThanOrEqual(
        RIGHT_EDGE + 0.001
      );
      expect(op.y).toBeGreaterThan(0);
    }
  });

  it("produces a readable PDF with an empty title page omitted and a long one included", async () => {
    const regular = readFileSync(resolve(process.cwd(), "public/fonts/CourierPrime-Regular.ttf"));
    const bold = readFileSync(resolve(process.cwd(), "public/fonts/CourierPrime-Bold.ttf"));
    vi.stubGlobal("fetch", async (path: string) => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => arrayBuffer(path.includes("Bold") ? bold : regular),
    }));
    try {
      const empty = await PDFDocument.load(
        await exportPdf([{ element: "action", text: "Body." }], { title: " " })
      );
      const long = await PDFDocument.load(
        await exportPdf([{ element: "action", text: "Body." }], {
          title: "A very long title ".repeat(30),
          author: "Élodie 東京",
        })
      );
      expect(empty.getPageCount()).toBe(1);
      expect(long.getPageCount()).toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
  }, 30_000);
});

function xmlEscape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function officeDocx(lines: ScriptLine[]): ArrayBuffer {
  const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const names: Record<ScriptLine["element"], string> = {
    scene_heading: "SceneHeading",
    action: "Action",
    character: "Character",
    parenthetical: "Parenthetical",
    dialogue: "Dialogue",
    transition: "Transition",
  };
  const body = lines.map((line) =>
    `<w:p><w:pPr><w:pStyle w:val="${names[line.element]}"/></w:pPr><w:r><w:t>${xmlEscape(line.text)}</w:t></w:r></w:p>`
  ).join("");
  return arrayBuffer(zipSync({
    "word/document.xml": strToU8(`<w:document xmlns:w="${ns}"><w:body>${body}</w:body></w:document>`),
  }));
}

function officeOdt(lines: ScriptLine[]): ArrayBuffer {
  const office = "urn:oasis:names:tc:opendocument:xmlns:office:1.0";
  const text = "urn:oasis:names:tc:opendocument:xmlns:text:1.0";
  const style = "urn:oasis:names:tc:opendocument:xmlns:style:1.0";
  const names: Record<ScriptLine["element"], string> = {
    scene_heading: "Scene Heading",
    action: "Action",
    character: "Character",
    parenthetical: "Parenthetical",
    dialogue: "Dialogue",
    transition: "Transition",
  };
  const styles = Object.entries(names).map(([key, name]) =>
    `<style:style style:name="${key}" style:parent-style-name="${name}"/>`
  ).join("");
  const body = lines.map((line) =>
    `<text:p text:style-name="${line.element}">${xmlEscape(line.text)}</text:p>`
  ).join("");
  return arrayBuffer(zipSync({
    "content.xml": strToU8(`<office:document-content xmlns:office="${office}" xmlns:text="${text}" xmlns:style="${style}"><office:automatic-styles>${styles}</office:automatic-styles><office:body><office:text>${body}</office:text></office:body></office:document-content>`),
  }));
}

function rtfEscape(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const ch = text[i];
    if (code >= 0x20 && code <= 0x7e && !"\\{}".includes(ch)) out += ch;
    else if ("\\{}".includes(ch)) out += `\\${ch}`;
    else out += `\\u${code > 32767 ? code - 65536 : code}?`;
  }
  return out;
}

function officeRtf(lines: ScriptLine[]): string {
  const align: Record<ScriptLine["element"], string> = {
    scene_heading: "ql",
    action: "ql",
    character: "qc",
    parenthetical: "ql",
    dialogue: "ql",
    transition: "qr",
  };
  return `{\\rtf1\\ansi\\uc1${lines.map((line) =>
    `\\pard\\${align[line.element]} ${rtfEscape(line.text)}\\par`
  ).join("")}}`;
}

describe("deterministic schema fuzzing", () => {
  let state = 0x6d2b79f5;
  const random = () => {
    state = (Math.imul(state ^ (state >>> 15), 1 | state) + 0x6d2b79f5) | 0;
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
  const tokens = [
    "Café", "東京", "שקט", "مرحبا", "👩‍🚀", "e\u0301", ".45", "@home",
    "#1", "=beat", ">there", "~hum", "[[literal]]", "/*literal*/", "A_B*C",
    "Title: body", "END<", "caret^", "\\^", "\\[[literal]]", "(spoken)", "𐐀",
  ];
  const types: ScriptLine["element"][] = [
    "scene_heading", "action", "character", "parenthetical", "dialogue", "transition",
  ];

  it("round-trips 2,000 random documents through Fountain and FDX and paginates each", () => {
    for (let docIndex = 0; docIndex < 2_000; docIndex++) {
      const raw: ScriptLine[] = [];
      const count = 1 + Math.floor(random() * 8);
      for (let i = 0; i < count; i++) {
        const element = types[Math.floor(random() * types.length)];
        const pieces = 1 + Math.floor(random() * 3);
        const text = Array.from({ length: pieces }, () =>
          tokens[Math.floor(random() * tokens.length)]
        ).join(" ");
        raw.push({ element, text });
      }
      const expected = docToLines(linesToDoc(raw));
      expect(parseFountain(toFountain(expected)).lines).toEqual(expected);
      expect(parseFdx(toFdx(expected)).lines).toEqual(expected);
      expect(() => paginate(expected, { keepUnicode: true })).not.toThrow();
    }
  }, 30_000);

  it("round-trips 1,000 styled Unicode documents through real DOCX, ODT, and RTF payloads", async () => {
    for (let i = 0; i < 1_000; i++) {
      const token = tokens[Math.floor(random() * 6)];
      const lines: ScriptLine[] = [
        { element: "scene_heading", text: `INT. ROOM ${i} ${token} - DAY` },
        { element: "action", text: `Action ${token}.` },
        { element: "character", text: `ÉLODIE ${i}` },
        { element: "parenthetical", text: `(soft ${token})` },
        { element: "dialogue", text: `Dialogue ${token}.` },
        { element: "transition", text: "CUT TO:" },
      ];
      await expect(docxToLines(officeDocx(lines))).resolves.toEqual(lines);
      await expect(odtToLines(officeOdt(lines))).resolves.toEqual(lines);
      expect(rtfToLines(officeRtf(lines))).toEqual(lines);
    }
  }, 60_000);

  it("collapses office-document whitespace to one line and keeps combining marks", async () => {
    // Word/RTF/ODT scripts are hand-formatted with tabs and runs of spaces to
    // fake screenplay margins. Those must NOT survive into the line text: the
    // editor renders .sp-line as white-space: pre-wrap (so a tab would be
    // visible) while the PDF wrapper splits on /\s+/ and drops it, and the two
    // would disagree. One paragraph becomes one clean line; the characters that
    // carry meaning (here a combining acute) are untouched.
    const source: ScriptLine[] = [
      { element: "action", text: "  two  spaces\tNBSP:\u00a0e\u0301  " },
    ];
    const collapsed: ScriptLine[] = [
      { element: "action", text: "two spaces NBSP: e\u0301" },
    ];
    await expect(docxToLines(officeDocx(source))).resolves.toEqual(collapsed);
    await expect(odtToLines(officeOdt(source))).resolves.toEqual(collapsed);
    expect(rtfToLines(officeRtf(source))).toEqual(collapsed);
  });
});
