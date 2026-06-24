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
 * The Enter behavior: split the current line and set the new line's element by
 * the flow map (e.g. CHARACTER -> DIALOGUE). Exported so the autocomplete menu
 * can reuse it: accepting a character suggestion with Enter both accepts the
 * name and drops into dialogue, in a single keystroke.
 */
export function runEnterFlow(editor: Editor): boolean {
  const fromType = currentElementType(editor.state);
  const nextType = ENTER_FLOW[fromType];

  return editor
    .chain()
    .splitBlock()
    .command(({ tr, dispatch }) => {
      // After splitBlock the cursor sits in the freshly created line. Read it
      // from `tr.selection` (the chain's evolving transaction), not the stale
      // `state`, and set its element type.
      const line = lineAt(tr.selection.$from);
      if (!line) return false;
      if (line.node.attrs.element !== nextType && dispatch) {
        tr.setNodeMarkup(line.pos, undefined, {
          ...line.node.attrs,
          element: nextType,
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

      // Mod+1 through Mod+6 — direct element selection.
      "Mod-1": () => setCurrent(NUMBER_SHORTCUTS["1"]),
      "Mod-2": () => setCurrent(NUMBER_SHORTCUTS["2"]),
      "Mod-3": () => setCurrent(NUMBER_SHORTCUTS["3"]),
      "Mod-4": () => setCurrent(NUMBER_SHORTCUTS["4"]),
      "Mod-5": () => setCurrent(NUMBER_SHORTCUTS["5"]),
      "Mod-6": () => setCurrent(NUMBER_SHORTCUTS["6"]),
    };
  },
});
