import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * Dual dialogue, side by side on the page.
 *
 * A pair is exactly the export engine's (lib/export/paginate.ts, dualPairAt):
 * a cue that is not dual, with the parentheticals and dialogue under it (the
 * left column), followed straight away by a dual cue with its own (the right
 * column). Pairs are found left to right, the way the export walks the script.
 *
 * This plugin only names the columns: every line of a pair gets
 * `sp-dual-left` or `sp-dual-right`, which sets the column geometry in
 * globals.css (the export's column widths, so a line wraps in the same place
 * on screen and in the PDF). Standing the right column up beside the left one
 * needs both columns' measured heights, so the page engine does that part
 * (lib/editor/pagination.ts), in the same pass that places the page breaks.
 * A dual line that is not part of a pair (an orphan from an import) keeps the
 * plain right-column look from its data-dual attribute.
 */

export interface DualPair {
  /** Block index of the left column's cue. */
  leftStart: number;
  /** One past the left column's last block (== the right column's cue). */
  leftEnd: number;
  rightStart: number;
  /** One past the right column's last block. */
  rightEnd: number;
}

const isBody = (kind: string) => kind === "parenthetical" || kind === "dialogue";

/** Every dual pair in document order (the export's greedy walk). */
export function findDualPairs(blocks: { kind: string; dual: boolean }[]): DualPair[] {
  const pairs: DualPair[] = [];
  const n = blocks.length;
  for (let i = 0; i < n; ) {
    if (blocks[i].kind === "character" && !blocks[i].dual) {
      let leftEnd = i + 1;
      while (leftEnd < n && !blocks[leftEnd].dual && isBody(blocks[leftEnd].kind)) leftEnd++;
      if (leftEnd < n && blocks[leftEnd].kind === "character" && blocks[leftEnd].dual) {
        let rightEnd = leftEnd + 1;
        while (rightEnd < n && blocks[rightEnd].dual && isBody(blocks[rightEnd].kind)) rightEnd++;
        pairs.push({ leftStart: i, leftEnd, rightStart: leftEnd, rightEnd });
        i = rightEnd;
        continue;
      }
    }
    i++;
  }
  return pairs;
}

const dualLayoutKey = new PluginKey<DecorationSet>("screenplayDualLayout");

function build(state: EditorState): DecorationSet {
  const blocks: { kind: string; dual: boolean; pos: number; size: number }[] = [];
  let sawDual = false;
  state.doc.forEach((node, pos) => {
    const dual = node.attrs.dual === true;
    if (dual) sawDual = true;
    blocks.push({ kind: (node.attrs.element as string) ?? "action", dual, pos, size: node.nodeSize });
  });
  if (!sawDual) return DecorationSet.empty;
  const decos: Decoration[] = [];
  for (const p of findDualPairs(blocks)) {
    for (let i = p.leftStart; i < p.rightEnd; i++) {
      const b = blocks[i];
      decos.push(
        Decoration.node(b.pos, b.pos + b.size, {
          class: i < p.leftEnd ? "sp-dual-left" : "sp-dual-right",
        })
      );
    }
  }
  return DecorationSet.create(state.doc, decos);
}

export const DualLayout = Extension.create({
  name: "screenplayDualLayout",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: dualLayoutKey,
        state: {
          init: (_config, state) => build(state),
          apply: (tr, old, _oldState, newState) => (tr.docChanged ? build(newState) : old),
        },
        props: {
          decorations(state) {
            return dualLayoutKey.getState(state);
          },
        },
      }),
    ];
  },
});
