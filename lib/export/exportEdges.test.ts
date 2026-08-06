// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { docOf, line } from "@/lib/editor/testKit";
import type { ScriptLine } from "@/types/screenplay";
import { docToLines, linesToDoc } from "./flatten";
import { parseFdx, toFdx } from "./fdx";
import { parseFountain, toFountain } from "./fountain";
import { BOTTOM_LIMIT, LAYOUT } from "./layout";
import { paginate } from "./paginate";
import { capturePageLock, labelLockedPages } from "./pageLock";
import { hasTitlePage, trimTitlePage, type TitlePage } from "./titlePage";
import { docxToLines, odtToLines, rtfToLines } from "./docImport";

const dialogueRows = (count: number) => "x".repeat(35 * count);
const actionRows = (count: number) => "y".repeat(60 * count);

describe("export edge cases", () => {
  it("keeps empty and one-blank-line documents valid", () => {
    expect(docToLines({ type: "doc" })).toEqual([]);
    expect(linesToDoc([]).content).toHaveLength(1);
    expect(paginate([])).toMatchObject({ pageCount: 1 });
    expect(paginate([{ element: "action", text: "" }])).toMatchObject({
      pageCount: 1,
    });
  });

  it("lays a dual-dialogue pair side by side on the same baseline", () => {
    const lines: ScriptLine[] = [
      { element: "character", text: "ANNA" },
      { element: "dialogue", text: "Left." },
      { element: "character", text: "BEN", dual: true },
      { element: "dialogue", text: "Right.", dual: true },
    ];
    const page = paginate(lines).pages[0];
    const anna = page.ops.find((op) => op.text === "ANNA")!;
    const ben = page.ops.find((op) => op.text === "BEN")!;
    expect(anna.y).toBe(ben.y);
    expect(anna.x).toBeLessThan(ben.x);
  });

  it("prints revision marks for revised lines inside dual dialogue", () => {
    const lines: ScriptLine[] = [
      { element: "character", text: "ANNA", revised: true },
      { element: "dialogue", text: "Left.", revised: true },
      { element: "character", text: "BEN", dual: true },
      { element: "dialogue", text: "Right.", dual: true, revised: true },
    ];
    const page = paginate(lines).pages[0];
    const anna = page.ops.find((op) => op.text === "ANNA")!;
    const left = page.ops.find((op) => op.text === "Left.")!;
    const marks = page.ops.filter((op) => op.text === "*");
    expect(marks.map((mark) => mark.y)).toEqual(expect.arrayContaining([anna.y, left.y]));
  });

  it("splits a long speech with MORE and the accented cue name", () => {
    const result = paginate([
      { element: "character", text: "ÉLODIE O’CONNOR" },
      { element: "dialogue", text: dialogueRows(70) },
    ]);
    const texts = result.pages.flatMap((page) => page.ops.map((op) => op.text));
    expect(result.pageCount).toBeGreaterThan(1);
    expect(texts).toContain("(MORE)");
    expect(texts).toContain("ÉLODIE O’CONNOR (CONT'D)");
  });

  it("allows a transition to occupy the final printable row", () => {
    const result = paginate([
      { element: "scene_heading", text: "INT. ROOM - DAY" },
      { element: "action", text: actionRows(50) },
      { element: "transition", text: "CUT TO:" },
    ]);
    const transition = result.pages[0].ops.find((op) => op.text === "CUT TO:");
    expect(result.pageCount).toBe(1);
    expect(transition?.y).toBe(BOTTOM_LIMIT);
    expect(transition?.x).toBeGreaterThan(LAYOUT.transition.x);
  });

  it("omits a title page whose fields are all empty", () => {
    const empty: TitlePage = { title: " ", author: "", contact: "\n" };
    expect(hasTitlePage(empty)).toBe(false);
    expect(trimTitlePage(empty)).toBeNull();
    expect(toFdx([], empty)).not.toContain("<TitlePage>");
    expect(toFountain([], empty)).toBe("\n");
  });

  it("round-trips every populated FDX title field without visible labels", () => {
    const titlePage: TitlePage = {
      title: "THE ROOM",
      credit: "Written by",
      author: "Élodie O’Connor",
      source: "Based on a true story",
      draftDate: "July 29, 2026",
      contact: "Agent Name\nagent@example.com",
      copyright: "Copyright 2026",
    };
    const xml = toFdx([{ element: "action", text: "A beat." }], titlePage);
    expect(xml).not.toContain("Author:");
    expect(parseFdx(xml).titlePage).toEqual(titlePage);
  });

  it("preserves accented and apostrophized character names in text exports", () => {
    const lines: ScriptLine[] = [
      { element: "character", text: "ÉLODIE O’CONNOR" },
      { element: "dialogue", text: "C’est déjà fait." },
    ];
    expect(parseFdx(toFdx(lines)).lines).toEqual(lines);
    expect(parseFountain(toFountain(lines)).lines).toEqual(lines);
    expect(docToLines(docOf(...lines.map((item) => line(item.element, item.text))))).toEqual(
      lines
    );
  });

  it("auto-detects a cue made only of non-ASCII cased letters", () => {
    const lines: ScriptLine[] = [
      { element: "character", text: "É" },
      { element: "dialogue", text: "Oui." },
    ];
    expect(parseFountain(toFountain(lines)).lines).toEqual(lines);
  });

  it("adds missing parenthetical brackets to PDF line data and Fountain output", () => {
    const stored = docOf(
      line("character", "ANNA"),
      line("parenthetical", "quietly"),
      line("dialogue", "Stay here.")
    );
    const lines = docToLines(stored);
    expect(lines[1]).toEqual({ element: "parenthetical", text: "(quietly)" });

    const printed = paginate(lines).pages
      .flatMap((page) => page.ops.map((op) => op.text))
      .join("\n");
    expect(printed).toContain("(quietly)");
    expect(toFountain(lines)).toContain("ANNA\n(quietly)\nStay here.");
  });

  it("preserves the revised flag through the flat document bridge", () => {
    const stored = linesToDoc([
      { element: "action", text: "Changed.", revised: true },
    ]);
    expect(docToLines(stored)).toEqual([
      { element: "action", text: "Changed.", revised: true },
    ]);
  });

  it("round-trips orphan dialogue and meaningful empty lines through Fountain", () => {
    const lines: ScriptLine[] = [
      { element: "dialogue", text: "Orphaned speech." },
      { element: "action", text: "" },
      { element: "character", text: "ANNA" },
      { element: "dialogue", text: "" },
    ];
    expect(parseFountain(toFountain(lines)).lines).toEqual(lines);
  });

  it("does not consume a Fountain body after a whitespace-only title separator", () => {
    const parsed = parseFountain(
      "Title: THE ROOM\nAuthor: A. Writer\n   \nINT. ROOM - DAY\n\nA chair waits.\n"
    );
    expect(parsed.titlePage).toEqual({ title: "THE ROOM", author: "A. Writer" });
    expect(parsed.lines.map((item) => item.text)).toEqual([
      "INT. ROOM - DAY",
      "A chair waits.",
    ]);
  });

  it("round-trips a forced scene heading that starts with a non-ASCII letter", () => {
    const lines: ScriptLine[] = [
      { element: "scene_heading", text: "ÉTAGE SUPÉRIEUR" },
      { element: "action", text: "Silence." },
    ];
    expect(parseFountain(toFountain(lines)).lines).toEqual(lines);
  });

  it("round-trips exporter-authored empty FDX paragraphs", () => {
    const lines: ScriptLine[] = [
      { element: "scene_heading", text: "INT. ROOM - DAY" },
      { element: "action", text: "" },
      { element: "character", text: "ANNA" },
      { element: "dialogue", text: "" },
    ];
    expect(parseFdx(toFdx(lines)).lines).toEqual(lines);
  });

  it("re-synchronizes page locks after more than four locked pages are cut", () => {
    const lockedLines: ScriptLine[] = Array.from({ length: 7 }, (_, index) => ({
      element: "action",
      text: `LOCKED ${index + 1}`,
    }));
    const lockedPages = lockedLines.map((_, index) => ({
      number: index + 1,
      startLine: index,
      ops: [],
    }));
    const lock = capturePageLock(lockedPages, lockedLines, {
      lockedAt: "2026-08-02T00:00:00.000Z",
    });
    const currentLines = [lockedLines[0], lockedLines[6]];
    const currentPages = [
      { number: 1, startLine: 0, ops: [] },
      { number: 2, startLine: 1, ops: [] },
    ];
    expect(labelLockedPages(currentPages, currentLines, lock).get(2)).toBe("7");
  });

  it("disambiguates locked pages whose opening lines repeat", () => {
    const lockedLines: ScriptLine[] = [
      { element: "action", text: "SAME" },
      { element: "action", text: "FIRST PAGE" },
      { element: "action", text: "SAME" },
      { element: "action", text: "SECOND PAGE" },
    ];
    const lock = capturePageLock(
      [
        { number: 1, startLine: 0, ops: [] },
        { number: 2, startLine: 2, ops: [] },
      ],
      lockedLines,
      { lockedAt: "2026-08-02T00:00:00.000Z" }
    );
    const currentLines = lockedLines.slice(2);
    const labels = labelLockedPages(
      [{ number: 1, startLine: 0, ops: [] }],
      currentLines,
      lock
    );
    expect(labels.get(1)).toBe("2");
  });

  it("labels a newly inserted mid-script page as an A-page", () => {
    const lockedLines: ScriptLine[] = [
      { element: "scene_heading", text: "INT. FIRST - DAY" },
      { element: "scene_heading", text: "INT. SECOND - DAY" },
    ];
    const lock = capturePageLock(
      [
        { number: 1, startLine: 0, ops: [] },
        { number: 2, startLine: 1, ops: [] },
      ],
      lockedLines,
      { lockedAt: "2026-08-02T00:00:00.000Z" }
    );
    const currentLines = [
      lockedLines[0],
      { element: "scene_heading", text: "INT. INSERTED - DAY" } as ScriptLine,
      lockedLines[1],
    ];
    const labels = labelLockedPages(
      [
        { number: 1, startLine: 0, ops: [] },
        { number: 2, startLine: 1, ops: [] },
        { number: 3, startLine: 2, ops: [] },
      ],
      currentLines,
      lock
    );
    expect([...labels.values()]).toEqual(["1", "1A", "2"]);
  });

  it("resolves Word paragraph style ids through styles.xml", async () => {
    const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const bytes = zipSync({
      "word/document.xml": strToU8(
        `<w:document xmlns:w="${ns}"><w:body><w:p><w:pPr><w:pStyle w:val="P42"/></w:pPr><w:r><w:t>A place beyond time.</w:t></w:r></w:p></w:body></w:document>`
      ),
      "word/styles.xml": strToU8(
        `<w:styles xmlns:w="${ns}"><w:style w:type="paragraph" w:styleId="P42"><w:name w:val="Scene Heading"/></w:style></w:styles>`
      ),
    });
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    await expect(docxToLines(buf)).resolves.toEqual([
      { element: "scene_heading", text: "A place beyond time." },
    ]);
  });

  it("resolves OpenDocument automatic styles through their parent style", async () => {
    const textNs = "urn:oasis:names:tc:opendocument:xmlns:text:1.0";
    const styleNs = "urn:oasis:names:tc:opendocument:xmlns:style:1.0";
    const officeNs = "urn:oasis:names:tc:opendocument:xmlns:office:1.0";
    const bytes = zipSync({
      "content.xml": strToU8(
        `<office:document-content xmlns:office="${officeNs}" xmlns:text="${textNs}" xmlns:style="${styleNs}"><office:automatic-styles><style:style style:name="P1" style:parent-style-name="Scene Heading"/></office:automatic-styles><office:body><office:text><text:p text:style-name="P1">A place beyond time.</text:p></office:text></office:body></office:document-content>`
      ),
    });
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    await expect(odtToLines(buf)).resolves.toEqual([
      { element: "scene_heading", text: "A place beyond time." },
    ]);
  });

  it("uses RTF paragraph alignment when classifying cues", () => {
    const rtf = String.raw`{\rtf1\ansi\pard\qc MYSTERY PERSON\par\pard\ql ALL CAPS SPEECH\par}`;
    expect(rtfToLines(rtf)).toEqual([
      { element: "character", text: "MYSTERY PERSON" },
      { element: "dialogue", text: "ALL CAPS SPEECH" },
    ]);
  });
});

