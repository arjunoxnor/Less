import { Node, mergeAttributes } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
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
      /** Toggle dual (side-by-side) dialogue on the current cue cluster. */
      toggleDual: () => ReturnType;
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
      // A second attribute on the one node (the ONE-node principle holds): marks
      // the right-column cue and its parenthetical/dialogue of a dual block.
      // renderHTML emits nothing when false, so existing docs serialize
      // byte-identically and the schema change causes no sync churn.
      dual: {
        default: false,
        parseHTML: (el) => el.getAttribute("data-dual") === "true",
        renderHTML: (attrs) => (attrs.dual ? { "data-dual": "true" } : {}),
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

      toggleDual:
        () =>
        ({ state, dispatch }) => {
          // Flatten the doc's top-level lines with their positions.
          const lines: { pos: number; node: PMNode }[] = [];
          state.doc.forEach((node, offset) => lines.push({ pos: offset, node }));
          const elementOf = (i: number) => lines[i].node.attrs.element as string;
          const isCueBody = (i: number) =>
            elementOf(i) === "parenthetical" || elementOf(i) === "dialogue";

          // Which line is the cursor in?
          const caret = state.selection.from;
          let cur = -1;
          for (let i = 0; i < lines.length; i++) {
            const start = lines[i].pos;
            const end = start + lines[i].node.nodeSize;
            if (caret >= start && caret <= end) {
              cur = i;
              break;
            }
          }
          if (cur === -1) return false;

          // Walk back to the character cue that owns this cluster.
          let cueIdx = -1;
          for (let i = cur; i >= 0; i--) {
            if (elementOf(i) === "character") {
              cueIdx = i;
              break;
            }
            if (isCueBody(i)) continue;
            break; // a scene heading / action / transition: no cue here
          }
          if (cueIdx === -1) return false;

          const newDual = !lines[cueIdx].node.attrs.dual;

          // Turning dual ON needs a preceding cue as the left-column partner.
          if (newDual) {
            let hasLeft = false;
            for (let i = cueIdx - 1; i >= 0; i--) {
              if (isCueBody(i)) continue;
              hasLeft = elementOf(i) === "character";
              break;
            }
            if (!hasLeft) return false;
          }

          if (dispatch) {
            const tr = state.tr;
            const apply = (i: number) => {
              const { pos, node } = lines[i];
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, dual: newDual });
            };
            apply(cueIdx);
            for (let i = cueIdx + 1; i < lines.length && isCueBody(i); i++) apply(i);
            dispatch(tr);
          }
          return true;
        },
    };
  },
});
