// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import type { Editor } from "@tiptap/core";
import type { ScriptLine } from "@/types/screenplay";
import { docToLines, linesToDoc } from "./flatten";
import { parseFdx, toFdx } from "./fdx";
import { toFountain } from "./fountain";
import { paginate } from "./paginate";
import { exportPdf } from "./pdf";
import { LAYOUT } from "./layout";
import { docOf, line, makeEditor, setCaretAtLineEnd } from "@/lib/editor/testKit";
import { revisionLabel, revisionMark } from "@/lib/editor/revisionColors";
import { setSmartCapsEnabled } from "@/lib/editor/smartCaps";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
  setSmartCapsEnabled(true);
});

const extras: ScriptLine[] = [
  { element: "new_act", text: "ACT ONE" },
  { element: "shot", text: "CLOSE ON THE DOOR" },
  { element: "general", text: "A title card." },
  { element: "character", text: "ANNA" },
  { element: "lyrics", text: "Over the hills we go" },
  { element: "end_of_act", text: "END OF ACT ONE" },
];

describe("the other line types", () => {
  it("carry capitals and survive the editor bridge and Final Draft", () => {
    const lines = docToLines(docOf(line("shot", "close on the door"), line("general", "A title card.")));
    expect(lines[0].text).toBe("CLOSE ON THE DOOR");
    expect(lines[1].text).toBe("A title card.");
    expect(docToLines(linesToDoc(extras))).toEqual(extras);
    expect(parseFdx(toFdx(extras)).lines).toEqual(extras);
    expect(toFdx(extras)).toContain('<Paragraph Type="New Act">');
  });

  it("print where they belong: acts centred, lyrics in italics at the dialogue column", () => {
    const { pages } = paginate(extras);
    const op = (t: string) => pages[0].ops.find((o) => o.text === t)!;
    const act = op("ACT ONE");
    expect(act.x).toBeCloseTo(LAYOUT.action.x + ((60 - 7) * 7.2) / 2);
    expect(op("Over the hills we go")).toMatchObject({ x: LAYOUT.dialogue.x, italic: true });
    expect(op("CLOSE ON THE DOOR").x).toBe(LAYOUT.action.x);
  });

  it("write Fountain's centred text and lyric marker", () => {
    const out = toFountain(extras);
    expect(out).toContain("> ACT ONE <");
    expect(out).toContain("~Over the hills we go");
  });

  it("flow on Enter and stay out of the Tab cycle", async () => {
    const { ELEMENT_CYCLE, ENTER_FLOW } = await import("@/lib/editor/elements");
    expect(ELEMENT_CYCLE).toHaveLength(6);
    expect(ENTER_FLOW.shot).toBe("action");
    expect(ENTER_FLOW.lyrics).toBe("lyrics");
    expect(ENTER_FLOW.new_act).toBe("scene_heading");
  });
});

describe("revision passes", () => {
  it("names the first pass true, and the header reads the latest on the page", () => {
    expect(revisionMark(undefined)).toBe(true);
    expect(revisionMark("white")).toBe(true);
    expect(revisionMark("pink")).toBe("pink");
    expect(revisionMark("mauve")).toBe(true);
    expect(revisionLabel([])).toBeNull();
    expect(revisionLabel(["blue", "pink", "blue"], "pink", "10/31/26")).toBe("Pink Rev. 10/31/26");
    expect(revisionLabel(["blue"], "pink", "10/31/26")).toBe("Blue Rev.");
  });

  it("a line carries its pass through export, and the star knows it", async () => {
    const lines: ScriptLine[] = docToLines(
      docOf(line("action", "Old."), line("action", "New.", { revised: "blue" }), line("action", "First.", { revised: true }))
    );
    expect(lines[1]).toMatchObject({ revised: true, revisedColor: "blue" });
    expect(lines[2]).toEqual({ element: "action", text: "First.", revised: true });
    const stars = paginate(lines).pages[0].ops.filter((o) => o.text === "*");
    expect(stars.map((s) => s.rev)).toEqual(["blue", undefined]);
    expect((await exportPdf(lines, null, { revisionColor: "blue", revisionDate: "10/31/26" })).length).toBeGreaterThan(500);
  });

  it("the tracker marks an edit with the current pass, and re-marks an older one", async () => {
    const { Editor: E } = await import("@tiptap/core");
    const { buildExtensions } = await import("@/lib/editor/buildExtensions");
    let pass: true | string = "blue";
    editor = new E({
      element: document.createElement("div"),
      extensions: buildExtensions({ isRevisionEnabled: () => true, revisionColor: () => pass }),
      content: docOf(line("action", "One."), line("action", "Two.", { revised: true })),
    });
    setCaretAtLineEnd(editor, 0);
    editor.commands.insertContent("x");
    expect(editor.state.doc.child(0).attrs.revised).toBe("blue");
    expect(editor.state.doc.child(1).attrs.revised).toBe(true);
    pass = "pink";
    setCaretAtLineEnd(editor, 0);
    editor.commands.insertContent("y");
    expect(editor.state.doc.child(0).attrs.revised).toBe("pink");
  });
});

describe("smart capitals", () => {
  it("can be switched off", () => {
    const ed = (editor = makeEditor(docOf(line("action", ""))));
    const type = (ch: string) =>
      ed.view.someProp("handleTextInput", (f) =>
        f(ed.view, ed.state.selection.from, ed.state.selection.to, ch, () => ed.state.tr.insertText(ch))
      ) ||
      ed.commands.insertContent(ch);
    setCaretAtLineEnd(ed, 0);
    type("a");
    expect(ed.state.doc.child(0).textContent).toBe("A");
    setSmartCapsEnabled(false);
    ed.commands.setContent(docOf(line("action", "")));
    setCaretAtLineEnd(ed, 0);
    type("a");
    expect(ed.state.doc.child(0).textContent).toBe("a");
  });
});
