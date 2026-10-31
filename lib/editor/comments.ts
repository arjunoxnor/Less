import { Mark, mergeAttributes } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";

/**
 * Comments in a document: a note attached to a stretch of text, kept in the
 * document as a mark, so it syncs, moves with the words and undoes like any
 * other edit, and never reaches an export. A comment's words live on the mark
 * itself. A paste never brings one along (there is no parseHTML), so a copy
 * of commented text does not make a second comment.
 */

export interface DocComment {
  id: string;
  text: string;
  /** The words it is attached to. */
  quote: string;
  /** Where those words start. */
  from: number;
  to: number;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    comments: {
      /** Attach a comment to what is selected. */
      addComment: (text: string, id?: string) => ReturnType;
      /** Change a comment's words. */
      updateComment: (id: string, text: string) => ReturnType;
      /** Take a comment off; the text stays. */
      removeComment: (id: string) => ReturnType;
    };
  }
}

const COMMENT_MAX = 4000;
const newId = () => Math.random().toString(36).slice(2, 10);

export const Comment = Mark.create({
  name: "comment",
  inclusive: false,
  excludes: "",

  addAttributes() {
    return {
      id: { default: "", rendered: false },
      text: { default: "", rendered: false },
    };
  },

  renderHTML({ HTMLAttributes, mark }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        class: "doc-comment",
        "data-comment-id": String(mark.attrs.id ?? ""),
        title: String(mark.attrs.text ?? ""),
      }),
      0,
    ];
  },

  addCommands() {
    const type = () => this.type;
    return {
      addComment:
        (text, id) =>
        ({ state, tr, dispatch }) => {
          const { from, to, empty } = state.selection;
          const words = text.trim().slice(0, COMMENT_MAX);
          if (empty || !words) return false;
          if (dispatch) tr.addMark(from, to, type().create({ id: id ?? newId(), text: words }));
          return true;
        },
      updateComment:
        (id, text) =>
        ({ state, tr, dispatch }) => {
          const words = text.trim().slice(0, COMMENT_MAX);
          if (!words) return false;
          let found = false;
          state.doc.descendants((node, pos) => {
            if (!node.isText) return true;
            for (const mark of node.marks) {
              if (mark.type !== type() || mark.attrs.id !== id) continue;
              found = true;
              if (dispatch) {
                tr.removeMark(pos, pos + node.nodeSize, mark);
                tr.addMark(pos, pos + node.nodeSize, type().create({ id, text: words }));
              }
            }
            return false;
          });
          return found;
        },
      removeComment:
        (id) =>
        ({ state, tr, dispatch }) => {
          let found = false;
          state.doc.descendants((node, pos) => {
            if (!node.isText) return true;
            for (const mark of node.marks) {
              if (mark.type !== type() || mark.attrs.id !== id) continue;
              found = true;
              if (dispatch) tr.removeMark(pos, pos + node.nodeSize, mark);
            }
            return false;
          });
          return found;
        },
    };
  },
});

/** Every comment in a document, top to bottom, its stretches joined. */
export function listComments(doc: PMNode): DocComment[] {
  const byId = new Map<string, DocComment>();
  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    for (const mark of node.marks) {
      if (mark.type.name !== "comment") continue;
      const id = String(mark.attrs.id ?? "");
      if (!id) continue;
      const had = byId.get(id);
      if (had) {
        had.quote += (had.to === pos ? "" : " ") + (node.text ?? "");
        had.to = pos + node.nodeSize;
      } else {
        byId.set(id, {
          id,
          text: String(mark.attrs.text ?? ""),
          quote: node.text ?? "",
          from: pos,
          to: pos + node.nodeSize,
        });
      }
    }
    return false;
  });
  return [...byId.values()];
}
