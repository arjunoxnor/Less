import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import {
  DOC_TEXT_HEIGHT,
  DocPagination,
  collapseMargins,
  DOC_PAGINATION_KEY,
  planDocPages,
  requestDocPagination,
  type DocPageAssignment,
  type DocPlanBlock,
} from "./docPagination";

const CAPACITY = DOC_TEXT_HEIGHT;

function prose(
  lines: number,
  lineHeight: number,
  options: Partial<DocPlanBlock> = {}
): DocPlanBlock {
  return {
    kind: "paragraph",
    height: lines * lineHeight,
    marginTop: 0,
    marginBottom: 0,
    lineTops: Array.from({ length: lines }, (_, index) => index * lineHeight),
    ...options,
  };
}

function assignmentsFor(
  assignments: DocPageAssignment[],
  blockIndex: number
): DocPageAssignment[] {
  return assignments.filter((assignment) => assignment.blockIndex === blockIndex);
}

function allAssignments(plan: ReturnType<typeof planDocPages>): DocPageAssignment[] {
  return plan.pages.flatMap((page) => page.assignments);
}

describe("prose page planner", () => {
  it("places a block that fits on the current page", () => {
    const plan = planDocPages([prose(8, 30)]);
    expect(plan.pageCount).toBe(1);
    expect(plan.breaks).toEqual([]);
    expect(plan.pages[0].used).toBe(240);
  });

  it("moves a whole block when it does not fit", () => {
    const plan = planDocPages([
      prose(1, 710, { kind: "code", splittable: false }),
      prose(3, 70),
    ]);
    expect(plan.breaks).toEqual([{ blockIndex: 1, line: 0 }]);
    expect(plan.pageCount).toBe(2);
    expect(plan.pages[1].assignments[0]).toMatchObject({
      blockIndex: 1,
      startLine: 0,
      endLine: 3,
    });
  });

  it("splits a paragraph only at one of its measured line tops", () => {
    const uneven: DocPlanBlock = {
      kind: "paragraph",
      height: 310,
      marginTop: 0,
      marginBottom: 0,
      lineTops: [0, 42, 105, 171, 238],
    };
    const plan = planDocPages([
      prose(1, 700, { kind: "code", splittable: false }),
      uneven,
    ]);
    expect(plan.breaks).toEqual([{ blockIndex: 1, line: 2 }]);
    expect(assignmentsFor(allAssignments(plan), 1).map((part) => [
      part.startLine,
      part.endLine,
      part.height,
    ])).toEqual([
      [0, 2, 105],
      [2, 5, 205],
    ]);
  });

  it("moves a heading with the first two following lines", () => {
    const plan = planDocPages([
      prose(1, 710, { kind: "code", splittable: false }),
      prose(1, 70, { kind: "heading", marginBottom: 10 }),
      prose(5, 40),
    ]);
    expect(plan.breaks[0]).toEqual({ blockIndex: 1, line: 0 });
    expect(plan.pages[0].assignments.map((part) => part.blockIndex)).toEqual([0]);
    expect(plan.pages[1].assignments.slice(0, 2).map((part) => part.blockIndex)).toEqual([1, 2]);
  });

  it("never splits a heading", () => {
    const plan = planDocPages([
      prose(1, 500, { kind: "code", splittable: false }),
      prose(8, 50, { kind: "heading" }),
    ]);
    expect(plan.breaks).toEqual([{ blockIndex: 1, line: 0 }]);
    expect(assignmentsFor(allAssignments(plan), 1)).toHaveLength(1);
  });

  it("moves a paragraph instead of leaving one orphan line at the bottom", () => {
    const plan = planDocPages([
      prose(1, 820, { kind: "code", splittable: false }),
      prose(4, 30),
    ]);
    expect(plan.breaks).toEqual([{ blockIndex: 1, line: 0 }]);
  });

  it("backs up a line instead of leaving one widow line at the top", () => {
    const plan = planDocPages([
      prose(1, 770, { kind: "code", splittable: false }),
      prose(4, 30),
    ]);
    expect(plan.breaks).toEqual([{ blockIndex: 1, line: 2 }]);
    expect(assignmentsFor(allAssignments(plan), 1).map((part) => [
      part.startLine,
      part.endLine,
    ])).toEqual([[0, 2], [2, 4]]);
  });

  it("splits lists between items and keeps a marker with an item's first line", () => {
    const plan = planDocPages([
      prose(1, 700, { kind: "code", splittable: false }),
      prose(4, 60, { kind: "listItem" }),
      prose(2, 400, { kind: "listItem", splittable: false }),
    ]);
    const firstItem = assignmentsFor(allAssignments(plan), 1);
    expect(plan.breaks[0]).toEqual({ blockIndex: 1, line: 2 });
    expect(firstItem[0]).toMatchObject({ startLine: 0, endLine: 2 });
    expect(firstItem.slice(1).every((part) => part.startLine > 0)).toBe(true);
    expect(plan.breaks).toContainEqual({ blockIndex: 2, line: 0 });
  });

  it("splits quotes and code at their own measured lines", () => {
    const plan = planDocPages([
      prose(12, 80, { kind: "blockquote" }),
      prose(12, 80, { kind: "code" }),
    ]);
    expect(plan.breaks.some((brk) => brk.blockIndex === 0 && brk.line > 0)).toBe(true);
    expect(plan.breaks.some((brk) => brk.blockIndex === 1 && brk.line > 0)).toBe(true);
    for (const page of plan.pages) expect(page.used).toBeLessThanOrEqual(CAPACITY);
  });

  it("splits a block taller than a page and always makes progress", () => {
    const plan = planDocPages([prose(30, 100)]);
    const parts = assignmentsFor(allAssignments(plan), 0);
    expect(plan.pageCount).toBeGreaterThan(1);
    expect(parts[0].startLine).toBe(0);
    expect(parts.at(-1)?.endLine).toBe(30);
    for (let i = 1; i < parts.length; i++) {
      expect(parts[i].startLine).toBe(parts[i - 1].endLine);
    }
  });

  it("accounts for collapsed margins instead of adding both sides", () => {
    expect(collapseMargins(30, 20)).toBe(30);
    expect(collapseMargins(-8, -14)).toBe(-14);
    expect(collapseMargins(20, -6)).toBe(14);
    const plan = planDocPages([
      prose(1, 400, { kind: "code", splittable: false, marginBottom: 30 }),
      prose(1, 400, { kind: "code", splittable: false, marginTop: 20 }),
    ]);
    expect(plan.pageCount).toBe(1);
    expect(plan.pages[0].used).toBe(830);
  });

  it("returns one empty sheet for an empty document", () => {
    const plan = planDocPages([]);
    expect(plan).toMatchObject({ pageCount: 1, breaks: [] });
    expect(plan.pages).toEqual([{ number: 1, used: 0, assignments: [] }]);
  });

  it("never overfills a page or drops or duplicates measured lines", () => {
    let seed = 0x5eed1234;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };

    for (let run = 0; run < 250; run++) {
      const blocks = Array.from({ length: Math.floor(random() * 35) }, () => {
        const lines = 1 + Math.floor(random() * 70);
        const lineHeight = 10 + Math.floor(random() * 35);
        return prose(lines, lineHeight, {
          marginTop: Math.floor(random() * 25),
          marginBottom: Math.floor(random() * 25),
        });
      });
      const plan = planDocPages(blocks);
      for (const page of plan.pages) {
        expect(page.used).toBeLessThanOrEqual(CAPACITY + 0.01);
      }
      const assignments = allAssignments(plan);
      for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
        const parts = assignmentsFor(assignments, blockIndex);
        expect(parts.length).toBeGreaterThan(0);
        expect(parts[0].startLine).toBe(0);
        expect(parts.at(-1)?.endLine).toBe(blocks[blockIndex].lineTops.length);
        for (let index = 1; index < parts.length; index++) {
          expect(parts[index].startLine).toBe(parts[index - 1].endLine);
        }
      }
    }
  });
});

