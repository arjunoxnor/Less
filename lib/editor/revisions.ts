import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { isHistoryTransaction } from "@tiptap/pm/history";
import { changedTopLevelNodes, finalChangedRanges } from "./changedRanges";

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
            const edits = (transaction: (typeof trs)[number]) =>
              transaction.docChanged &&
              !isHistoryTransaction(transaction) &&
              !transaction.getMeta(SKIP_REVISION_META) &&
              !transaction.getMeta("preventUpdate");
            const ranges = finalChangedRanges(trs, edits);
            if (!ranges.length) return null;

            const setTr = newState.tr;
            let changed = false;
            for (const { node, pos } of changedTopLevelNodes(newState.doc, ranges)) {
              if (node.type.name !== "screenplayLine") continue;
              if (!node.attrs.revised) {
                setTr.setNodeMarkup(pos, undefined, { ...node.attrs, revised: true });
                changed = true;
              }
            }
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
