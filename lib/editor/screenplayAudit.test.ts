import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { buildExtensions } from "./buildExtensions";
import { autocompleteKey } from "./autocomplete";
import { occurrences } from "./breakdown";
import { findMatches, findPluginKey, replaceAll, setFindQuery } from "./findPlugin";
import { buildOutline, EMPTY_OUTLINE } from "./outline";
import { buildReport } from "./report";
import { previewRename, renameCharacterEverywhere } from "./renameCharacter";
import { previewRenameLocation, renameLocationEverywhere } from "./renameLocation";
import { docToLines } from "@/lib/export/flatten";
import { paginate } from "@/lib/export/paginate";
import { computeContinuations } from "./contd";
import { docOf, line, linesOf, makeEditor, setCaretAtLineEnd, typeText } from "./testKit";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("revision tracking boundaries", () => {
  it("marks an ordinary edit in a one-line screenplay", () => {
    const ed = (editor = new Editor({
      element: document.createElement("div"),
      extensions: buildExtensions({ isRevisionEnabled: () => true }),
      content: docOf(line("action", "")),
    }));
    ed.commands.setTextSelection(1);
    typeText(ed, "A");
    expect(ed.state.doc.child(0).attrs.revised).toBe(true);
  });

  it("marks typed slug text even when AutoElement appends a format transaction", () => {
    const ed = (editor = new Editor({
      element: document.createElement("div"),
      extensions: buildExtensions({ isRevisionEnabled: () => true }),
      content: docOf(line("action", "")),
    }));
    ed.commands.setTextSelection(1);
    typeText(ed, "INT. ");
    expect(ed.state.doc.child(0).attrs.element).toBe("scene_heading");
    expect(ed.state.doc.child(0).attrs.revised).toBe(true);
  });

  it("does not mark a programmatic setContent pull", () => {
    const ed = (editor = new Editor({
      element: document.createElement("div"),
      extensions: buildExtensions({ isRevisionEnabled: () => true }),
      content: docOf(line("action", "Old")),
    }));
    ed.commands.setContent(docOf(line("action", "Cloud")), { emitUpdate: false });
    expect(ed.state.doc.child(0).attrs.revised).toBe(false);
  });

  it("keeps marks from the enabled pass without marking later disabled edits", () => {
    let enabled = true;
    const ed = (editor = new Editor({
      element: document.createElement("div"),
      extensions: buildExtensions({ isRevisionEnabled: () => enabled }),
      content: docOf(line("action", ""), line("action", "")),
    }));
    ed.commands.setTextSelection(1);
    typeText(ed, "First");
    enabled = false;
    setCaretAtLineEnd(ed, 1);
    typeText(ed, "Second");

    const lines = docToLines(ed.getJSON());
    expect(lines.map((item) => item.revised ?? false)).toEqual([true, false]);
    const stars = paginate(lines).pages.flatMap((page) =>
      page.ops.filter((op) => op.text === "*")
    );
    expect(stars).toHaveLength(1);
  });

  it("does not create a new revision mark while undoing", () => {
    const ed = (editor = new Editor({
      element: document.createElement("div"),
      extensions: buildExtensions({ isRevisionEnabled: () => true }),
      content: docOf(line("action", "A")),
    }));
    setCaretAtLineEnd(ed, 0);
    typeText(ed, "B");
    expect(ed.commands.clearRevisions()).toBe(true);
    expect(ed.commands.undo()).toBe(true);
    expect(ed.state.doc.child(0).attrs.revised).toBe(false);
  });
});

