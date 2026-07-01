"use client";

import { useEffect, useState } from "react";
import type { JSONContent } from "@tiptap/core";
import type { VersionRow } from "@/lib/cloud/scripts";
import type { TitlePage } from "@/lib/export/titlePage";
import { docText } from "@/lib/editor/docUtils";

/**
 * Version history — the rollback safety net. Lists the snapshots taken on save,
 * newest first, and lets the writer restore any of them with one click.
 */
export function HistoryPanel({
  getVersions,
  onRestore,
  onClose,
}: {
  getVersions: () => Promise<VersionRow[]>;
  onRestore: (content: JSONContent, titlePage?: TitlePage | null) => void;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getVersions()
      .then(setVersions)
      .catch((e) => setError(String(e?.message ?? e)));
  }, [getVersions]);

  return (
    <aside className="history-panel">
      <div className="history-head">
        <strong>Version history</strong>
        <button type="button" className="history-x" onClick={onClose}>
          ✕
        </button>
      </div>

      {error && <div className="history-empty">Couldn’t load history.</div>}

      {!error && versions === null && (
        <div className="history-empty">Loading…</div>
      )}

      {!error && versions?.length === 0 && (
        <div className="history-empty">
          No snapshots yet. They’re taken automatically as you write.
        </div>
      )}

      <ul className="history-list">
        {versions?.map((v) => {
          const when = new Date(v.created_at);
          const preview = docText(v.content).slice(0, 70) || "(empty)";
          return (
            <li key={v.id} className="history-item">
              <div className="history-when">
                {when.toLocaleDateString()}{" "}
                {when.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {v.title_page && (
                  <span className="history-tp-tag" title="This version includes a title page">
                    Title page
                  </span>
                )}
                {v.label && <span className="history-tp-tag">{v.label}</span>}
              </div>
              <div className="history-preview">{preview}</div>
              <button
                type="button"
                className="history-restore"
                title={
                  v.title_page
                    ? "Restore this version's text and its title page"
                    : "Restore this version's text"
                }
                onClick={() => onRestore(v.content, v.title_page ?? undefined)}
              >
                Restore
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
