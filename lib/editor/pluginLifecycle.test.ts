import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("async editor plugin teardown", () => {
  it("guards lazy spellcheck completion after the view is destroyed", () => {
    const source = readFileSync(resolve(process.cwd(), "lib/editor/spellcheck.ts"), "utf8");
    expect(source).toContain("if (destroyed) return;\n                    speller = s;");
    expect(source).toContain("destroyed = true;\n                if (timer)");
  });

  it("guards font-ready pagination work after the view is destroyed", () => {
    const source = readFileSync(resolve(process.cwd(), "lib/editor/pagination.ts"), "utf8");
    expect(source).toContain("if (destroyed) return;\n                metrics.clear();");
    expect(source).toContain("destroyed = true;\n              if (raf)");
  });

  it("rescans breakdown highlights only on changed lines while typing", () => {
    const source = readFileSync(resolve(process.cwd(), "lib/editor/breakdownMarks.ts"), "utf8");
    expect(source).toContain("old.map(tr.mapping, tr.doc)");
    expect(source).toContain("changedTopLevelNodes(newState.doc, ranges)");
  });

  it("limits auto-caps and revision work to changed top-level lines", () => {
    for (const file of ["autoCaps.ts", "revisions.ts"]) {
      const source = readFileSync(resolve(process.cwd(), `lib/editor/${file}`), "utf8");
      expect(source).toContain("changedTopLevelNodes(newState.doc, ranges)");
    }
  });
});
