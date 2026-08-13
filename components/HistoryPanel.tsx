"use client";

import { memo, useEffect, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/core";
import type { VersionRow } from "@/lib/cloud/scripts";
import type { TitlePage } from "@/lib/export/titlePage";

const PREVIEW_LENGTH = 70;

/** Read only enough of a snapshot to paint its row, even for a 200-page doc. */
function docPreview(doc: JSONContent): string {
  const stack: JSONContent[] = [doc];
  let out = "";
  let pendingSpace = false;
  while (stack.length && out.length <= PREVIEW_LENGTH) {
    const node = stack.pop()!;
    if (node.type === "text" && node.text) {
      for (const char of node.text) {
        if (/\s/.test(char)) {
          pendingSpace = out.length > 0;
        } else {
          if (pendingSpace && out.length <= PREVIEW_LENGTH) out += " ";
          pendingSpace = false;
          out += char;
          if (out.length > PREVIEW_LENGTH) break;
        }
      }
    }
    const children = node.content;
    if (children) {
      for (let index = children.length - 1; index >= 0; index--) {
        stack.push(children[index]);
      }
      if (out) pendingSpace = true;
    }
  }
  if (!out) return "(empty)";
  return out.length > PREVIEW_LENGTH ? `${out.slice(0, PREVIEW_LENGTH)}…` : out;
}

/**
 * Version history is the rollback safety net. Lists the snapshots taken on save,
 * newest first, and lets the writer restore any of them with one click.
 */
export const HistoryPanel = memo(function HistoryPanel({
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
  const latestVersions = useRef<VersionRow[] | null>(versions);
  latestVersions.current = versions;

  useEffect(() => {
    let cancelled = false;
    setVersions(null);
    setError(null);
    getVersions()
      .then((next) => {
        if (!cancelled) setVersions(next);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e?.message ?? e));
      });
    return () => {
      cancelled = true;
    };
  }, [getVersions]);

  return (
    <aside className="history-panel">
      <div className="history-head">
        <strong>Version history</strong>
        <button
          type="button"
          className="history-x"
          onClick={onClose}
          title="Close"
          aria-label="Close version history"
        >
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
          const preview = docPreview(v.content);
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
                    : "Restore this version's text and remove the current title page"
                }
                onClick={() => {
                  const live = latestVersions.current?.find(
                    (version) => version.id === v.id
                  );
                  if (live) onRestore(live.content, live.title_page);
                }}
              >
                Restore
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}, (previous, next) => previous.getVersions === next.getVersions);
