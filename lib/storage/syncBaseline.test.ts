import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import {
  canonicalJson,
  decideRemote,
  isBlankDoc,
  syncFingerprint,
} from "./syncBaseline";

const doc = (text: string): JSONContent => ({
  type: "doc",
  content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : undefined }],
});

const base = {
  baseline: null as string | null,
  localPrint: "L",
  cloudPrint: "C",
  localBlank: false,
  cloudBlank: false,
  cloudMoved: true,
  legacyDirty: false,
  legacyCloudNewer: false,
};

describe("syncFingerprint", () => {
  it("ignores key order, which differs between writers", () => {
    const fromEditor = { type: "doc", content: [{ type: "p", attrs: { a: 1, b: 2 } }] };
    const fromOutside = { content: [{ attrs: { b: 2, a: 1 }, type: "p" }], type: "doc" };
    expect(canonicalJson(fromEditor)).toBe(canonicalJson(fromOutside));
    expect(syncFingerprint(fromEditor, null)).toBe(syncFingerprint(fromOutside, null));
  });

  it("changes when a single word changes", () => {
    expect(syncFingerprint(doc("the boy rides"), null)).not.toBe(
      syncFingerprint(doc("the boy walks"), null)
    );
  });

  it("treats an empty title page and no title page as the same", () => {
    expect(syncFingerprint(doc("x"), null)).toBe(syncFingerprint(doc("x"), undefined));
    expect(syncFingerprint(doc("x"), null)).toBe(syncFingerprint(doc("x"), { title: "  " }));
  });

  it("changes when the title page changes", () => {
    expect(syncFingerprint(doc("x"), { title: "Horse Lords" })).not.toBe(
      syncFingerprint(doc("x"), null)
    );
  });
});

describe("isBlankDoc", () => {
  it("is true for nothing, an empty doc, and whitespace-only lines", () => {
    expect(isBlankDoc(null)).toBe(true);
    expect(isBlankDoc({ type: "doc" })).toBe(true);
    expect(isBlankDoc(doc(""))).toBe(true);
    expect(isBlankDoc(doc("   "))).toBe(true);
    // The exact shape a new empty screenplay is stored as.
    expect(
      isBlankDoc({
        type: "doc",
        content: [{ type: "screenplayLine", attrs: { element: "scene_heading" } }],
      })
    ).toBe(true);
  });

  it("is false as soon as there is a word anywhere", () => {
    expect(isBlankDoc(doc("INT."))).toBe(false);
    expect(
      isBlankDoc({
        type: "doc",
        content: [
          { type: "bulletList", content: [{ type: "listItem", content: [doc("deep")] }] },
        ],
      })
    ).toBe(false);
  });
});

describe("decideRemote", () => {
  it("does nothing when both sides already match and nothing moved", () => {
    expect(
      decideRemote({ ...base, baseline: "S", localPrint: "S", cloudPrint: "S", cloudMoved: false })
    ).toBe("noop");
  });

  it("only records the clock when the cloud moved without changing the body (a rename)", () => {
    expect(
      decideRemote({ ...base, baseline: "S", localPrint: "S", cloudPrint: "S", cloudMoved: true })
    ).toBe("advance");
  });

  it("adopts a baseline the first time both sides match", () => {
    expect(
      decideRemote({ ...base, baseline: null, localPrint: "S", cloudPrint: "S", cloudMoved: false })
    ).toBe("advance");
  });

  it("pulls an outside edit into an unchanged open document", () => {
    expect(decideRemote({ ...base, baseline: "L" })).toBe("pull");
  });

  it("pulls even when the dirty flag is set, if the body did not really change", () => {
    // The bug this module exists for: a no-op editor update flagged the doc dirty
    // and the stale copy was pushed over newer cloud work.
    expect(decideRemote({ ...base, baseline: "L", legacyDirty: true })).toBe("pull");
  });

  it("pushes a real local edit when the cloud body is unchanged", () => {
    expect(decideRemote({ ...base, baseline: "C", cloudMoved: false })).toBe("push");
  });

  it("pushes a real local edit when the cloud only moved for a rename", () => {
    expect(decideRemote({ ...base, baseline: "C", cloudMoved: true })).toBe("push");
  });

  it("calls a conflict when both sides really changed", () => {
    expect(decideRemote({ ...base, baseline: "S" })).toBe("conflict");
  });

  it("never lets a blank page beat words, whichever side is blank", () => {
    expect(
      decideRemote({ ...base, baseline: "S", localBlank: true, legacyDirty: true })
    ).toBe("pull");
    expect(decideRemote({ ...base, baseline: null, localBlank: true, legacyDirty: true })).toBe(
      "pull"
    );
    expect(decideRemote({ ...base, baseline: "L", cloudBlank: true })).toBe("push");
  });

  describe("with no baseline yet (first open after the upgrade)", () => {
    it("keeps the old rule: a dirty document pushes", () => {
      expect(decideRemote({ ...base, legacyDirty: true, legacyCloudNewer: true })).toBe("push");
    });
    it("keeps the old rule: a clean document pulls a newer cloud copy", () => {
      expect(decideRemote({ ...base, legacyCloudNewer: true })).toBe("pull");
    });
    it("keeps the old rule: a clean document ignores an older cloud copy", () => {
      expect(decideRemote({ ...base, legacyCloudNewer: false })).toBe("noop");
    });
  });
});