describe("dual-dialogue cluster boundaries", () => {
  it("refuses to make a third consecutive speaker another right column", () => {
    const ed = (editor = makeEditor(
      docOf(
        line("character", "AVA"),
        line("dialogue", "Left."),
        line("character", "BEN", { dual: true }),
        line("dialogue", "Right.", { dual: true }),
        line("character", "CAL"),
        line("dialogue", "Third.")
      )
    ));
    setCaretAtLineEnd(ed, 4);
    expect(ed.commands.toggleDual()).toBe(false);
    expect(linesOf(ed)[4].dual).toBe(false);
    expect(linesOf(ed)[5].dual).toBe(false);
  });

  it("clears an orphaned right column after its left cluster is deleted", () => {
    const original = docOf(
      line("character", "AVA"),
      line("dialogue", "Left."),
      line("character", "BEN", { dual: true }),
      line("dialogue", "Right.", { dual: true }),
      line("action", "After.")
    );
    const ed = (editor = makeEditor(original));
    const cutTo = ed.state.doc.child(0).nodeSize + ed.state.doc.child(1).nodeSize;
    ed.view.dispatch(ed.state.tr.delete(0, cutTo));
    expect(linesOf(ed).slice(0, 2).map((item) => item.dual)).toEqual([false, false]);
    expect(ed.commands.undo()).toBe(true);
    expect(linesOf(ed).slice(2, 4).map((item) => item.dual)).toEqual([true, true]);
  });
});

describe("find and replace at feature-script scale", () => {
  it("treats regex-looking queries literally across every element", () => {
    const elements = [
      "scene_heading",
      "action",
      "character",
      "parenthetical",
      "dialogue",
      "transition",
    ] as const;
    const ed = (editor = makeEditor(
      docOf(...elements.map((element) => line(element, "a+b[1]")))
    ));
    const originalTexts = linesOf(ed).map((item) => item.text);
    setFindQuery(ed.view, { query: "a+b[1]" });
    expect(findPluginKey.getState(ed.state)?.matches).toHaveLength(6);
    expect(replaceAll(ed.view, "literal")).toBe(6);
    expect(ed.commands.undo()).toBe(true);
    expect(linesOf(ed).map((item) => item.text)).toEqual(originalTexts);
  });

  it("uses Unicode letters for whole-word boundaries", () => {
    const ed = (editor = makeEditor(docOf(line("action", "αβ α"))));
    expect(
      findMatches(ed.state.doc, "α", { caseSensitive: true, wholeWord: true })
    ).toHaveLength(1);
  });

  it("finds matches after the first 5,000", () => {
    const text = Array.from({ length: 6001 }, () => "x").join(" ");
    const ed = (editor = makeEditor(docOf(line("action", text))));
    expect(
      findMatches(ed.state.doc, "x", { caseSensitive: false }).length
    ).toBe(6001);
  });

  it("replaces a long-script query in one undo step", () => {
    const text = Array.from({ length: 120 }, () => "x").join(" ");
    const ed = (editor = makeEditor(docOf(line("action", text))));
    setFindQuery(ed.view, { query: "x" });
    ed.view.dispatch(closeHistory(ed.state.tr));
    expect(replaceAll(ed.view, "y")).toBe(120);
    expect(ed.getText().split(" ").at(-1)).toBe("y");
    expect(ed.commands.undo()).toBe(true);
    expect(ed.getText()).toBe(text);
  });
});

