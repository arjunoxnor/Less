/**
 * @vitest-environment jsdom
 *
 * Pagination parity: the export engine (lib/export/paginate.ts, the rule
 * authority) against the screen engine's planner (planPages in
 * lib/editor/pagination.ts).
 *
 * TEST-SHAPE DECISION, recorded per the Phase 4 plan: jsdom performs no real
 * layout (every getClientRects box is empty and every measured height is 0),
 * so faithfully mocking the DOM measurement pass of the screen engine would
 * mean hand-writing per-block box geometry, i.e. testing the mock. Instead the
 * screen engine was split so that everything AFTER measurement is the pure
 * planner planPages(), which is exactly what compute() executes in the
 * browser: these tests feed it the same line-slot metrics the DOM yields at
 * 16px lines (54 slots per page == LINES_PER_PAGE) and assert its page count
 * and page-start blocks equal the export engine's, corpus-wide plus an
 * exhaustive sweep over dialogue/action block lengths. The DOM-only remainder
 * (Range.getClientRects line boxes, the caret-coordinate binary search, the
 * widget decorations) is covered by the recorded in-browser acceptance run
 * (superaudit/2026-07-20-f16-acceptance.md): a 60-line monologue paginates to
 * the same page count on screen and in the exported PDF.
 *
 * The synthetic text is made of sentences (every row of dialogue and action
 * ends one), because the engines only break a speech or a paragraph at the
 * end of a sentence; text with no sentence end never breaks, it moves whole.
 *
 * Known v1 divergence, deliberate: dual-dialogue clusters are exempt from
 * splitting and place sequentially on screen (the stacked layout), while the
 * export lays the pair side by side. The dual corpus therefore keeps its
 * clusters clear of page boundaries, where the two engines agree.
 */
import { describe, it, expect } from "vitest";
import { line, docOf } from "@/lib/editor/testKit";
import { docToLines } from "./flatten";
import { paginate } from "./paginate";
import { LAYOUT, LINES_PER_PAGE, sanitize, wrap } from "./layout";
import { cueBaseName } from "@/lib/editor/outline";
import { planPages, textSplitModel, type PlanBlock } from "@/lib/editor/pagination";
import type { ScriptLine } from "@/types/screenplay";
import type { JSONContent } from "@tiptap/core";

/** Exactly k rows of text in a `cols`-wide column, every row one sentence
    (so every line end is a place the engines may break). */
function sentences(k: number, cols: number): string {
  const rows: string[] = [];
  for (let r = 0; r < k; r++) {
    const word = "w".repeat(4 + (r % 5));
    let row = "";
    while (row.length + word.length + 2 <= cols) row += (row ? " " : "") + word;
    rows.push(row + ".");
  }
  return rows.join(" ");
}
/** Exactly k dialogue rows (35 chars) / k action rows (60 chars). */
const dlg = (k: number) => sentences(k, 35);
const act = (k: number) => sentences(k, 60);
/** k rows with no sentence end at all: the engines may only move it whole. */
const unbroken = (k: number) => "x".repeat(35 * k);

/** Reduce ScriptLines to the planner's metrics exactly as compute() does in
    the browser (rows from the export's own wrap, blanks from LAYOUT, the cue
    flag from the nearest preceding named character). */
function planBlocksFrom(lines: ScriptLine[]): PlanBlock[] {
  let currentCue: string | null = null;
  return lines.map((l) => {
    const el = LAYOUT[l.element] ?? LAYOUT.action;
    const text = sanitize(l.text);
    const rows = wrap(text, el.maxChars, el.hang ?? 0).length;
    if (l.element === "character") {
      currentCue = cueBaseName(l.text).toUpperCase() || null;
    } else if (
      l.element === "scene_heading" ||
      l.element === "action" ||
      l.element === "transition"
    ) {
      currentCue = null;
    }
    return {
      kind: l.element,
      rows,
      spaceBefore: el.spaceBefore,
      dual: l.dual === true,
      cue: l.element === "dialogue" && currentCue != null,
      model:
        l.element === "dialogue" || l.element === "action"
          ? textSplitModel(text, el.maxChars, el.hang ?? 0)
          : null,
    };
  });
}