describe("format capitals are applied on the way out", () => {
  // AutoCaps no longer rewrites a line when only its element type changes, so
  // that one Tab cycle cannot permanently uppercase an action sentence. The
  // writer's case therefore survives in storage, and the exporters have to
  // supply the capitals themselves.
  const doc = docOf(
    line("scene_heading", "int. kitchen - day"),
    line("action", "She waits."),
    line("character", "alex"),
    line("parenthetical", "(quietly)"),
    line("dialogue", "Say it again."),
    line("transition", "cut to:")
  );

  it("uppercases sluglines, cues and transitions, and leaves prose alone", () => {
    expect(docToLines(doc)).toEqual<ScriptLine[]>([
      { element: "scene_heading", text: "INT. KITCHEN - DAY" },
      { element: "action", text: "She waits." },
      { element: "character", text: "ALEX" },
      { element: "parenthetical", text: "(quietly)" },
      { element: "dialogue", text: "Say it again." },
      { element: "transition", text: "CUT TO:" },
    ]);
  });

  it("carries those capitals into both exported formats", () => {
    const lines = docToLines(doc);
    const fountain = toFountain(lines);
    expect(fountain).toContain("INT. KITCHEN - DAY");
    expect(fountain).toContain("ALEX");
    expect(fountain).toContain("CUT TO:");
    expect(fountain).not.toContain("alex");

    // A page carries draw operations, which is what the PDF renderer paints.
    const { pages } = paginate(lines);
    const printed = pages
      .flatMap((page) => page.ops.map((op) => ("text" in op ? op.text : "")))
      .join("\n");
    expect(printed).toContain("ALEX");
    expect(printed).not.toContain("alex");
  });
});