describe("global screenplay renames", () => {
  it("renames exact cues and mentions while preserving extensions and neighbors", () => {
    const ed = (editor = makeEditor(
      docOf(
        line("character", "AL (V.O.)"),
        line("dialogue", "AL speaks to ALICE."),
        line("action", "Al passes PAL and ALICE."),
        line("character", "ALICE"),
        line("dialogue", "No answer.")
      )
    ));
    expect(previewRename(ed.state.doc, "AL", "Jo Stone", { includeMentions: true }))
      .toEqual({ cues: 1, mentions: 2 });
    expect(
      renameCharacterEverywhere(ed.view, "AL", "Jo Stone", { includeMentions: true })
    ).toEqual({ cues: 1, mentions: 2 });
    expect(linesOf(ed).map((item) => item.text)).toEqual([
      "JO STONE (V.O.)",
      "JO STONE speaks to ALICE.",
      "Jo Stone passes PAL and ALICE.",
      "ALICE",
      "No answer.",
    ]);
    expect(ed.commands.undo()).toBe(true);
    expect(linesOf(ed)[0].text).toBe("AL (V.O.)");
  });

  it("renames only the location span and undoes in one step", () => {
    const ed = (editor = makeEditor(
      docOf(
        line("scene_heading", "INT. HOUSE - KITCHEN - DAY"),
        line("scene_heading", "EXT. HOUSEBOAT - NIGHT")
      )
    ));
    expect(previewRenameLocation(ed.state.doc, "HOUSE - KITCHEN", "HOME")).toBe(1);
    expect(renameLocationEverywhere(ed.view, "HOUSE - KITCHEN", "HOME")).toBe(1);
    expect(linesOf(ed).map((item) => item.text)).toEqual([
      "INT. HOME - DAY",
      "EXT. HOUSEBOAT - NIGHT",
    ]);
    expect(ed.commands.undo()).toBe(true);
    expect(linesOf(ed)[0].text).toBe("INT. HOUSE - KITCHEN - DAY");
  });
});

describe("outline learning", () => {
  it("offers sub-locations learned before the parent appeared by itself", () => {
    const source = makeEditor(
      docOf(line("scene_heading", "INT. HOUSE - KITCHEN - DAY"))
    );
    const outline = buildOutline(source.state.doc);
    source.destroy();
    const ed = (editor = makeEditor(
      docOf(line("scene_heading", "INT. HOUSE - K")),
      outline
    ));
    setCaretAtLineEnd(ed, 0);
    typeText(ed, "I");
    expect(autocompleteKey.getState(ed.state)?.items.map((item) => item.text))
      .toContain("KITCHEN");
  });
});

describe("Unicode-aware production boundaries", () => {
  it("does not tag café inside caféine", () => {
    expect(occurrences("caféine", "café")).toEqual([]);
    expect(occurrences("un café froid", "café")).toEqual([3]);
  });

  it("keeps existing highlights while rescanning only the edited line", () => {
    const items = [{ id: "prop-1", category: "props", name: "REVOLVER" }];
    const ed = (editor = new Editor({
      element: document.createElement("div"),
      extensions: buildExtensions({
        getBreakdownItems: () => items,
        isBreakdownEnabled: () => true,
      }),
      content: docOf(
        line("action", "The REVOLVER waits."),
        line("action", "Another table.")
      ),
    }));
    expect(ed.view.dom.querySelectorAll(".sp-bd")).toHaveLength(1);
    setCaretAtLineEnd(ed, 1);
    typeText(ed, " A revolver appears.");
    expect(ed.view.dom.querySelectorAll(".sp-bd")).toHaveLength(2);
  });
});

describe("report semantics", () => {
  it("does not count a cue with no dialogue as a speaking character", () => {
    const outline = {
      ...EMPTY_OUTLINE,
      cast: [
        { name: "SILENT", pos: 1, lines: 0, scenes: 1 },
        { name: "SPEAKER", pos: 3, lines: 2, scenes: 1 },
      ],
    };
    const report = buildReport(outline, 1, 2);
    expect(report.stats.speakingCharacters).toBe(1);
    expect(report.characters.map((character) => character.name)).toEqual(["SPEAKER"]);
  });
});

describe("automatic continuation semantics", () => {
  it("does not add CONT'D after a cue that never spoke", () => {
    expect(
      computeContinuations([
        { element: "character", text: "ANNA" },
        { element: "action", text: "She waits." },
        { element: "character", text: "ANNA" },
      ])
    ).toEqual([false, false, false]);
  });

  it("does add CONT'D after dialogue interrupted by action", () => {
    expect(
      computeContinuations([
        { element: "character", text: "ANNA" },
        { element: "dialogue", text: "Wait." },
        { element: "action", text: "She listens." },
        { element: "character", text: "ANNA" },
      ])
    ).toEqual([false, false, false, true]);
  });
});
