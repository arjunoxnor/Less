import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

function ruleFor(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
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
    expect(ruleFor(".pl-prose > p")).toMatch(/margin:\s*0 0 0\.8em\s*;/);
    expect(ruleFor(".pl-prose > :first-child")).toMatch(/margin-top:\s*0\s*;/);
  });
});