function assertParity(lines: ScriptLine[]) {
  const exported = paginate(lines);
  const plan = planPages(planBlocksFrom(lines), LINES_PER_PAGE);
  expect(plan.pageCount).toBe(exported.pageCount);
  expect(plan.pageStartBlocks).toEqual(exported.pages.map((p) => p.startLine));
  return { exported, plan };
}

/* The six synthetic scripts, built as real documents via testKit and
   flattened through the production bridge (docToLines). */

const monologue: JSONContent[] = [
  line("scene_heading", "INT. LECTURE HALL - NIGHT"),
  line("action", act(2)),
  line("character", "PROFESSOR VANCE"),
  line("dialogue", dlg(60)),
  line("scene_heading", "INT. CORRIDOR - NIGHT"),
  line("action", act(1)),
  line("character", "PROFESSOR VANCE"),
  line("dialogue", dlg(10)),
];

const slugs: JSONContent[] = [];
for (let s = 0; s < 30; s++) {
  slugs.push(line("scene_heading", `INT. ROOM ${s + 1} - DAY`));
  slugs.push(line("action", act(2)));
}

const parens: JSONContent[] = [];
for (let s = 0; s < 14; s++) {
  parens.push(line("scene_heading", `INT. STAGE ${s + 1} - DAY`));
  parens.push(line("action", act(1)));
  parens.push(line("character", "MARA"));
  parens.push(line("parenthetical", "(quietly)"));
  parens.push(line("dialogue", dlg(3)));
  parens.push(line("parenthetical", "(beat)"));
  parens.push(line("dialogue", dlg(4)));
  parens.push(line("character", "JONES"));
  parens.push(line("parenthetical", "(overlapping)"));
  parens.push(line("dialogue", dlg(2)));
}

const dual: JSONContent[] = [];
for (let s = 0; s < 9; s++) {
  dual.push(line("scene_heading", `EXT. STREET ${s + 1} - DAY`));
  dual.push(line("action", act(3)));
  dual.push(line("character", "AVA"));
  dual.push(line("dialogue", dlg(4)));
}
dual.push(line("scene_heading", "INT. KITCHEN - NIGHT"));
dual.push(line("character", "AVA"));
dual.push(line("dialogue", dlg(3)));
dual.push(line("character", "BEN", { dual: true }));
dual.push(line("dialogue", dlg(3), { dual: true }));
dual.push(line("character", "AVA"));
dual.push(line("dialogue", dlg(2)));
dual.push(line("character", "BEN", { dual: true }));
dual.push(line("dialogue", dlg(2), { dual: true }));

const actions: JSONContent[] = [
  line("scene_heading", "EXT. BATTLEFIELD - DAWN"),
  line("action", act(20)),
  line("action", act(30)),
  line("action", act(8)),
  line("action", act(25)),
  line("action", act(12)),
  line("action", act(3)),
];

const mixed: JSONContent[] = [
  line("scene_heading", "INT. NEWSROOM - DAY"),
  line("action", act(4)),
  line("character", "EDITOR"),
  line("dialogue", dlg(12)),
  line("character", "REPORTER"),
  line("parenthetical", "(typing)"),
  line("dialogue", dlg(5)),
  line("transition", "CUT TO:"),
  line("scene_heading", "EXT. ROOFTOP - DUSK"),
  line("action", act(9)),
  line("character", "REPORTER"),
  line("dialogue", dlg(24)),
  line("action", act(6)),
  line("transition", "FADE OUT."),
  line("scene_heading", "INT. ARCHIVE - NIGHT"),
  line("action", act(14)),
  line("character", "ARCHIVIST"),
  line("dialogue", dlg(7)),
];

const corpus: {
  name: string;
  nodes: JSONContent[];
  pageCount: number;
  startLines: (number | undefined)[];
}[] = [
  { name: "monologue-heavy", nodes: monologue, pageCount: 2, startLines: [0, 3] },
  { name: "slug-heavy", nodes: slugs, pageCount: 3, startLines: [0, 22, 44] },
  {
    name: "parenthetical chains",
    nodes: parens,
    pageCount: 6,
    startLines: [0, 27, 55, 80, 107, 135],
  },
  { name: "dual clusters", nodes: dual, pageCount: 3, startLines: [0, 18, 36] },
  { name: "action-paragraph-heavy", nodes: actions, pageCount: 2, startLines: [0, 3] },
  { name: "mixed", nodes: mixed, pageCount: 2, startLines: [0, 11] },
];

