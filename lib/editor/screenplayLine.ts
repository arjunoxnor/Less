import { Node, mergeAttributes } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  DEFAULT_ELEMENT,
  type ElementType,
} from "./elements";
import {
  isEmptyParentheticalText,
  parentheticalEditingKey,
  type ParentheticalEditingMeta,
  wrapParentheticalText,
} from "./parenthetical";
import { SKIP_REVISION_META } from "./revisions";
import { sceneCard } from "./sceneAttrs";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";

const dualNormalizeKey = new PluginKey("screenplayDualNormalize");

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
      /** Set (or clear, when empty) a script note on the current line. */
      setNote: (text: string) => ReturnType;
      /** Clear every revision mark in the document (start a fresh pass). */
      clearRevisions: () => ReturnType;
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
      // A script note attached to this line. Sparse like `dual`: renderHTML emits
      // nothing when empty, so notes never touch the screenplay text or export
      // (the flat ScriptLine carries no note), and existing docs are unchanged.
      note: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-note") ?? "",
        renderHTML: (attrs) => (attrs.note ? { "data-note": attrs.note as string } : {}),
      },
      // Marks a line changed since the current revision pass. Sparse like the
      // others; drives the on-screen and PDF revision asterisks.
      revised: {
        default: false,
        parseHTML: (el) => el.getAttribute("data-revised") === "true",
        renderHTML: (attrs) => (attrs.revised ? { "data-revised": "true" } : {}),
      },
      // Scene headings only: the scene's card on the structure board. One
      // attribute holding { storyline, color, synopsis }, null for every other
      // line, so a script without a board costs a few bytes a line rather than
      // three empty fields. None of it is screenplay text and export never sees
      // it. The storyline color is a CSS variable on the heading, so the page
      // can mark the scene's storyline in the margin; only a plain hex passes.
      scene: {
        default: null,
        parseHTML: (el) => {
          const storyline = el.getAttribute("data-storyline") ?? "";
          const color = el.getAttribute("data-story-color") ?? "";
          const synopsis = el.getAttribute("data-synopsis") ?? "";
          return sceneCard({ storyline, color, synopsis });
        },
        renderHTML: (attrs) => {
          const card = sceneCard(attrs.scene);
          if (!card) return {};
          const out: Record<string, string> = {};
          if (card.storyline) out["data-storyline"] = card.storyline;
          if (card.color) {
            out["data-story-color"] = card.color;
            out.style = `--story-color: ${card.color}`;
          }
          if (card.synopsis) out["data-synopsis"] = card.synopsis;
          return out;
        },
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

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: dualNormalizeKey,
        appendTransaction: (transactions, oldState, newState) => {
          if (!transactions.some((transaction) => transaction.docChanged)) return null;
          // Only a removed block can strand one half of a previously valid
          // pair. Attribute edits on legacy or imported orphan clusters keep
          // their existing behavior until the writer changes the structure.
          if (newState.doc.childCount >= oldState.doc.childCount) return null;
          const lines: { node: PMNode; pos: number }[] = [];
          newState.doc.forEach((node, pos) => lines.push({ node, pos }));
          const body = (node: PMNode) =>
            node.attrs.element === "parenthetical" || node.attrs.element === "dialogue";
          const tr = newState.tr;
          let changed = false;
          let inRightCluster = false;

          for (let i = 0; i < lines.length; i++) {
            const { node, pos } = lines[i];
            let shouldBeDual = false;
            if (node.attrs.element === "character" && node.attrs.dual === true) {
              let previous = i - 1;
              while (previous >= 0 && body(lines[previous].node)) previous--;
              shouldBeDual =
                previous >= 0 &&
                lines[previous].node.attrs.element === "character" &&
                lines[previous].node.attrs.dual !== true;
              inRightCluster = shouldBeDual;
            } else if (body(node)) {
              shouldBeDual = inRightCluster;
            } else {
              inRightCluster = false;
            }
            if (node.attrs.dual !== shouldBeDual) {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, dual: shouldBeDual });
              changed = true;
            }
          }

          if (!changed) return null;
          tr.setMeta(SKIP_REVISION_META, true);
          return tr;
        },
      }),
    ];
  },

  addCommands() {
    return {
      setElement:
        (type: ElementType) =>
        ({ state, dispatch }) => {
          const { from, empty, $to } = state.selection;
          // A selection made with Shift+Down ends at the very start of the
          // next line: that line is not part of it, so it keeps its type.
          const to = !empty && $to.depth > 0 && $to.parentOffset === 0 && $to.before() > from ? $to.before() : state.selection.to;
          let changed = false;
          const tr = state.tr;
          const activeLinePos =
            state.selection.$head.depth > 0 ? state.selection.$head.before(1) : -1;
          let parentheticalCaret: number | null = null;
          const automaticLines = parentheticalEditingKey.getState(state);
          const addAutomatic: number[] = [];
          const removeAutomatic: number[] = [];

          // Walk every block in the selected range and retype it. This makes
          // selecting several lines and pressing Cmd+3 turn them all into
          // character cues, which is what writers expect.
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (node.type.name === this.name) {
              const mappedPos = tr.mapping.map(pos);
              const currentNode = tr.doc.nodeAt(mappedPos);
              if (!currentNode) return;
              // Retyping a line out of a dialogue cluster drops the dual
              // (side-by-side) flag: an action line half-indented to the right
              // column is never what the writer meant, and the flag exports.
              const keepDual =
                !!node.attrs.dual &&
                (type === "dialogue" ||
                  type === "parenthetical" ||
                  type === "character");
              if (node.attrs.element !== type || node.attrs.dual !== keepDual) {
                tr.setNodeMarkup(mappedPos, undefined, {
                  ...node.attrs,
                  element: type,
                  dual: keepDual,
                });
                changed = true;
              }

              const oldText = currentNode.textContent;
              let nextText = oldText;
              if (type === "parenthetical") {
                nextText = wrapParentheticalText(oldText);
                if (nextText !== oldText) addAutomatic.push(mappedPos);
              } else if (
                node.attrs.element === "parenthetical" &&
                automaticLines?.has(pos) &&
                oldText.startsWith("(") &&
                oldText.endsWith(")")
              ) {
                // Formatting punctuation added during this editing session
                // leaves with the format. Parentheses already supplied by the
                // writer are not tracked and remain untouched.
                nextText = oldText.slice(1, -1);
                removeAutomatic.push(mappedPos);
              } else if (
                node.attrs.element === "parenthetical" &&
                isEmptyParentheticalText(oldText)
              ) {
                nextText = "";
              }

              if (nextText !== oldText) {
                const textFrom = mappedPos + 1;
                const textTo = textFrom + currentNode.content.size;
                if (nextText) tr.insertText(nextText, textFrom, textTo);
                else tr.delete(textFrom, textTo);
                changed = true;
              }

              if (
                state.selection.empty &&
                type === "parenthetical" &&
                pos === activeLinePos
              ) {
                // The last editable position is immediately before the close.
                parentheticalCaret = mappedPos + nextText.length;
              }
            }
          });

          if (parentheticalCaret != null) {
            tr.setSelection(TextSelection.create(tr.doc, parentheticalCaret));
            changed = true;
          }
          if (addAutomatic.length > 0 || removeAutomatic.length > 0) {
            tr.setMeta(parentheticalEditingKey, {
              ...(addAutomatic.length > 0 ? { add: addAutomatic } : {}),
              ...(removeAutomatic.length > 0 ? { remove: removeAutomatic } : {}),
            } satisfies ParentheticalEditingMeta);
          }
          if (changed && dispatch) dispatch(tr);
          return changed;
        },

      toggleDual:
        () =>
        ({ state, dispatch }) => {
          // Dual dialogue pairs two speeches that follow each other: the first
          // stays the left column, the second (its cue and the lines under it)
          // becomes the right one. Works from wherever the writer is:
          //   - a selection touching two speeches: those two become a pair
          //   - the caret in the second speech: it joins the one before it
          //   - the caret in the first speech: the next one joins it
          //   - in either half of an existing pair: the pair comes apart
          const lines: { pos: number; node: PMNode }[] = [];
          state.doc.forEach((node, offset) => lines.push({ pos: offset, node }));
          const elementOf = (i: number) => lines[i].node.attrs.element as string;
          const isCue = (i: number) => i >= 0 && i < lines.length && elementOf(i) === "character";
          const isCueBody = (i: number) =>
            i >= 0 && i < lines.length && (elementOf(i) === "parenthetical" || elementOf(i) === "dialogue");
          const dualAt = (i: number) => lines[i].node.attrs.dual === true;

          /** The speech (a cue and the lines under it) that line i belongs to. */
          const speechAt = (i: number): { cue: number; end: number } | null => {
            let cue = i;
            while (isCueBody(cue)) cue--;
            if (!isCue(cue)) return null;
            let end = cue + 1;
            while (isCueBody(end)) end++;
            return { cue, end };
          };
          const lineAt = (pos: number) =>
            lines.findIndex((l) => pos >= l.pos && pos <= l.pos + l.node.nodeSize);

          const { from, to, empty } = state.selection;
          const first = lineAt(from);
          const last = empty ? first : lineAt(to);
          if (first < 0 || last < 0) return false;
          const touched: { cue: number; end: number }[] = [];
          for (let i = first; i <= last; i++) {
            const speech = speechAt(i);
            if (speech && !touched.some((t) => t.cue === speech.cue)) touched.push(speech);
          }
          if (touched.length === 0) return false;

          const set = (speech: { cue: number; end: number }, dual: boolean) => {
            if (!dispatch) return;
            const tr = state.tr;
            for (let i = speech.cue; i < speech.end; i++) {
              tr.setNodeMarkup(lines[i].pos, undefined, { ...lines[i].node.attrs, dual });
            }
            dispatch(tr);
          };

          const here = touched[0];
          const next = isCue(here.end) ? speechAt(here.end) : null;
          // Already a pair: take it apart, from either half.
          if (dualAt(here.cue)) {
            set(here, false);
            return true;
          }
          if (next && dualAt(next.cue)) {
            set(next, false);
            return true;
          }
          // Two speeches selected: the second joins the first.
          if (touched.length >= 2) {
            if (!next || next.cue !== touched[1].cue) return false;
            set(next, true);
            return true;
          }
          // The caret in a speech: it joins the one before it, if that one is
          // free to be a left column; otherwise the next one joins it.
          const prev = here.cue > 0 ? speechAt(here.cue - 1) : null;
          if (prev && prev.end === here.cue && !dualAt(prev.cue)) {
            set(here, true);
            return true;
          }
          if (next) {
            set(next, true);
            return true;
          }
          return false;
        },

      setNote:
        (text: string) =>
        ({ state, dispatch }) => {
          // The line node is the depth-1 ancestor of the caret.
          const $from = state.selection.$from;
          const pos = $from.before(1);
          const node = state.doc.nodeAt(pos);
          if (!node || node.type.name !== this.name) return false;
          if ((node.attrs.note ?? "") === text) return false;
          if (dispatch) {
            dispatch(
              state.tr
                .setNodeMarkup(pos, undefined, { ...node.attrs, note: text })
                .setMeta(SKIP_REVISION_META, true)
            );
          }
          return true;
        },

      clearRevisions:
        () =>
        ({ state, dispatch }) => {
          const tr = state.tr;
          let changed = false;
          state.doc.forEach((node, offset) => {
            if (node.type.name === this.name && node.attrs.revised) {
              tr.setNodeMarkup(offset, undefined, { ...node.attrs, revised: false });
              changed = true;
            }
          });
          if (changed && dispatch) {
            // Undoable: one click clears every star, so Ctrl+Z puts them back.
            tr.setMeta(SKIP_REVISION_META, true);
            dispatch(tr);
          }
          return changed;
        },
    };
  },
});
