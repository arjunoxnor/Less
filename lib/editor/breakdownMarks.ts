import { Extension, getChangedRanges } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { tagRangesIn, categoryById, type BreakdownItem } from "./breakdown";
import { changedTopLevelNodes } from "./changedRanges";

/**
 * In-script breakdown highlighting: underline every tagged occurrence in the
 * color of its category. Computed purely from the live item catalog, never
 * written into the document (so it stays out of the cast list and all exports),
 * mirroring how the (CONT'D) and spell-check decorations work.
 */

const bdKey = new PluginKey<DecorationSet>("screenplayBreakdown");

function buildDeco(
  state: EditorState,
  getItems: () => BreakdownItem[],
  enabled: () => boolean
): DecorationSet {
  if (!enabled()) return DecorationSet.empty;
  const items = getItems();
  if (!items.length) return DecorationSet.empty;

  const decos: Decoration[] = [];
  state.doc.forEach((node, offset) => {
    if (node.type.name !== "screenplayLine") return;
    const text = node.textContent;
    if (!text) return;
    for (const r of tagRangesIn(text, items)) {
      const color = categoryById(r.item.category)?.color ?? "#888";
      decos.push(
        Decoration.inline(offset + 1 + r.start, offset + 1 + r.end, {
          class: "sp-bd",
          style: `--bd-color:${color}`,
          title: `${categoryById(r.item.category)?.label ?? r.item.category}: ${r.item.name}`,
        })
      );
    }
  });
  return DecorationSet.create(state.doc, decos);
}

function decorationsForLine(
  node: PMNode,
  offset: number,
  items: BreakdownItem[]
): Decoration[] {
  if (node.type.name !== "screenplayLine" || !node.textContent) return [];
  return tagRangesIn(node.textContent, items).map((range) => {
    const color = categoryById(range.item.category)?.color ?? "#888";
    return Decoration.inline(offset + 1 + range.start, offset + 1 + range.end, {
      class: "sp-bd",
      style: `--bd-color:${color}`,
      title: `${categoryById(range.item.category)?.label ?? range.item.category}: ${range.item.name}`,
    });
  });
}

/** Force the highlights to recompute (after the item catalog or toggle changes). */
export function rescanBreakdown(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(bdKey, "refresh").setMeta("addToHistory", false));
}

/** In-script breakdown highlights, gated by a live-read enabled flag. */
export function buildBreakdownMarks(
  getItems: () => BreakdownItem[],
  enabled: () => boolean
): Extension {
  return Extension.create({
    name: "screenplayBreakdown",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: bdKey,
          state: {
            init: (_c, state) => buildDeco(state, getItems, enabled),
            apply: (tr, old, _o, newState) => {
              if (tr.getMeta(bdKey) === "refresh") {
                return buildDeco(newState, getItems, enabled);
              }
              if (!tr.docChanged) return old;
              if (!enabled()) return DecorationSet.empty;
              const ranges = getChangedRanges(tr).map(
                (change) => [change.newRange.from, change.newRange.to] as [number, number]
              );
              if (!ranges.length) return buildDeco(newState, getItems, enabled);

              let next = old.map(tr.mapping, tr.doc);
              const items = getItems();
              for (const { node, pos } of changedTopLevelNodes(newState.doc, ranges)) {
                next = next.remove(next.find(pos, pos + node.nodeSize));
                const additions = decorationsForLine(node, pos, items);
                if (additions.length) next = next.add(newState.doc, additions);
              }
              return next;
            },
          },
          props: {
            decorations(state) {
              return bdKey.getState(state);
            },
          },
        }),
      ];
    },
  });
}
