import { describe, it, expect } from "vitest";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { joinSig } from "./pagination";
import { docOf, line, makeEditor } from "./testKit";

/**
 * Convergence regression for the pagination signature: DecorationSet.find()
 * enumerates the doc-level page-gap widgets before the split widgets nested
 * inside blocks, which is not document order once a mid-block split exists.
 * The raw enumeration orders therefore never matched compute()'s ascending
 * build, so run() re-dispatched and rescheduled until the passes cap on every
 * keystroke. joinSig canonicalizes both sides; whatever order a decoration
 * set yields, the signature must equal the document-order build.
 */
describe("pagination signature canonicalization", () => {
  it("find() enumeration and document order produce the same signature", () => {
    const ed = makeEditor(
      docOf(line("dialogue", "x".repeat(200)), line("action", "tail"))
    );
    const doc = ed.state.doc;
    const gapPos = doc.child(0).nodeSize; // boundary between the two blocks
    const splitKey = "split-5-100-1-ALEX (CONT'D)";
    const gapKey = `gap-${gapPos}-40`;
    const el = () => document.createElement("span");
    const set = DecorationSet.create(doc, [
      Decoration.widget(5, el, { side: -1, key: splitKey, ignoreSelection: true, marks: [] }),
      Decoration.widget(gapPos, el, { side: -1, key: gapKey, ignoreSelection: true, marks: [] }),
    ]);

    const found = set.find().map((d) => ({
      from: d.from,
      key: (d.spec as { key?: string }).key ?? "",
    }));
    // Both widgets survive the round trip through the set.
    expect(found.map((f) => f.from).sort((a, b) => a - b)).toEqual([5, gapPos]);

    const documentOrder = [
      { from: 5, key: splitKey },
      { from: gapPos, key: gapKey },
    ];
    expect(joinSig(found, 2)).toBe(joinSig(documentOrder, 2));
    ed.destroy();
  });

  it("is insensitive to entry order and ties on position break by key", () => {
    const a = [
      { from: 10, key: "gap-10-40" },
      { from: 3, key: "split-3-80-1-MARA (CONT'D)" },
      { from: 10, key: "gap-10-12" },
    ];
    const b = [a[2], a[0], a[1]].map((e) => ({ ...e }));
    expect(joinSig([...a.map((e) => ({ ...e }))], 3)).toBe(joinSig(b, 3));
  });
});
