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

/** The name a writer gave a version ("Draft 2"), or null for an automatic one. */
function versionName(label: string | null | undefined): string | null {
  if (!label || label === "On this device") return null;
  return label.replace(/ \(this device\)$/, "");
}

/**
 * Version history is the rollback safety net. Lists the snapshots taken on save,
 * newest first. Any of them can be compared with the script as it is now, or
 * restored; drafts saved by name lead with their name.
 */
export const HistoryPanel = memo(function HistoryPanel({
  getVersions,
  onRestore,
  onCompare,
  onSaveDraft,
  onClose,
}: {
  getVersions: () => Promise<VersionRow[]>;
  onRestore: (content: JSONContent, titlePage?: TitlePage | null) => void;
  /** Lay this version over the script with its changes marked. */
  onCompare?: (label: string, content: JSONContent) => void;
  /** Save the script as a named draft (a copy filed beside it). */
  onSaveDraft?: () => void;
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

      {onSaveDraft && (
        <div className="history-save">
          <button type="button" className="ui-btn history-save-btn" onClick={onSaveDraft}>
            Save a draft…
          </button>
        </div>
      )}

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
          const name = versionName(v.label);
          const stamp = `${when.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}, ${when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
          return (
            <li key={v.id} className={"history-item" + (name ? " is-named" : "")}>
              {name && <div className="history-name">{name}</div>}
              <div className="history-when">
                {stamp}
                {v.label && v.label.endsWith("(this device)") && (
                  <span className="history-tp-tag">This device</span>
                )}
                {v.title_page && (
                  <span className="history-tp-tag" title="This version includes a title page">
                    Title page
                  </span>
                )}
              </div>
              <div className="history-preview">{preview}</div>
              <div className="history-actions">
                {onCompare && (
                  <button
                    type="button"
                    className="history-restore history-compare"
                    title="See what changed between this version and the script now"
                    onClick={() => {
                      const live = latestVersions.current?.find((version) => version.id === v.id);
                      if (live) onCompare(name ?? stamp, live.content);
                    }}
                  >
                    Compare
                  </button>
                )}
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
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}, (previous, next) =>
  previous.getVersions === next.getVersions &&
  !previous.onCompare === !next.onCompare &&
  previous.onSaveDraft === next.onSaveDraft
);
