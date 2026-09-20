import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "lib/storage/useCloudSync.ts"), "utf8");

describe("cloud sync completion wiring", () => {
  it("does not send a cached title page with an unrelated body edit", () => {
    expect(source).toContain(
      "saveScript(o.projectId, doc, tpWasDirty ? tp : undefined)"
    );
  });

  it("rechecks body and title-page snapshots before clearing dirty state", () => {
    expect(source).toContain("stillMatchesSnapshot(editor.getJSON(), docSnapshot)");
    expect(source).toContain("stillMatchesSnapshot(titlePageRef.current, tpSnapshot)");
  });

  it("returns after a null reconcile save instead of reporting synced", () => {
    // The pull that used to follow here (`else if (cloudNewer)`) now happens
    // inside settleWithCloud; what must still hold is that a failed reconcile
    // save returns before the status below can be painted "synced".
    expect(source).toMatch(
      /setStatus\("error"\);\n\s+return;\n\s+}\n\s+}\n\s+} else {\n\s+\/\/ No cloud row yet/
    );
    expect(source).toContain('if (decision === "push") {');
  });

  it("does not report synced while a newer title is still dirty", () => {
    expect(source).toContain('!o.isTitleDirty()\n          ? "synced"\n          : "syncing"');
  });

  it("clears title dirty after creating the exact requested title", () => {
    expect(source).toContain(
      "if (stillMatchesField(currentTitle, requestedTitle)) o.setTitleDirty(false)"
    );
  });

  it("treats a null title response as a sync error", () => {
    expect(source).toContain(
      'if (!ts) throw new Error("title save did not reach the cloud")'
    );
  });

  it("marks sibling adoption successful without writing the same body again", () => {
    expect(source).toContain(
      "editor.commands.setContent(fresh, { emitUpdate: false });\n      setPulledSaveOk(true);"
    );
  });

  it("adopts a sibling title page unless this tab has its own pending edit", () => {
    expect(source).toContain('if (msg.type === "titlePageSaved")');
    expect(source).toContain("if (ownTitlePageDirtyRef.current) return;");
    expect(source).toContain("setTitlePageState(freshTitlePage)");
  });

  it("uses per-tab dirty refs instead of a sibling's shared dirty key", () => {
    expect(source).toContain(
      "if (ownDirtyRef.current || optsRef.current.hasUnsavedLocalEdits?.()) return;"
    );
    expect(source).toContain("const tpWasDirty = ownTitlePageDirtyRef.current");
  });
});
