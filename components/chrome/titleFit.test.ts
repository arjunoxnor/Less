import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Names in one film share their first words ("Horse Lords ..."), so a clipped
// name is an ambiguous one. These pin the two places that used to clip: the
// editor's title field (an <input> shows about twenty characters by default)
// and the narrow Docs panel (it used an ellipsis).
const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");
const topBar = readFileSync(resolve(process.cwd(), "components/chrome/TopBar.tsx"), "utf8");

// Comments sit in front of these rules, and would otherwise be read as part
// of the selector.
const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");

function ruleFor(selector: string): string {
  for (const match of bare.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (match[1].split(",").some((part) => part.trim() === selector)) return match[2];
  }
  return "";
}

describe("document names are shown whole", () => {
  it("the title field is sized by a hidden copy of the title", () => {
    expect(topBar).toMatch(/className="topbar-title-fit"\s+data-value=\{draft\}/);
    expect(topBar).toMatch(/size=\{1\}/);
    expect(ruleFor(".topbar-title-fit")).toContain("display: inline-grid");
    expect(ruleFor(".topbar-title-fit")).toContain("minmax(0, 1fr)");
    const mirror = ruleFor(".topbar-title-fit::after");
    expect(mirror).toContain("content: attr(data-value)");
    expect(mirror).toContain("visibility: hidden");
    expect(mirror).toContain("white-space: pre");
  });

  it("the hidden copy and the input share one box, or the widths drift", () => {
    const mirror = ruleFor(".topbar-title-fit::after");
    const input = ruleFor(".topbar-title");
    const padding = /padding:\s*([^;]+);/.exec(input)?.[1];
    expect(padding).toBeTruthy();
    for (const decl of ["grid-area: 1 / 1", `padding: ${padding}`, "border: 1px solid transparent"]) {
      expect(mirror).toContain(decl);
      expect(input).toContain(decl);
    }
    expect(input).toContain("width: 100%");
  });

  it("the Docs panel wraps a long name instead of cutting it", () => {
    const rule = ruleFor(".docs-item-title");
    expect(rule).toContain("overflow-wrap: anywhere");
    expect(rule).not.toContain("ellipsis");
    expect(rule).not.toContain("nowrap");
  });
});
