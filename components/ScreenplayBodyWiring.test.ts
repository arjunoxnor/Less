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

  it("offers the guest's save-a-copy action only to a guest", () => {
    expect(source).toContain(
      "session && !session.owner && onSaveDuetCopy ? openSaveCopy : undefined"
    );
    expect(source).toContain(
      '[{ label: "Save a copy to my library…", onSelect: onSaveCopy } as MenuItem]'
    );
  });

  it("never mirrors a guest's shared room into the local library", () => {
    expect(source).toContain("const mirrorsToLibrary = duetMirrorsToLibrary(duetAccess);");
    // The debounced autosave, the unmount flush and the pagehide flush are the
    // three places that could file the room as a phantom project.
    expect(source).toContain("if (!mirrorsToLibrary) {");
    expect(source).toContain("if (ed && unsavedRef.current && mirrorsToLibrary) {");
    expect(source).toContain("if (!ed || !unsavedRef.current || !mirrorsToLibrary) return;");
    // And the sync hook's own local write, which a restore or import uses even
    // while cloud sync is off.
    expect(source).toContain("mirrorsToLibrary ? saveProjectDoc(projectId, d) : true");
  });

  it("reads the shared room to build the copy and never writes to it", () => {
    const saveCopy = source.slice(
      source.indexOf("const openSaveCopy = () => {"),
      source.indexOf("const stopSharing = async () => {")
    );
    expect(saveCopy).toContain("session.getContent()");
    expect(saveCopy).not.toMatch(/session\.(setTitle|setUser|destroy)\(/);
    expect(saveCopy).not.toContain("saveProjectDoc(");
  });

  it("warns that history restore also replaces title-page metadata", () => {
    expect(source).toContain(
      "This replaces your current text and title page with the selected version."
    );
  });
});
