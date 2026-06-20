import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

/**
 * Revision tracking. While revision mode is on, any line the writer edits gets
 * its `revised` flag set, which drives the on-screen and PDF revision asterisks.
 * Loading a whole document (a cross-device pull, an import, a version restore)
 * is a full-document replace and is skipped, so only real edits mark revisions.
 * `clearRevisions` (a node command) resets the marks to start a fresh pass.
 */

const revKey = new PluginKey("screenplayRevisions");

/** Transactions carrying this meta are not treated as edits (our own marking,
 * clearRevisions, setNote): they change attributes, not screenplay content. */
export const SKIP_REVISION_META = "skipRevisionTrack";

export function buildRevisionTracker(isEnabled: () => boolean): Extension {
  return Extension.create({
    name: "screenplayRevisions",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: revKey,
          appendTransaction(trs, oldState, newState) {
            if (!isEnabled()) return null;
            if (!trs.some((t) => t.docChanged)) return null;
            // Skip attribute-only changes (our own marking, clearRevisions, notes).
            if (trs.some((t) => t.getMeta(SKIP_REVISION_META))) return null;

            // Collect the changed ranges in the new document.
            const ranges: [number, number][] = [];
            let minStart = Infinity;
            let maxEnd = -Infinity;
            for (const tr of trs) {
              for (const step of tr.steps) {
                step.getMap().forEach((_os, _oe, newStart, newEnd) => {
                  ranges.push([newStart, newEnd]);
                  if (newStart < minStart) minStart = newStart;
                  if (newEnd > maxEnd) maxEnd = newEnd;
                });
              }
            }
            if (!ranges.length) return null;

            // Skip a full-document replace (setContent on load/import/restore):
            // it spans from the very start to the very end of the document.
            if (minStart <= 1 && maxEnd >= newState.doc.content.size - 1) {
              return null;
            }

            const setTr = newState.tr;
            let changed = false;
            newState.doc.forEach((node, offset) => {
              if (node.type.name !== "screenplayLine") return;
              const start = offset;
              const end = offset + node.nodeSize;
              const touched = ranges.some(([s, e]) => s < end && e > start);
              if (touched && !node.attrs.revised) {
                setTr.setNodeMarkup(offset, undefined, { ...node.attrs, revised: true });
                changed = true;
              }
            });
            if (!changed) return null;
            setTr.setMeta(SKIP_REVISION_META, true);
            setTr.setMeta("addToHistory", false);
            return setTr;
          },
        }),
      ];
    },
  });
}
