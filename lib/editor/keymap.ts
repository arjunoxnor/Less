import { Extension, type Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import type { ResolvedPos } from "@tiptap/pm/model";
import {
  DEFAULT_ELEMENT,
  ENTER_FLOW,
  NUMBER_SHORTCUTS,
  nextElement,
  prevElement,
  type ElementType,
} from "./elements";
import {
  isEmptyParentheticalText,
  isScreenplayLineEmpty,
} from "./parenthetical";

/**
 * All the smart typing behavior lives here:
 *
 *   Enter          split the line and set the new line's type by the flow map
 *                  (e.g. Enter after a CHARACTER cue drops you into DIALOGUE)
 *   Tab            cycle the current line forward through the element types
 *   Shift+Tab      cycle backward
 *   Mod+1..6       jump the current line(s) straight to a specific element
 *                  (1 scene, 2 action, 3 character, 4 dialogue,
 *                   5 parenthetical, 6 transition)
 *
 * "Mod" is ProseMirror's platform key: Cmd on macOS, Ctrl on Windows/Linux.
 * That single token is how we satisfy the cross-platform shortcut requirement.
 */

/** Find the screenplayLine node that contains a resolved position. */
export function lineAt($pos: ResolvedPos) {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === "screenplayLine") {
      return { node, pos: $pos.before(depth), depth };
    }
  }
  return null;
}

/** The element type of the line the cursor is currently in. */
export function currentElementType(state: EditorState): ElementType {
  const line = lineAt(state.selection.$from);
  return (line?.node.attrs.element as ElementType) ?? DEFAULT_ELEMENT;
}

/**
 * The Enter behavior. On a line with text: split it and set the new line's
 * element by the flow map (e.g. CHARACTER -> DIALOGUE). On an EMPTY line
 * (except action): do not split; retype the line in place to the next element,
 * so the natural double-Enter way of exiting a speech never deposits empty
 * dialogue lines in the document. Empty ACTION lines still split, because a
 * blank action line is a legitimate spacing idiom in prose-heavy pages.
 */
export function runEnterFlow(editor: Editor): boolean {
  const fromType = currentElementType(editor.state);
  const nextType = ENTER_FLOW[fromType];

  // Empty-line conversion (in place, one normal undoable step, caret stays).
  // Only for a caret: a range selection must fall through to the split path,
  // which deletes the selected content first (the universal Enter contract).
  const emptyLine = lineAt(editor.state.selection.$from);
  if (
    editor.state.selection.empty &&
    emptyLine &&
    fromType !== "action" &&
    isScreenplayLineEmpty(fromType, emptyLine.node.textContent)
  ) {
    // An abandoned empty cue means "never mind the speech", so it becomes
    // action rather than the dialogue the flow map would give. Every other
    // element follows the flow map (dialogue -> action, parenthetical ->
    // dialogue, scene_heading -> action, transition -> scene_heading).
    const target = fromType === "character" ? "action" : nextType;
    return editor.commands.command(({ tr, dispatch }) => {
      const a = emptyLine.node.attrs;
      // Leaving the dialogue cluster drops the dual flag (same rule as
      // setElement); the line's note stays, it is still the same line.
      const keepDual =
        !!a.dual &&
        (target === "dialogue" || target === "parenthetical" || target === "character");
      if (dispatch) {
        if (isEmptyParentheticalText(emptyLine.node.textContent)) {
          tr.delete(
            emptyLine.pos + 1,
            emptyLine.pos + 1 + emptyLine.node.content.size
          );
        }
        tr.setNodeMarkup(emptyLine.pos, undefined, {
          ...a,
          element: target,
          dual: keepDual,
        });
      }
      return true;
    });
  }

  return editor
    .chain()
    .splitBlock()
    .command(({ tr, dispatch }) => {
      // After splitBlock the cursor sits in the freshly created line, which
      // inherited the previous line's attrs. Normalize it: set the flow element,
      // never carry a per-line script note onto the new line (that produced
      // phantom gutter notes), and keep the dual (side-by-side) flag only while
      // staying inside a dialogue cluster (otherwise it mis-indented the line).
      const line = lineAt(tr.selection.$from);
      if (!line || !dispatch) return true;
      const a = line.node.attrs;
      const keepDual =
        !!a.dual && (nextType === "dialogue" || nextType === "parenthetical");
      const needsFix =
        a.element !== nextType || a.dual !== keepDual || !!a.note;
      if (needsFix) {
        tr.setNodeMarkup(line.pos, undefined, {
          ...a,
          element: nextType,
          dual: keepDual,
          note: "",
        });
      }
      return true;
    })
    .run();
}

export const ScreenplayKeymap = Extension.create({
  name: "screenplayKeymap",

  addKeyboardShortcuts() {
    const editor = this.editor;

    /** Retype the current line and move on without splitting. */
    const setCurrent = (type: ElementType) =>
      editor.commands.setElement(type);

    return {
      Enter: () => runEnterFlow(editor),

      Tab: () => {
        const type = currentElementType(editor.state);
        return setCurrent(nextElement(type));
      },

      "Shift-Tab": () => {
        const type = currentElementType(editor.state);
        return setCurrent(prevElement(type));
      },

      // Mod+D toggles dual (side-by-side) dialogue on the current cue cluster.
      "Mod-d": () => editor.commands.toggleDual(),

      // Mod+1 through Mod+6 select an element directly.
      "Mod-1": () => setCurrent(NUMBER_SHORTCUTS["1"]),
      "Mod-2": () => setCurrent(NUMBER_SHORTCUTS["2"]),
      "Mod-3": () => setCurrent(NUMBER_SHORTCUTS["3"]),
      "Mod-4": () => setCurrent(NUMBER_SHORTCUTS["4"]),
      "Mod-5": () => setCurrent(NUMBER_SHORTCUTS["5"]),
      "Mod-6": () => setCurrent(NUMBER_SHORTCUTS["6"]),
    };
  },
});
