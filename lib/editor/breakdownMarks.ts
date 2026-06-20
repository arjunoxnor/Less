import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { tagRangesIn, categoryById, type BreakdownItem } from "./breakdown";

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
            apply: (tr, old, _o, newState) =>
              tr.docChanged || tr.getMeta(bdKey) === "refresh"
                ? buildDeco(newState, getItems, enabled)
                : old,
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
