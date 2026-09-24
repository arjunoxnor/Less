import { describe, expect, it } from "vitest";

import { diffScripts, diffWords, linesFromDoc, summarize, type DiffLine } from "./scriptDiff";
import { docOf, line } from "./testKit";

const L = (element: DiffLine["element"], text: string): DiffLine => ({ element, text });

const draft1 = [
  L("scene_heading", "INT. KITCHEN - DAY"),
  L("action", "Mara makes tea."),
  L("character", "MARA"),
  L("dialogue", "Not now."),
  L("scene_heading", "EXT. STREET - NIGHT"),
  L("action", "Rain."),
];

describe("comparing two drafts", () => {
  it("finds nothing between identical drafts", () => {
    const rows = diffScripts(draft1, draft1);
    expect(rows.every((r) => r.kind === "same")).toBe(true);
    expect(summarize(rows)).toEqual({ added: 0, removed: 0, changed: 0, scenesChanged: 0 });
  });

  it("marks a reworded line with the words that changed", () => {
    const draft2 = [...draft1];
    draft2[3] = L("dialogue", "Not now, Jonah.");
    const rows = diffScripts(draft1, draft2);
    const changed = rows.find((r) => r.kind === "changed");
    expect(changed).toBeDefined();
    if (changed?.kind !== "changed") return;
    expect(changed.before.text).toBe("Not now.");
    expect(changed.after.text).toBe("Not now, Jonah.");
    expect(changed.words.filter((w) => w.kind === "added").map((w) => w.text).join("")).toContain("Jonah.");
    expect(summarize(rows)).toMatchObject({ changed: 1, added: 0, removed: 0, scenesChanged: 1 });
  });

  it("marks lines cut and lines added, and counts the scenes they touch", () => {
    const draft2 = [
      ...draft1.slice(0, 2),
      ...draft1.slice(4),
      L("action", "Thunder. The streetlights die one by one."),
    ];
    const rows = diffScripts(draft1, draft2);
    expect(rows.filter((r) => r.kind === "removed").map((r) => (r.kind === "removed" ? r.line.text : ""))).toEqual([
      "MARA",
      "Not now.",
    ]);
    expect(rows.filter((r) => r.kind === "added")).toHaveLength(1);
    expect(summarize(rows)).toMatchObject({ added: 1, removed: 2, scenesChanged: 2 });
  });

  it("treats a changed line type as a change even when the words match", () => {
    const draft2 = [...draft1];
    draft2[1] = L("dialogue", "Mara makes tea.");
    const rows = diffScripts(draft1, draft2);
    expect(rows.some((r) => r.kind !== "same")).toBe(true);
  });

  it("keeps a whole feature fast", () => {
    const big: DiffLine[] = [];
    for (let i = 0; i < 2000; i++) big.push(L(i % 5 === 0 ? "scene_heading" : "action", `Line ${i} of the draft.`));
    const edited = big.map((l, i) => (i % 97 === 0 ? L(l.element, l.text + " Revised.") : l));
    const started = performance.now();
    const rows = diffScripts(big, edited);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(summarize(rows).changed).toBe(Math.ceil(2000 / 97));
  });

  it("reads lines out of a stored document", () => {
    const lines = linesFromDoc(docOf(line("scene_heading", "INT. CAVE - DAY"), line("action", "")));
    expect(lines).toEqual([L("scene_heading", "INT. CAVE - DAY"), L("action", "")]);
  });

  it("diffs words in order", () => {
    expect(diffWords("the cat sat", "the dog sat")).toEqual([
      { kind: "same", text: "the " },
      { kind: "removed", text: "cat" },
      { kind: "added", text: "dog" },
      { kind: "same", text: " sat" },
    ]);
  });
});
