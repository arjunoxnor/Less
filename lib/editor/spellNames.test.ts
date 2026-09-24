import { Editor } from "@tiptap/core";
import nspell from "nspell";
import english from "dictionary-en";
import { describe, expect, it } from "vitest";

import { buildExtensions } from "./buildExtensions";
import { buildOutline, EMPTY_OUTLINE } from "./outline";
import { refreshSpellingNames, spellKey } from "./spellcheck";
import { docOf, line } from "./testKit";
import type { Outline } from "@/types/screenplay";

/**
 * Character and location names never flag. The names come from the outline,
 * which the editor screen works out a render after the editor exists. With
 * the dictionary already loaded (any script opened after the first), the
 * checker's first scan ran before that, without a single name, and every
 * character's name wore a red underline until the writer typed something.
 */

const speller = nspell(english);

function openScript(getOutline: () => Outline) {
  return new Editor({
    element: document.createElement("div"),
    extensions: buildExtensions({
      getOutline,
      getSpeller: () => Promise.resolve(speller),
      isSpellEnabled: () => true,
    }),
    content: docOf(
      line("character", "NIKHIL"),
      line("dialogue", "Where were you?"),
      line("action", "Nikhil waits by the door.")
    ),
  });
}

function flagged(editor: Editor): string[] {
  return (spellKey.getState(editor.state)?.deco.find() ?? []).map((d) =>
    editor.state.doc.textBetween(d.from, d.to)
  );
}

describe("spelling and the cast", () => {
  it("clears a name's underline when the cast arrives after the first scan", async () => {
    let outline: Outline = EMPTY_OUTLINE;
    const editor = openScript(() => outline);
    // The dictionary is already loaded: the first scan runs at once.
    await Promise.resolve();
    await Promise.resolve();
    expect(flagged(editor)).toContain("Nikhil");

    outline = buildOutline(editor.state.doc);
    refreshSpellingNames(editor.view);
    expect(flagged(editor)).not.toContain("Nikhil");
    editor.destroy();
  });

  it("knows a name in the possessive", async () => {
    let outline: Outline = EMPTY_OUTLINE;
    const editor = openScript(() => outline);
    await Promise.resolve();
    await Promise.resolve();
    const end = editor.state.doc.content.size - 1;
    editor.view.dispatch(editor.state.tr.insertText(" Nikhil's hands shake.", end));
    outline = buildOutline(editor.state.doc);
    refreshSpellingNames(editor.view);
    expect(flagged(editor)).toEqual([]);
    editor.destroy();
  });

  it("leaves a line being typed alone when no name came or went", async () => {
    let outline: Outline = EMPTY_OUTLINE;
    const editor = openScript(() => outline);
    await Promise.resolve();
    await Promise.resolve();
    outline = buildOutline(editor.state.doc);
    refreshSpellingNames(editor.view);
    expect(flagged(editor)).toEqual([]);

    // Half a word, mid-typing, and a fresh outline with the same cast (the
    // screen re-derives it after every edit): the word is checked after the
    // pause, not now.
    const end = editor.state.doc.content.size - 1;
    editor.view.dispatch(editor.state.tr.insertText(" Somethin", end));
    outline = buildOutline(editor.state.doc);
    refreshSpellingNames(editor.view);
    expect(flagged(editor)).toEqual([]);
    editor.destroy();
  });
});
