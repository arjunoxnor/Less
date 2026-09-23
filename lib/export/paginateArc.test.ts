/**
 * Page-for-page parity with Arc Studio, on a real script.
 *
 * The fixture is Arjun's own 81-page script as Arc Studio exported it, rebuilt
 * line by line from the PDF (element types from each line's indent, wrapped
 * lines joined back into paragraphs) with its letters masked. Arc Studio's
 * page breaks came with it: `arcPageStarts[p]` is the paragraph that opens
 * page p + 1, and `arcSplitPages` are the pages that open on the carried half
 * of a speech (the page before each one ends in (MORE)).
 *
 * Both engines must reproduce every one of them: the PDF engine
 * (lib/export/paginate.ts) and the on-screen planner (lib/editor/pagination.ts)
 * fed the same line counts the browser measures. Before the Arc rules went in
 * (one blank line before a scene heading, (MORE) below the last line, speeches
 * broken only at a sentence end, a heading keeping two lines of action) the
 * PDF engine matched on page 1 only.
 */
import { describe, expect, it } from "vitest";
import fixture from "./fixtures/arc-gooa.json";
import { paginate } from "./paginate";
import { LAYOUT, LINES_PER_PAGE, sanitize, wrap } from "./layout";
import { planPages, textSplitModel, type PlanBlock } from "@/lib/editor/pagination";
import { cueBaseName } from "@/lib/editor/outline";
import type { ScriptLine } from "@/types/screenplay";

const lines = fixture.lines as ScriptLine[];

function planBlocks(src: ScriptLine[]): PlanBlock[] {
  let cue: string | null = null;
  return src.map((l) => {
    const el = LAYOUT[l.element];
    const text = sanitize(l.text);
    if (l.element === "character") cue = cueBaseName(text).toUpperCase() || null;
    else if (l.element === "scene_heading" || l.element === "action" || l.element === "transition") {
      cue = null;
    }
    const splittable = l.element === "dialogue" || l.element === "action";
    return {
      kind: l.element,
      rows: wrap(text, el.maxChars, el.hang ?? 0).length,
      spaceBefore: el.spaceBefore,
      dual: false,
      cue: l.element === "dialogue" && cue != null,
      model: splittable ? textSplitModel(text, el.maxChars, el.hang ?? 0) : null,
    };
  });
}

describe("Arc Studio parity on a real 81-page script", () => {
  it("the PDF engine starts every page where Arc Studio does", () => {
    const { pages, pageCount } = paginate(lines);
    expect(pageCount).toBe(fixture.arcPageStarts.length);
    expect(pages.map((p) => p.startLine)).toEqual(fixture.arcPageStarts);
  });

  it("breaks the same four speeches, with (MORE) and NAME (CONT'D)", () => {
    const { pages } = paginate(lines);
    const withMore = pages.filter((p) => p.ops.some((o) => o.text === "(MORE)")).map((p) => p.number);
    expect(withMore).toEqual(fixture.arcSplitPages.map((p) => p - 1));
    for (const n of fixture.arcSplitPages) {
      const top = pages[n - 1].ops[0];
      expect(top.text.endsWith("(CONT'D)")).toBe(true);
      // Both markers sit at the character cue's indent (3.5in from the edge).
      expect(top.x).toBe(LAYOUT.character.x);
      const more = pages[n - 2].ops.find((o) => o.text === "(MORE)")!;
      expect(more.x).toBe(LAYOUT.character.x);
    }
  });

  it("the on-screen planner starts every page where Arc Studio does", () => {
    const plan = planPages(planBlocks(lines), LINES_PER_PAGE);
    expect(plan.pageCount).toBe(fixture.arcPageStarts.length);
    expect(plan.pageStartBlocks).toEqual(fixture.arcPageStarts);
    const splitPages = plan.breaks
      .map((b, i) => (b.row > 0 ? i + 2 : 0))
      .filter((p) => p > 0);
    expect(splitPages).toEqual(fixture.arcSplitPages);
  });
});