describe("prose pagination refuses to run without layout", () => {
  // The regression this guards: the paginator once measured the editor before
  // it had been laid out. With a zero-width column every line wraps at one
  // character, so a single-sentence paragraph measured ~90 lines tall and the
  // planner faithfully turned a 682-word note into 114 sheets with spacers
  // wedged mid-sentence.
  //
  // jsdom cannot reproduce the wrapping itself (it has no layout engine, so
  // every rect is already zero and nothing overflows). What it CAN prove is
  // the guard's actual contract: with no measured width, the paginator must
  // not run a pass at all. Each pass ends in a transaction carrying this
  // plugin's result meta, so counting those transactions distinguishes
  // "declined to paginate" from "paginated a document it could not measure".
  it("runs no pagination pass while the editor has no measured width", async () => {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: [Document, Paragraph, Text, DocPagination],
      content: {
        type: "doc",
        content: Array.from({ length: 40 }, (_, index) => ({
          type: "paragraph",
          content: [
            { type: "text", text: `Line ${index}. The guy sits down for a second.` },
          ],
        })),
      },
    });

    let passes = 0;
    editor.on("transaction", ({ transaction }) => {
      if ((transaction.getMeta(DOC_PAGINATION_KEY) as { result?: unknown } | undefined)?.result) {
        passes++;
      }
    });

    requestDocPagination(editor);
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(editor.view.dom.clientWidth).toBe(0);
    expect(passes).toBe(0);
    expect(editor.view.dom.querySelectorAll(".doc-page-gap")).toHaveLength(0);

    editor.destroy();
  });

  it("runs a pagination pass once the editor reports a width", async () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = new Editor({
      element,
      extensions: [Document, Paragraph, Text, DocPagination],
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "One line." }] }],
      },
    });
    // jsdom reports 0 for every element; stand in for a laid-out column.
    Object.defineProperty(editor.view.dom, "clientWidth", { value: 816, configurable: true });

    let passes = 0;
    editor.on("transaction", ({ transaction }) => {
      if ((transaction.getMeta(DOC_PAGINATION_KEY) as { result?: unknown } | undefined)?.result) {
        passes++;
      }
    });

    requestDocPagination(editor);
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(passes).toBeGreaterThan(0);

    editor.destroy();
    element.remove();
  });
});
