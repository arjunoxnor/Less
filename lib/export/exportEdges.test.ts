// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { docOf, line } from "@/lib/editor/testKit";
import type { ScriptLine } from "@/types/screenplay";
import { docToLines, linesToDoc } from "./flatten";
import { parseFdx, toFdx } from "./fdx";
import { parseFountain, toFountain } from "./fountain";
import { BOTTOM_LIMIT, LAYOUT } from "./layout";
import { paginate } from "./paginate";
import { hasTitlePage, trimTitlePage, type TitlePage } from "./titlePage";

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
