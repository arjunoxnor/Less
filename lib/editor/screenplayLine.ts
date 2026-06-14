import { Node, mergeAttributes } from "@tiptap/core";
import {
  DEFAULT_ELEMENT,
  type ElementType,
} from "./elements";

/**
 * The one and only block node in our schema.
 *
 * A screenplay is `doc -> screenplayLine+`. Every line of the script is a
 * `screenplayLine` whose `element` attribute says what kind of line it is.
 * We deliberately do NOT use six separate node types: keeping one node with an
 * attribute makes switching element types a one-line attribute update and makes
 * export trivial (walk the lines, read the attribute).
 */

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    screenplayLine: {
      /** Set the element type on every line the selection touches. */
      setElement: (type: ElementType) => ReturnType;
    };
  }
}

export interface ScreenplayLineOptions {
  HTMLAttributes: Record<string, unknown>;
}

export const ScreenplayLine = Node.create<ScreenplayLineOptions>({
  name: "screenplayLine",
  group: "block",
  content: "inline*",

  // `defining` keeps the element type attached to the content when the user
  // copies/pastes or when ProseMirror has to reconstruct the node.
  defining: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      element: {
        default: DEFAULT_ELEMENT as ElementType,
        // Persisted to / read from the DOM as `data-element`.
        parseHTML: (el) =>
          (el.getAttribute("data-element") as ElementType) || DEFAULT_ELEMENT,
        renderHTML: (attrs) => ({ "data-element": attrs.element }),
      },
    };
  },

  parseHTML() {
    // Primary: our own markup. Fallback: any <p> becomes an action line, so
    // pasted plain prose lands as action rather than getting dropped.
    return [{ tag: "p[data-element]" }, { tag: "p" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const element = (node.attrs.element as ElementType) || DEFAULT_ELEMENT;
    return [
      "p",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        // The class drives all the screenplay CSS (margins, indents, casing).
        class: `sp-line sp-${element}`,
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setElement:
        (type: ElementType) =>
        ({ state, dispatch }) => {
          const { from, to } = state.selection;
          let changed = false;
          const tr = state.tr;

          // Walk every block in the selected range and retype it. This makes
          // selecting several lines and pressing Cmd+3 turn them all into
          // character cues, which is what writers expect.
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (node.type.name === this.name) {
              if (node.attrs.element !== type) {
                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  element: type,
                });
                changed = true;
              }
            }
          });

          if (changed && dispatch) dispatch(tr);
          return changed;
        },
    };
  },
});
