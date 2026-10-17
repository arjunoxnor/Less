import { describe, expect, it } from "vitest";
import { digestOf, readDigest } from "./digest";
import { kindFromWords, kindOf } from "./kinds";
import { groupStacks, headOf, suggestStacks, versionName, versionRoot, type Stackable } from "./stacks";

const line = (element: string, text: string) => ({
  type: "screenplayLine",
  attrs: { element },
  content: [{ type: "text", text }],
});
const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const heading = (text: string) => ({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text }] });

describe("digestOf", () => {
  it("reads a screenplay: scenes, the first scene, and the cast by frequency", () => {
    const d = digestOf({
      type: "doc",
      content: [
        line("scene_heading", "int. diner - night"),
        line("action", "Rain on the window."),
        line("character", "MAYA"),
        line("dialogue", "Refill?"),
        line("character", "JOHN (V.O.)"),
        line("dialogue", "Always."),
        line("character", "MAYA (CONT'D)"),
        line("scene_heading", "EXT. STREET - LATER"),
      ],
    });
    expect(d.scenes).toBe(2);
    expect(d.firstScene).toBe("INT. DINER - NIGHT");
    expect(d.cast).toEqual(["MAYA", "JOHN"]);
    expect(d.words).toBeGreaterThan(8);
  });

  it("finds a logline from a lead-in or a Logline heading, and keeps headings as beats", () => {
    const lead = digestOf({ type: "doc", content: [para("Logline: A runner carries one message."), para("Then more.")] });
    expect(lead.logline).toBe("A runner carries one message.");
    expect(lead.lines).toEqual(["Then more."]);

    const under = digestOf({
      type: "doc",
      content: [heading("Logline"), para("Two rivals share a cab."), heading("Act one"), heading("Midpoint")],
    });
    expect(under.logline).toBe("Two rivals share a cab.");
    expect(under.headings).toEqual(["Act one", "Midpoint"]);
  });

  it("keeps only safe image sources and real hex swatches from a board", () => {
    const d = digestOf({
      type: "doc",
      content: [
        { type: "figure", attrs: { src: "/api/assets/" + "a".repeat(32) } },
        { type: "figure", attrs: { src: "javascript:alert(1)" } },
        { type: "figure", attrs: { src: "https://example.com/x.jpg" } },
        { type: "palette", attrs: { colors: [{ hex: "#FF0000" }, { hex: "red" }, { hex: "#00ff00" }] } },
      ],
    });
    expect(d.images).toEqual(["/api/assets/" + "a".repeat(32), "https://example.com/x.jpg"]);
    expect(d.swatches).toEqual(["#ff0000", "#00ff00"]);
  });

  it("records the first voice note, and caps everything it keeps", () => {
    const d = digestOf({
      type: "doc",
      content: [
        { type: "voiceNote", attrs: { duration: 134000, peaks: "09az" }, content: [{ type: "text", text: "Ending idea." }] },
        para("x".repeat(500)),
      ],
    });
    expect(d.voice).toEqual({ ms: 134000, peaks: "09az", transcribed: true });
    expect(d.lines?.[0]).toBe("Ending idea.");
    expect(d.lines?.[1].length).toBeLessThanOrEqual(160);
    expect(JSON.stringify(d).length).toBeLessThan(2000);
  });

  it("survives garbage and round-trips through readDigest without trusting it", () => {
    expect(digestOf(null).words).toBe(0);
    expect(digestOf({ content: "nope" }).words).toBe(0);
    const d = digestOf({ type: "doc", content: [heading("Beat one"), para("Hello world")] });
    expect(readDigest(JSON.stringify(d))).toEqual(d);
    expect(readDigest('{"v":2}')).toBeNull();
    expect(readDigest({ v: 1, words: 3, images: ["javascript:x", "/api/assets/" + "b".repeat(32)] })?.images).toEqual([
      "/api/assets/" + "b".repeat(32),
    ]);
  });
});

