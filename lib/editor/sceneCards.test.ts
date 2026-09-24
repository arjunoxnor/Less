import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";

import { buildSceneCards, formatEighths, storylinesOf } from "./sceneCards";
import { sceneCard } from "./sceneAttrs";
import { nextStorylineColor, setSceneCardTr, STORYLINE_COLORS, updateStorylineTr } from "./storylines";
import { docOf, line, lineStartPos, linesOf, makeEditor, setCaretAtLineEnd } from "./testKit";
import { buildRevisionTracker } from "./revisions";
import { runEnterFlow } from "./keymap";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function script() {
  return docOf(
    line("scene_heading", "INT. KITCHEN - DAY"),
    line("action", "Mara makes tea. The kettle screams."),
    line("character", "MARA"),
    line("dialogue", "Not now."),
    line("character", "JONAH (O.S.)"),
    line("dialogue", "Now."),
    line("scene_heading", "EXT. STREET - NIGHT"),
    line("action", "Rain.")
  );
}

describe("the structure board's cards", () => {
  it("reads one card per scene with its heading, preview, cast and length", () => {
    editor = makeEditor(script());
    const cards = buildSceneCards(editor.state.doc);
    expect(cards.map((c) => c.heading)).toEqual(["INT. KITCHEN - DAY", "EXT. STREET - NIGHT"]);
    expect(cards[0].preview).toBe("Mara makes tea. The kettle screams.");
    expect(cards[0].characters).toEqual(["MARA", "JONAH"]);
    expect(cards[0].eighths).toBeGreaterThanOrEqual(1);
    expect(cards[1].headingPos).toBe(lineStartPos(editor, 6));
  });

  it("writes a storyline and summary onto the heading, as one undoable step that is not a revision", () => {
    editor = makeEditor(script());
    const pos = lineStartPos(editor, 6);
    editor.view.dispatch(
      setSceneCardTr(editor.state, pos, { storyline: "Trip", color: "#378ADD", synopsis: "  Jonah waits.  " })!
    );
    const card = buildSceneCards(editor.state.doc)[1];
    expect(card).toMatchObject({ storyline: "Trip", color: "#378add", synopsis: "Jonah waits." });
    expect(linesOf(editor)[6].text).toBe("EXT. STREET - NIGHT");
    editor.commands.undo();
    expect(buildSceneCards(editor.state.doc)[1].storyline).toBe("");
  });

  it("does not mark a revision for a storyline change in revision mode", () => {
    editor = makeEditor(script());
    // The production list already includes the tracker, gated on a pref that
    // is off in tests; a separate always-on tracker proves the meta is honored.
    editor.registerPlugin(buildRevisionTracker(() => true).config.addProseMirrorPlugins!.call({} as never)[0]);
    editor.view.dispatch(setSceneCardTr(editor.state, 0, { storyline: "Present", color: "#3fa663" })!);
    expect(editor.state.doc.child(0).attrs.revised).toBe(false);
  });

  it("lists storylines in order of first appearance, renames and recolors them everywhere", () => {
    editor = makeEditor(script());
    editor.view.dispatch(setSceneCardTr(editor.state, 0, { storyline: "Present", color: "#378add" })!);
    editor.view.dispatch(
      setSceneCardTr(editor.state, lineStartPos(editor, 6), { storyline: "Present", color: "#378add" })!
    );
    expect(storylinesOf(buildSceneCards(editor.state.doc))).toEqual([
      { name: "Present", color: "#378add", scenes: 2 },
    ]);
    editor.view.dispatch(updateStorylineTr(editor.state, "Present", { name: "Now", color: "#e0533b" })!);
    expect(storylinesOf(buildSceneCards(editor.state.doc))).toEqual([
      { name: "Now", color: "#e0533b", scenes: 2 },
    ]);
    // One undo restores both scenes.
    editor.commands.undo();
    expect(storylinesOf(buildSceneCards(editor.state.doc))[0].name).toBe("Present");
    // An empty name takes the storyline off.
    editor.view.dispatch(updateStorylineTr(editor.state, "Present", { name: "" })!);
    expect(storylinesOf(buildSceneCards(editor.state.doc))).toEqual([]);
  });

  it("keeps a heading's card off the line typed after it", () => {
    editor = makeEditor(script());
    editor.view.dispatch(setSceneCardTr(editor.state, 0, { storyline: "Present", color: "#378add" })!);
    setCaretAtLineEnd(editor, 0);
    runEnterFlow(editor);
    expect(sceneCard(editor.state.doc.child(0).attrs.scene)?.storyline).toBe("Present");
    expect(editor.state.doc.child(1).attrs.scene).toBeNull();
  });

  it("cleans what arrives from elsewhere", () => {
    expect(sceneCard(null)).toBeNull();
    expect(sceneCard({ storyline: "  ", synopsis: "" })).toBeNull();
    expect(sceneCard({ storyline: "Trip", color: "red; background: url(x)" })).toEqual({
      storyline: "Trip",
      color: "",
      synopsis: "",
    });
    expect(sceneCard({ color: "#123456", synopsis: "A" })).toEqual({ storyline: "", color: "", synopsis: "A" });
  });

  it("gives a new storyline the first free color", () => {
    expect(nextStorylineColor([])).toBe(STORYLINE_COLORS[0]);
    expect(nextStorylineColor([STORYLINE_COLORS[0].toUpperCase()])).toBe(STORYLINE_COLORS[1]);
  });

  it("writes lengths the way a production board does", () => {
    expect(formatEighths(3)).toBe("3/8");
    expect(formatEighths(8)).toBe("1");
    expect(formatEighths(13)).toBe("1 5/8");
  });
});
