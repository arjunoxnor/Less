import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { closeHistory, undo } from "@tiptap/pm/history";
import { replaceDocInPlace } from "./replaceDoc";
import { Editor as TipTap } from "@tiptap/core";
import { buildExtensions } from "./buildExtensions";
import { docOf, line, lineStartPos, linesOf, makeEditor, typeText } from "./testKit";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

const three = () => docOf(line("action", "First line"), line("action", "Second line"), line("action", "Third line"));

describe("what a line change reaches", () => {
  it("leaves the next line alone when the selection ends at its very start", () => {
    const ed = (editor = makeEditor(three()));
    // Shift+Down from the start of line one: the selection ends where line two starts.
    ed.commands.setTextSelection({ from: 1, to: lineStartPos(ed, 1) + 1 });
    ed.commands.setElement("character");
    expect(linesOf(ed).map((l) => l.element)).toEqual(["character", "action", "action"]);
  });

  it("does nothing on Tab with several lines selected, instead of retyping them all", () => {
    const ed = (editor = makeEditor(three()));
    ed.commands.setTextSelection({ from: 1, to: lineStartPos(ed, 2) + 3 });
    expect(ed.commands.keyboardShortcut("Tab")).toBe(true);
    expect(linesOf(ed).map((l) => l.element)).toEqual(["action", "action", "action"]);
  });

  it("still cycles one line on Tab", () => {
    const ed = (editor = makeEditor(three()));
    ed.commands.setTextSelection(3);
    ed.commands.keyboardShortcut("Tab");
    expect(linesOf(ed)[0].element).not.toBe("action");
  });
});

describe("undo after a restore", () => {
  it("puts back the text that was there before the restored version", () => {
    const ed = (editor = makeEditor(three()));
    replaceDocInPlace(ed, docOf(line("action", "Restored only")), { undoable: true });
    expect(linesOf(ed).map((l) => l.text)).toEqual(["Restored only"]);
    undo(ed.state, ed.view.dispatch);
    expect(linesOf(ed).map((l) => l.text)).toEqual(["First line", "Second line", "Third line"]);
  });

  it("never offers to undo a copy that arrived from another device", () => {
    const ed = (editor = makeEditor(three()));
    replaceDocInPlace(ed, docOf(line("action", "From the laptop")));
    expect(undo(ed.state)).toBe(false);
  });
});

describe("revision stars and undo", () => {
  it("takes the star away with the edit that made it, and Clear can be undone", () => {
    const ed = (editor = new TipTap({
      element: document.createElement("div"),
      extensions: buildExtensions({ isRevisionEnabled: () => true }),
      content: docOf(line("action", "Plain")),
    }));
    ed.commands.setTextSelection(6);
    typeText(ed, "!");
    expect(ed.state.doc.child(0).attrs.revised).toBe(true);
    undo(ed.state, ed.view.dispatch);
    expect(ed.state.doc.child(0).textContent).toBe("Plain");
    expect(ed.state.doc.child(0).attrs.revised).toBe(false);
    typeText(ed, "?");
    ed.view.dispatch(closeHistory(ed.state.tr));
    ed.commands.clearRevisions();
    expect(ed.state.doc.child(0).attrs.revised).toBe(false);
    undo(ed.state, ed.view.dispatch);
    expect(ed.state.doc.child(0).attrs.revised).toBe(true);
  });
});

describe("pasting a scene", () => {
  it("lands headings, cues and dialogue as themselves, not all Action", () => {
    const ed = (editor = makeEditor(docOf(line("action", ""))));
    ed.commands.setTextSelection(1);
    const text = "INT. KITCHEN - NIGHT\n\nMara stirs the pot.\n\nMARA\n(quietly)\nIt's ready.\n\nCUT TO:\n";
    const data = { getData: (type: string) => (type === "text/plain" ? text : "") };
    const event = Object.assign(new Event("paste"), { clipboardData: data }) as unknown as ClipboardEvent;
    ed.view.someProp("handlePaste", (handler) => handler(ed.view, event, null as never));
    expect(linesOf(ed).map((l) => [l.element, l.text])).toEqual([
      ["scene_heading", "INT. KITCHEN - NIGHT"],
      ["action", "Mara stirs the pot."],
      ["character", "MARA"],
      ["parenthetical", "(quietly)"],
      ["dialogue", "It's ready."],
      ["transition", "CUT TO:"],
    ]);
  });

  it("leaves a single line or plain prose to the ordinary paste", async () => {
    const { screenplayLinesFromPaste } = await import("./screenplayPaste");
    expect(screenplayLinesFromPaste("just one line")).toBeNull();
    expect(screenplayLinesFromPaste("A paragraph of notes.\n\nAnother one.")).toBeNull();
  });
});