describe("kinds", () => {
  it("reads prose kinds from words in a title", () => {
    expect(kindFromWords("Gods One Pager v2")).toBe("onepager");
    expect(kindFromWords("Pilot treatment")).toBe("treatment");
    expect(kindFromWords("Beat sheet")).toBe("outline");
    expect(kindFromWords("Character bios")).toBe("characters");
    expect(kindFromWords("Pitchfork review")).toBeNull();
    expect(kindFromWords("Broadcast")).toBeNull();
  });

  it("prefers the storage type, then the writer's choice, then the title, then the folder", () => {
    expect(kindOf("screenplay", "Notes", "treatment")).toBe("script");
    expect(kindOf("board", "Treatment")).toBe("board");
    expect(kindOf("plain", "One pager", "treatment")).toBe("treatment");
    expect(kindOf("plain", "Untitled", undefined, ["One Pagers", "Gods"])).toBe("onepager");
    expect(kindOf("plain", "Untitled", "not-a-kind")).toBe("document");
  });
});

const doc = (id: string, over: Partial<Stackable> = {}): Stackable => ({
  id,
  title: id,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  ...over,
});

describe("stacks", () => {
  it("groups by stack, keeping each stack where its first member sits", () => {
    const items = [
      doc("a"),
      doc("b", { stackId: "s", updatedAt: "2026-10-03T00:00:00Z" }),
      doc("c"),
      doc("d", { stackId: "s", stackTop: "2026-10-05T00:00:00Z", createdAt: "2026-10-02T00:00:00Z" }),
    ];
    const groups = groupStacks(items);
    expect(groups.map((g) => g.key)).toEqual(["d:a", "s:s", "d:c"]);
    expect(groups[1].head.id).toBe("d"); // made current most recently
    expect(groups[1].members.map((m) => m.id)).toEqual(["d", "b"]);
  });

  it("falls back to the most recently edited version when none was made current", () => {
    expect(
      headOf([doc("x", { updatedAt: "2026-10-01T00:00:00Z" }), doc("y", { updatedAt: "2026-10-09T00:00:00Z" })]).id
    ).toBe("y");
  });

  it("strips version markers but keeps real numbers", () => {
    expect(versionRoot("Pitch One-Pager, Oct 17")).toBe("pitch one pager");
    expect(versionRoot("Pitch one pager v3")).toBe("pitch one pager");
    expect(versionRoot("Pitch One-Pager (copy 2)")).toBe("pitch one pager");
    expect(versionRoot("Final draft of Pitch one pager")).toBe("of pitch one pager");
    expect(versionRoot("Gods of Our Ancestors - Draft 3")).toBe("gods of our ancestors");
    expect(versionRoot("Episode 1")).not.toBe(versionRoot("Episode 2"));
  });

  it("suggests stacking same-kind versions that are not already one stack", () => {
    const items = [
      doc("p1", { title: "Pitch one pager", updatedAt: "2026-10-09T00:00:00Z" }),
      doc("p2", { title: "Pitch one pager v2" }),
      doc("t1", { title: "Pitch one pager" }), // same words, different kind below
      doc("e1", { title: "Episode 1" }),
      doc("e2", { title: "Episode 2" }),
    ];
    const kind = (d: Stackable) => (d.id === "t1" ? "treatment" : "onepager");
    const out = suggestStacks(items, kind);
    expect(out).toHaveLength(1);
    expect(out[0].ids).toEqual(["p1", "p2"]);
    // Already stacked together: nothing to suggest.
    expect(
      suggestStacks([doc("a", { title: "X draft", stackId: "s" }), doc("b", { title: "X", stackId: "s" })], () => "k")
    ).toEqual([]);
  });
});

describe("versionName", () => {
  it("names a set of versions the way the writer spells it", () => {
    expect(versionName("Gods one-pager v3")).toBe("Gods one-pager");
    expect(versionName("Pitch, Oct 17")).toBe("Pitch");
    expect(versionName("Final draft of The Lighthouse (copy 2)")).toBe("The Lighthouse");
    expect(versionName("Episode 2")).toBe("Episode 2");
    expect(versionName("v2")).toBe("v2");
  });

  it("never suggests stacking untitled pages", () => {
    const blank = (id: string) => ({ id, title: "Untitled screenplay", createdAt: "a", updatedAt: "a" });
    expect(suggestStacks([blank("a"), blank("b")], () => "script")).toEqual([]);
  });
});
