import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Two layout regressions are cheap to reintroduce and expensive to notice, so
 * they are pinned here against the stylesheet text.
 *
 * 1. The page host has no width of its own: `.page-host` is a shrink-to-fit
 *    flex item and takes its width from `.sp-editor .sp-prose`. While the
 *    prose is `8.5in` the host is a definite 816px. The moment the prose
 *    becomes `width: 100%` the percentage is circular, the host falls back to
 *    the max-content width of the text, and on a viewport too wide to clamp it
 *    the sheet collapses to a narrow strip (measured: 816px -> 354px at an
 *    860px viewport, 187px for an empty script), roughly doubling the page
 *    count. Below 720px the viewport clamps the host, so the full-width page is
 *    safe there and only there.
 * 2. Clamping the plain document font size makes the small sizes the picker
 *    offers unreachable while the select still reports the chosen number.
 */

const cssPath = resolve(process.cwd(), "app/globals.css");
// Comments are stripped so a comment above a rule cannot be read as part of
// its selector list.
const css = readFileSync(cssPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Every top-level `@media` block, as { query, body }. */
function mediaBlocks(): { query: string; body: string }[] {
  const out: { query: string; body: string }[] = [];
  const opener = /@media([^{]*)\{/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(css))) {
    let depth = 1;
    let i = opener.lastIndex;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") depth -= 1;
      i += 1;
    }
    out.push({ query: match[1].trim(), body: css.slice(opener.lastIndex, i - 1) });
    opener.lastIndex = i;
  }
  return out;
}

/** Declarations of the rule whose selector list contains `selector` exactly. */
function ruleIn(source: string, selector: string): string {
  for (const match of source.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (match[1].split(",").some((part) => part.trim() === selector)) return match[2];
  }
  return "";
}

/** The max-width breakpoints of every block that collapses the page geometry. */
function breakpointsCollapsingThePage(): number[] {
  const found: number[] = [];
  for (const block of mediaBlocks()) {
    const collapses =
      /width:\s*100%/.test(ruleIn(block.body, ".sp-editor .sp-prose")) ||
      /width:\s*100%/.test(ruleIn(block.body, ".page-sheet")) ||
      /width:\s*100%/.test(ruleIn(block.body, ".pl-prose"));
    if (!collapses) continue;
    const width = /max-width:\s*(\d+)px/.exec(block.query);
    // A print block has no width condition and legitimately drops the sheet.
    if (block.query.includes("print")) continue;
    found.push(width ? Number(width[1]) : Number.NaN);
  }
  return found;
}

describe("responsive page geometry", () => {
  it("only collapses the page to full width where the viewport clamps the host", () => {
    const breakpoints = breakpointsCollapsingThePage();
    expect(breakpoints.length).toBeGreaterThan(0);
    for (const bp of breakpoints) expect(bp).toBeLessThanOrEqual(720);
  });

  it("keeps the screenplay prose at a definite 8.5in outside the mobile band", () => {
    expect(ruleIn(css, ".sp-editor .sp-prose")).toMatch(/width:\s*8\.5in/);
    expect(ruleIn(css, ".page-sheet")).toMatch(/width:\s*8\.5in/);
  });

  it("still reflows the chrome at the wider tablet breakpoint", () => {
    const wide = mediaBlocks().filter((b) => /max-width:\s*900px/.test(b.query));
    expect(wide.some((b) => /overflow-x:\s*auto/.test(ruleIn(b.body, ".editor-secondrow")))).toBe(
      true
    );
  });
});

describe("plain document font size", () => {
  it("honours every size the picker offers instead of clamping to a floor", () => {
    const rule = ruleIn(css, ".pl-prose");
    expect(rule).toMatch(/font-size:\s*var\(--doc-font-size/);
    expect(rule).not.toMatch(/font-size:\s*(max|clamp)\(/);
  });
});
