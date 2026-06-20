import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { SKIP_REVISION_META } from "./revisions";
import { TRANSITIONS } from "./smarttype-catalogs";

/**
 * Auto element detection, the way Arc Studio does it: type a slugline opener on
 * an ordinary action line and the line becomes a scene heading; type a known
 * transition and it becomes a transition. It fires only when the line JUST
 * became matching, so a manual revert (the writer presses the action shortcut
 * back) is respected and never re-converted. Only action lines are touched.
 */

const autoElementKey = new PluginKey("screenplayAutoElement");

const SLUG = /^\s*(INT\.?\/EXT\.?|EXT\.?\/INT\.?|I\/E\.?|INT\.?|EXT\.?|EST\.?)[.\s]/i;

function slugMatch(text: string): boolean {
  return SLUG.test(text);
}

function transitionMatch(text: string): boolean {
  const t = text.trim().toUpperCase();
  if (!t) return false;
  // Catalog-only, so ordinary prose ending in a colon is never mis-converted.
  return TRANSITIONS.some((x) => x.toUpperCase() === t);
}

export const AutoElement = Extension.create({
  name: "screenplayAutoElement",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: autoElementKey,
        appendTransaction(trs, oldState, newState) {
          if (!trs.some((t) => t.docChanged)) return null;
          if (trs.some((t) => t.getMeta(autoElementKey))) return null;
          const sel = newState.selection;
          if (!sel.empty) return null;
          const $from = sel.$from;
          if ($from.depth < 1) return null;
          const pos = $from.before(1);
          const node = newState.doc.nodeAt(pos);
          if (!node || node.type.name !== "screenplayLine") return null;
          if (node.attrs.element !== "action") return null;

          const text = node.textContent;
          let target: string | null = null;
          if (slugMatch(text)) target = "scene_heading";
          else if (transitionMatch(text)) target = "transition";
          if (!target) return null;

          // Respect a manual revert: only convert when the line did not already
          // match in the previous state (so it just became a slug/transition).
          const index = $from.index(0);
          const oldNode =
            index < oldState.doc.childCount ? oldState.doc.child(index) : null;
          const oldText =
            oldNode && oldNode.type.name === "screenplayLine" ? oldNode.textContent : "";
          const oldMatched =
            target === "scene_heading" ? slugMatch(oldText) : transitionMatch(oldText);
          if (oldMatched) return null;

          const tr = newState.tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            element: target,
          });
          tr.setMeta(autoElementKey, true);
          tr.setMeta(SKIP_REVISION_META, true);
          tr.setMeta("addToHistory", false);
          return tr;
        },
      }),
    ];
  },
});