describe("export engine snapshots (pinned)", () => {
  for (const c of corpus) {
    it(`${c.name}: page starts and count are stable`, () => {
      const r = paginate(docToLines(docOf(...c.nodes)));
      expect(r.pageCount).toBe(c.pageCount);
      expect(r.pages.map((p) => p.startLine)).toEqual(c.startLines);
    });
  }
});

describe("screen planner parity with the export engine", () => {
  for (const c of corpus) {
    it(`${c.name}: same page count and page-start blocks`, () => {
      assertParity(docToLines(docOf(...c.nodes)));
    });
  }

  it("60-line monologue splits with (MORE)/(CONT'D) and matches the export", () => {
    const lines = docToLines(docOf(...monologue));
    const { plan } = assertParity(lines);
    const splits = plan.breaks.filter((b) => b.index === 3 && b.row > 0);
    expect(splits.length).toBeGreaterThan(0);
    for (const s of splits) {
      expect(s.more).toBe(true);
      expect(s.contd).toBe(true);
    }
  });

  it("holds for every dialogue length 1..80 at three page offsets", () => {
    for (const filler of [0, 17, 35]) {
      for (let k = 1; k <= 80; k++) {
        const nodes: JSONContent[] = [line("scene_heading", "INT. ROOM - DAY")];
        if (filler > 0) nodes.push(line("action", act(filler)));
        nodes.push(line("character", "ALEX"));
        nodes.push(line("dialogue", dlg(k)));
        nodes.push(line("action", act(2)));
        const lines = docToLines(docOf(...nodes));
        const { plan } = assertParity(lines);
        // Split legality: >=2 rows on each side of every dialogue split.
        const dlgIndex = filler > 0 ? 3 : 2;
        for (const b of plan.breaks.filter((x) => x.index === dlgIndex && x.row > 0)) {
          expect(b.row).toBeGreaterThanOrEqual(2);
          expect(b.rowsAfter).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it("holds for every action-paragraph length 1..80 at three page offsets", () => {
    for (const filler of [0, 17, 35]) {
      for (let k = 1; k <= 80; k++) {
        const nodes: JSONContent[] = [line("scene_heading", "EXT. FIELD - DAY")];
        if (filler > 0) nodes.push(line("action", act(filler)));
        nodes.push(line("action", act(k)));
        nodes.push(line("action", act(2)));
        assertParity(docToLines(docOf(...nodes)));
      }
    }
  });

  it("a wrapped transition straddling a page bottom flows like the export", () => {
    // Over 60 chars, so it wraps to two rows in both engines. The export
    // routes transitions through placeFlow, which fills the remaining slots
    // and continues on the next page; the planner used to whole-move the
    // block instead, shifting every subsequent break.
    const twoRow = "Z".repeat(60) + " " + "Z".repeat(10);
    expect(wrap(sanitize(twoRow), LAYOUT.transition.maxChars).length).toBe(2);
    for (const filler of [46, 47, 48, 49, 50, 51, 52]) {
      const nodes: JSONContent[] = [
        line("scene_heading", "INT. ROOM - DAY"),
        line("action", act(filler)),
        line("transition", twoRow),
        line("action", act(52)),
      ];
      assertParity(docToLines(docOf(...nodes)));
    }
    // Pin the exact boundary case: row 1 ends page 1, row 2 opens page 2.
    const nodes: JSONContent[] = [
      line("scene_heading", "INT. ROOM - DAY"),
      line("action", act(50)),
      line("transition", twoRow),
      line("action", act(52)),
    ];
    const { exported, plan } = assertParity(docToLines(docOf(...nodes)));
    expect(exported.pageCount).toBe(2);
    const split = plan.breaks.find((b) => b.index === 2 && b.row > 0);
    expect(split).toBeTruthy();
    expect(split?.more).toBe(false);
    expect(split?.contd).toBe(false);
  });

  it("never splits a parenthetical or a scene heading", () => {
    for (const c of corpus) {
      const lines = docToLines(docOf(...c.nodes));
      const plan = planPages(planBlocksFrom(lines), LINES_PER_PAGE);
      for (const b of plan.breaks.filter((x) => x.row > 0)) {
        const kind = lines[b.index].element;
        expect(kind === "dialogue" || kind === "action").toBe(true);
      }
    }
  });

  it("keeps dual clusters whole (v1 exemption)", () => {
    const lines = docToLines(docOf(...dual));
    const plan = planPages(planBlocksFrom(lines), LINES_PER_PAGE);
    for (const b of plan.breaks.filter((x) => x.row > 0)) {
      expect(lines[b.index].dual).not.toBe(true);
    }
  });
});

describe("the Final Draft / Arc Studio break rules", () => {
  it("never breaks a speech in the middle of a sentence", () => {
    // A ten-row speech with no sentence end cannot break, and only eight
    // rows are left under its cue, so the cue and the speech move together.
    const nodes: JSONContent[] = [
      line("scene_heading", "INT. ROOM - DAY"),
      line("action", act(42)),
      line("character", "ALEX"),
      line("dialogue", unbroken(10)),
    ];
    const { exported } = assertParity(docToLines(docOf(...nodes)));
    expect(exported.pages.map((p) => p.startLine)).toEqual([0, 2]);
    expect(exported.pages[0].ops.some((o) => o.text === "(MORE)")).toBe(false);
  });

  it("breaks mid-line at a sentence end and re-wraps what it carries", () => {
    // Fill page 1 so exactly two dialogue rows fit under the cue: the
    // speech from Arjun's script that Arc Studio breaks this way.
    const speech =
      "I honestly wanted to ask you. I don't remember half the places. " +
      "He took us to a fort and a Buddhist cave I think?";
    const nodes: JSONContent[] = [
      line("action", act(50)),
      line("character", "KRISH"),
      line("dialogue", speech),
    ];
    const lines = docToLines(docOf(...nodes));
    const { exported } = assertParity(lines);
    const page1 = exported.pages[0].ops.map((o) => o.text);
    const page2 = exported.pages[1].ops.map((o) => o.text);
    expect(page1.slice(-3)).toEqual([
      "I honestly wanted to ask you. I",
      "don't remember half the places.",
      "(MORE)",
    ]);
    expect(page2.slice(0, 3)).toEqual([
      "KRISH (CONT'D)",
      "He took us to a fort and a Buddhist",
      "cave I think?",
    ]);
  });

  it("prints (MORE) below the page's last line, not in place of one", () => {
    // 51 rows of action leave 3 slots: blank + cue + 1 row would strand a
    // one-line piece, so find the fill where the speech uses the page's very
    // last line and (MORE) still appears under it.
    const nodes: JSONContent[] = [
      line("action", act(48)),
      line("character", "ALEX"),
      line("dialogue", dlg(8)),
    ];
    const { exported } = assertParity(docToLines(docOf(...nodes)));
    const ops = exported.pages[0].ops;
    const more = ops.find((o) => o.text === "(MORE)")!;
    const lastRow = ops.filter((o) => o.text !== "(MORE)").reduce((a, b) => (b.y < a.y ? b : a));
    expect(lastRow.y).toBe(72); // the 54th line's baseline, on the 1in margin
    expect(more.y).toBe(60); // the line below it
  });

  it("keeps a scene heading with two lines of its action", () => {
    // 50 rows used: blank + heading + blank + one action row would fit, but a
    // heading may not end a page with a single line under it.
    const nodes: JSONContent[] = [
      line("action", act(50)),
      line("scene_heading", "INT. HOSPITAL HALLWAY - DAY"),
      line("action", act(3)),
    ];
    const { exported } = assertParity(docToLines(docOf(...nodes)));
    expect(exported.pages.map((p) => p.startLine)).toEqual([0, 1]);
  });

  it("keeps a heading with a one-line action and the speech after it", () => {
    const nodes: JSONContent[] = [
      line("action", act(49)),
      line("scene_heading", "INT. HOSPITAL HALLWAY - DAY"),
      line("action", act(1)),
      line("character", "KRISH"),
      line("parenthetical", "(through phone)"),
      line("dialogue", "Hello?"),
    ];
    const { exported } = assertParity(docToLines(docOf(...nodes)));
    expect(exported.pages.map((p) => p.startLine)).toEqual([0, 1]);
  });
});
