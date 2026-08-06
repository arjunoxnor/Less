import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(process.cwd(), "components/ScreenplayBody.tsx"),
  "utf8"
);

describe("ScreenplayBody safety wiring", () => {
  it("exposes pre-debounce edits to sibling-tab and cloud-pull guards", () => {
    expect(source).toContain(
      "hasUnsavedLocalEdits: () => unsavedRef.current"
    );
  });

  it("does not re-save and rebroadcast content adopted from a sibling tab", () => {
    expect(source).not.toContain(
      "const ok = saveProjectDoc(projectId, editor.getJSON());"
    );
    expect(source).toContain("setSaved(pulledSaveOk)");
  });

  it("keeps breakdown persistence outside React state updater callbacks", () => {
    expect(source).not.toMatch(/setBreakdownItems\(\(prev\)[\s\S]{0,500}saveBreakdown/);
    expect(source).toContain("breakdownItemsRef.current = next;\n      setBreakdownItems(next);");
  });

  it("can navigate to breakdown occurrences before the first scene", () => {
    expect(source).toContain("if (n === 0) {\n        jumpToScene(1);");
  });

  it("refreshes scene page badges when boundaries move at the same page count", () => {
    expect(source).toContain("onLayout: () => setPaginationTick");
    expect(source).toContain("page: pageAtPos(editor.state, scene.pos)");
  });

  it("warns that history restore also replaces title-page metadata", () => {
    expect(source).toContain(
      "This replaces your current text and title page with the selected version."
    );
  });
});
