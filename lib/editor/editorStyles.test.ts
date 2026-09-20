import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");
const plainBody = readFileSync(resolve(process.cwd(), "components/PlainBody.tsx"), "utf8");
const docPagination = readFileSync(
  resolve(process.cwd(), "lib/editor/docPagination.ts"),
  "utf8"
);

function ruleFor(selector: string): string {
  for (const match of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (match[1].split(",").some((part) => part.trim() === selector)) return match[2];
  }
  return "";
}

describe("editor placeholder and spacing styles", () => {
  it("screenplay placeholders inherit the line box alignment without floating", () => {
    const rule = ruleFor(".sp-prose .is-empty::before");
    expect(rule).toContain("display: block");
    expect(rule).toContain("text-align: inherit");
    expect(rule).not.toMatch(/\bfloat\s*:/);
  });

  it("only top-level plain paragraphs carry the paragraph gap", () => {
    expect(ruleFor(".pl-prose p")).toMatch(/margin:\s*0\s*;/);
    expect(ruleFor(".pl-prose > p")).toMatch(/margin-bottom:\s*0\.8em\s*;/);
    expect(ruleFor(".pl-prose > :first-child")).toMatch(/margin-top:\s*0\s*;/);
  });

  it("renders measured prose pages without borrowing screenplay pagination", () => {
    expect(plainBody).toContain("DocPagination.configure");
    expect(plainBody).not.toMatch(/\bPagination\.configure/);
    expect(plainBody).toContain("<PageBackdrop");
    expect(plainBody).not.toContain('className="plain-sheet"');
    expect(css).toMatch(/\.doc-page-gap\s*\{[^}]*display:\s*block/);
    expect(css).toMatch(/\.doc-page-gap\s*\{[^}]*pointer-events:\s*none/);
  });

  it("keeps every top-level plain block on the same vertical rhythm", () => {
    for (const selector of [
      ".pl-prose > p",
      ".pl-prose > h1",
      ".pl-prose > h2",
      ".pl-prose > h3",
      ".pl-prose > ul",
      ".pl-prose > ol",
      ".pl-prose > blockquote",
      ".pl-prose > pre",
    ]) {
      expect(ruleFor(selector), selector).toMatch(/margin-bottom:\s*0\.8em/);
    }
    expect(ruleFor(".pl-prose > hr")).toMatch(/margin:\s*0\.8em 0/);
  });

  it("contains long prose and code inside the sheet", () => {
    expect(ruleFor(".pl-prose")).toMatch(/overflow-wrap:\s*anywhere/);
    expect(ruleFor(".pl-prose")).toMatch(/min-width:\s*0/);
    expect(ruleFor(".pl-prose pre")).toMatch(/max-width:\s*100%/);
    expect(ruleFor('.pl-prose ul[data-type="taskList"] li > div')).toMatch(
      /min-width:\s*0/
    );
  });

  it("reflows documents for every layout-changing input without polling", () => {
    expect(docPagination).toContain("new ResizeObserverCtor");
    expect(docPagination).toContain('addEventListener("resize", onResize)');
    expect(docPagination).toContain("nextView.state.doc !== previousState.doc");
    expect(docPagination).toContain("Math.min(90, 320 - elapsed)");
    // isBoard joined the list when boards arrived: a board has no sheets, so the
    // effect returns early for it, and every layout-changing input is still here.
    expect(plainBody).toContain(
      "[editor, isBoard, prefs.docFont, prefs.docFontSize, prefs.focusMode, activePanel]"
    );
  });
});
