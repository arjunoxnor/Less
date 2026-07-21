"use client";

import { useMemo } from "react";
import { listProjects, type ProjectMeta } from "@/lib/storage/projects";
import { listFolders } from "@/lib/storage/folders";
import { filmForProject } from "@/lib/storage/films";
import { relativeTime } from "./ProjectsHome";

/**
 * The editor's Docs panel (films-home build, Altitude 3): the open project's
 * film, one keystroke away. Script drafts on top, documents beneath, the one
 * you are in marked. Clicking another item switches to it through the normal
 * open flow; the editor's unmount already flushes the current save, so the
 * switch is safe mid-thought.
 */
export function DocsPanel({
  projectId,
  onOpen,
  onClose,
}: {
  projectId: string;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  // A fresh storage read per open. The panel mounts each time it is shown, so
  // this stays current without threading the whole library into the editor.
  const film = useMemo(
    () => filmForProject(projectId, listProjects(), listFolders()),
    [projectId]
  );

  const drafts = film
    ? film.currentDraft
      ? [film.currentDraft, ...film.earlierDrafts]
      : film.earlierDrafts
    : [];
  const documents = film?.documents ?? [];

  const item = (p: ProjectMeta) => {
    const current = p.id === projectId;
    return (
      <button
        key={p.id}
        type="button"
        className={"docs-item" + (current ? " docs-item-current" : "")}
        title={p.title}
        onClick={() => (current ? onClose() : onOpen(p.id))}
      >
        <span className="docs-item-title">{p.title}</span>
        <span className="docs-item-meta">
          {current
            ? "Current"
            : p.type === "screenplay" && p.pageCount != null
              ? `${p.pageCount} pp`
              : relativeTime(p.updatedAt)}
        </span>
      </button>
    );
  };

  return (
    <aside className="side-panel docs-panel">
      <div className="side-panel-head">
        <strong>{film ? film.name : "Docs"}</strong>
        <button type="button" className="side-panel-x" onClick={onClose} title="Close">
          Close
        </button>
      </div>

      {!film ? (
        <div className="side-panel-empty">
          This document is not part of a film yet. File it into one from the
          home to see the film&apos;s drafts and documents here.
        </div>
      ) : (
        <div className="docs-list">
          <div className="docs-group">Script drafts</div>
          {drafts.length > 0 ? (
            drafts.map(item)
          ) : (
            <div className="docs-none">No script yet.</div>
          )}
          {/* An implicit film is just its one script; only folder films carry
              a documents shelf. */}
          {film.kind === "folder" && (
            <>
              <div className="docs-group">Documents</div>
              {documents.length > 0 ? (
                documents.map(item)
              ) : (
                <div className="docs-none">No documents yet.</div>
              )}
            </>
          )}
        </div>
      )}
    </aside>
  );
}
