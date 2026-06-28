import { Extension, InputRule } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";

/**
 * Smart sentence capitalization for prose: screenplay action and dialogue, and
 * plain-document paragraphs / headings.
 *
 * AutoCaps already force-uppercases scene headings, character cues, and
 * transitions; parentheticals are lowercase by convention. This adds the
 * everyday autocorrect writers expect in prose: the first letter of a line, the
 * first letter after sentence-ending punctuation, and a standalone "i" become
 * uppercase as you type. It is implemented with input rules so it only fires on
 * the keystroke that completes the pattern (never re-rewriting text you go back
 * and edit), and every change is a normal, undoable step.
 */

// Where sentence casing applies: screenplay action/dialogue lines and plain
// paragraphs/headings. Never scene headings/cues/transitions (AutoCaps owns
// those), parentheticals (lowercase by convention), or code blocks.
function isProse(state: EditorState): boolean {
  const parent = state.selection.$from.parent;
  if (parent.type.name === "screenplayLine") {
    const el = parent.attrs.element as string | undefined;
    return el === "action" || el === "dialogue";
  }
  return parent.type.name === "paragraph" || parent.type.name === "heading";
}

export const SmartCaps = Extension.create({
  name: "screenplaySmartCaps",

  addInputRules() {
    // NOTE on positions: TipTap runs an input rule BEFORE the triggering
    // character is in the document, and `range` spans only the text already
    // present (everything in the match except the just-typed char). So we insert
    // the replacement at the cursor (range.to) rather than overwriting what is
    // there, which would eat the separating space.
    return [
      // First letter typed on an empty prose line (range is empty, at the caret).
      new InputRule({
        find: /^([a-z])$/,
        handler: ({ state, range, match }) => {
          if (!isProse(state)) return null;
          state.tr.insertText(match[1].toUpperCase(), range.from, range.to);
        },
      }),
      // First letter after sentence-ending punctuation (". ", "? ", "! ", with
      // an optional closing quote/bracket before the space). The letter is the
      // just-typed char, so insert its uppercase at the caret; the punctuation
      // and space already in the doc are left untouched.
      new InputRule({
        find: /[.!?]['")\]]*\s+([a-z])$/,
        handler: ({ state, range, match }) => {
          if (!isProse(state)) return null;
          state.tr.insertText(match[1].toUpperCase(), range.to);
        },
      }),
      // A standalone lowercase "i" (the pronoun) once a boundary follows it. The
      // boundary is the just-typed char; the "i" sits at range.to - 1. Replace it
      // with "I" and re-add the boundary the rule consumed.
      new InputRule({
        find: /(^|[^A-Za-z])i([.,!?;:'")\]\s])$/,
        handler: ({ state, range, match }) => {
          if (!isProse(state)) return null;
          state.tr.insertText("I" + match[2], range.to - 1, range.to);
        },
      }),
    ];
  },
});
