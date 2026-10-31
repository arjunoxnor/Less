import { Extension } from "@tiptap/core";

/**
 * Line spacing on paragraphs and headings. Null is the document's own rhythm
 * (the page's 1.7); the others are line heights a writer knows by name. It is
 * drawn with CSS, so the pages measure it like anything else.
 */
export const LINE_SPACINGS: { label: string; value: number | null }[] = [
  { label: "Default", value: null },
  { label: "Single", value: 1.2 },
  { label: "1.15", value: 1.38 },
  { label: "1.5", value: 1.8 },
  { label: "Double", value: 2.4 },
];

const known = (v: unknown) => (typeof v === "number" && LINE_SPACINGS.some((s) => s.value === v) ? v : null);

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    lineSpacing: {
      /** Set the spacing on every paragraph and heading the selection touches. */
      setLineSpacing: (value: number | null) => ReturnType;
    };
  }
}

const TYPES = ["paragraph", "heading"];

export const LineSpacing = Extension.create({
  name: "lineSpacing",
  addGlobalAttributes() {
    return [
      {
        types: TYPES,
        attributes: {
          lineSpacing: {
            default: null,
            parseHTML: (el: HTMLElement) => known(Number(el.getAttribute("data-line-spacing"))),
            renderHTML: (attrs: Record<string, unknown>) => {
              const v = known(attrs.lineSpacing);
              return v ? { "data-line-spacing": String(v), style: `line-height: ${v}` } : {};
            },
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setLineSpacing:
        (value) =>
        ({ state, tr, dispatch }) => {
          const { from, to } = state.selection;
          let changed = false;
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (!TYPES.includes(node.type.name)) return true;
            if (node.attrs.lineSpacing !== value) {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, lineSpacing: value });
              changed = true;
            }
            return false;
          });
          if (changed && dispatch) dispatch(tr);
          return changed;
        },
    };
  },
});

/** The spacing of the line the caret is on. */
export function lineSpacingAt(state: import("@tiptap/pm/state").EditorState): number | null {
  return known(state.selection.$from.parent.attrs.lineSpacing);
}
