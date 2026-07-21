"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/core";
import type { Prefs } from "@/lib/storage/localStore";
import {
  loadPageLock,
  loadProjectDoc,
  loadProjectTitlePage,
  type ProjectMeta,
  type ProjectStatus,
  type ProjectType,
} from "@/lib/storage/projects";
import type { Folder } from "@/lib/storage/folders";
import { filmForFolder, listFilms } from "@/lib/storage/films";
import type { TitlePage } from "@/lib/export/titlePage";
import { exportDoc, type ExportFormat } from "@/lib/export";
import { Menu, type MenuItem } from "./ui/Menu";
import { Modal } from "./ui/Modal";
import { showToast } from "./ui/Toast";
import { ChevronLeftIcon, DotsIcon } from "./chrome/icons";
import { firstLine, NameInput, relativeTime, StatusWord } from "./ProjectsHome";

/**
 * The project page (films-home build, Altitude 2): everything about one film.
 * Routed at #/f/<folderId>. The script and its earlier drafts on top, the
 * documents beneath, and a project-scoped note line. The film itself is still
 * just a folder in the data; this page reads it through lib/storage/films and
 * writes only through the existing useProjects handlers.
 */

const STATUS_WORD: Record<ProjectStatus, string> = {
  not_started: "Idea",
  writing: "Writing",
  done: "Done",
};

export function ProjectPage({
  folder,
  projects,
  folders,
  prefs,
  onPrefsChange,
  onBack,
  onOpen,
  onCreate,
  onDelete,
  onRename,
  onSetFolder,
  onReorder,
  onUpdateFolder,
}: {
  folder: Folder;
  projects: ProjectMeta[];
  folders: Folder[];
  prefs: Prefs;
  onPrefsChange: (next: Partial<Prefs>) => void;
  onBack: () => void;
  onOpen: (id: string, opts?: { focusTitle?: boolean }) => void;
  onCreate: (
    type: ProjectType,
    title: string,
    opts?: {
      content?: JSONContent;
      titlePage?: TitlePage | null;
      folderId?: string | null;
    }
  ) => ProjectMeta;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onSetFolder: (id: string, folderId: string | null) => void;
  onReorder: (orderedIds: string[]) => void;
  onUpdateFolder: (
    id: string,
    patch: { name?: string; color?: string; parentId?: string | null }
  ) => void;
}) {
  const film = useMemo(
    () => filmForFolder(folder.id, projects, folders),
    [folder.id, projects, folders]
  );

  // AppShell already guards unknown folder ids; this catches the folder
  // becoming nested (no longer a film) while the page is open.
  useEffect(() => {
    if (!film) onBack();
  }, [film, onBack]);

  /* ---- View state ---- */
  const [menu, setMenu] = useState<
    | null
    | { kind: "overflow" | "new"; anchor: DOMRect }
    | { kind: "row"; id: string; anchor: DOMRect }
  >(null);
  const openMenu = (
    e: React.MouseEvent,
    m: { kind: "overflow" | "new" } | { kind: "row"; id: string }
  ) => {
    e.stopPropagation();
    setMenu({ ...m, anchor: e.currentTarget.getBoundingClientRect() });
  };
  const [showEarlier, setShowEarlier] = useState(false);
  const [renamingRow, setRenamingRow] = useState<string | null>(null);
  const [moveTarget, setMoveTarget] = useState<ProjectMeta | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ProjectMeta | null>(null);
  const [jot, setJot] = useState("");

  // The film name edits inline; buffer locally and commit one rename on
  // blur or Enter through the existing folder rename.
  const [nameDraft, setNameDraft] = useState(folder.name);
  useEffect(() => setNameDraft(folder.name), [folder.name]);
  const commitName = () => {
    const next = nameDraft.trim();
    if (next && next !== folder.name) onUpdateFolder(folder.id, { name: next });
    else setNameDraft(folder.name);
  };

  // Relative times refresh once a minute while the page is on screen.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const draft = film?.currentDraft ?? null;
  const earlier = film?.earlierDrafts ?? [];

  // The current draft's first scene line, re-read only when its clock moves.
  const draftLine = useMemo(
    () => (draft ? firstLine(draft) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft?.id, draft?.updatedAt]
  );

  // Documents wear the manual drag order when one exists; the selector's
  // recency order remains the fallback (the sort is stable, so untouched
  // documents keep their newest-first placement).
  const documents = useMemo(() => {
    const docs = film?.documents ?? [];
    return docs
      .slice()
      .sort(
        (a, b) =>
          (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)
      );
  }, [film]);

  /* ---- Drag: reorder document lines with the caret-row indicator ---- */

  const dragDoc = useRef<string | null>(null);
  const [draggingDoc, setDraggingDoc] = useState<string | null>(null);
  const [caretIdx, setCaretIdx] = useState<number | null>(null);
  // The drop handler can fire before the last dragover's state lands in a
  // render, so the authoritative slot lives in a ref; the state only draws
  // the caret line.
  const caretRef = useRef<number | null>(null);
  const placeCaret = (idx: number) => {
    caretRef.current = idx;
    setCaretIdx(idx);
  };
  const clearDocDrag = () => {
    dragDoc.current = null;
    caretRef.current = null;
    setDraggingDoc(null);
    setCaretIdx(null);
  };
  const dropDocs = () => {
    const dragged = dragDoc.current;
    const at = caretRef.current;
    clearDocDrag();
    if (!dragged || at === null) return;
    const ids = documents.map((d) => d.id);
    const from = ids.indexOf(dragged);
    if (from < 0) return;
    const to = at > from ? at - 1 : at; // removing the dragged row shifts the slot
    if (to === from) return;
    ids.splice(from, 1);
    ids.splice(to, 0, dragged);
    onReorder(ids);
  };
  const docRowDragProps = (idx: number) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragDoc.current) return;
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      placeCaret(e.clientY < r.top + r.height / 2 ? idx : idx + 1);
    },
    onDrop: (e: React.DragEvent) => {
      if (!dragDoc.current) return;
      e.preventDefault();
      dropDocs();
    },
  });

  /* ---- Flows ---- */

  const createHere = (type: ProjectType, title: string) => {
    try {
      const meta = onCreate(type, title, { folderId: folder.id });
      onOpen(meta.id, { focusTitle: true });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not create the project.", {
        variant: "danger",
      });
    }
  };

  // The project-scoped jot: Enter files a plain doc straight into this film.
  const jotNote = () => {
    const title = jot.trim();
    if (!title) return;
    try {
      onCreate("plain", title, { folderId: folder.id });
      setJot("");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not save the note.", {
        variant: "danger",
      });
    }
  };

  const duplicate = (p: ProjectMeta) => {
    const content = loadProjectDoc(p.id);
    if (!content) {
      showToast("This script is not stored on this device. Open it once first.", {
        variant: "danger",
      });
      return;
    }
    try {
      onCreate(p.type, `${p.title} copy`, {
        content,
        titlePage: loadProjectTitlePage(p.id),
        folderId: folder.id,
      });
      showToast("Duplicated.");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not duplicate the project.", {
        variant: "danger",
      });
    }
  };

  const exportRow = (p: ProjectMeta, format: ExportFormat) => {
    const doc = loadProjectDoc(p.id);
    if (!doc) {
      showToast("This script is not stored on this device. Open it once first.", {
        variant: "danger",
      });
      return;
    }
    void exportDoc(doc, format, loadProjectTitlePage(p.id) ?? undefined, {
      sceneNumbers: prefs.sceneNumbers,
      autoContd: prefs.autoContd,
      lock: loadPageLock(p.id),
    }).catch(() => showToast("Export failed.", { variant: "danger" }));
  };

  /* ---- Menus ---- */

  const overflowItems: MenuItem[] = [
    {
      kind: "radio",
      group: "theme",
      label: "Light",
      checked: prefs.theme === "light",
      onSelect: () => onPrefsChange({ theme: "light" }),
    },
    {
      kind: "radio",
      group: "theme",
      label: "Dark",
      checked: prefs.theme === "dark",
      onSelect: () => onPrefsChange({ theme: "dark" }),
    },
    {
      kind: "radio",
      group: "theme",
      label: "System",
      checked: prefs.theme === "system",
      onSelect: () => onPrefsChange({ theme: "system" }),
    },
  ];

  // The New menu here is scoped to this film: everything it makes files here.
  const newItems: MenuItem[] = [
    { label: "New draft", onSelect: () => createHere("screenplay", "Untitled screenplay") },
    { label: "New document", onSelect: () => createHere("plain", "") },
  ];

  const rowItems = (p: ProjectMeta): MenuItem[] => [
    { label: "Rename", onSelect: () => setRenamingRow(p.id) },
    { label: "Duplicate", onSelect: () => duplicate(p) },
    ...(p.type === "screenplay"
      ? ([
          { kind: "divider" },
          { label: "Export PDF", onSelect: () => exportRow(p, "pdf") },
          { label: "Export Fountain", onSelect: () => exportRow(p, "fountain") },
          { label: "Export FDX", onSelect: () => exportRow(p, "fdx") },
        ] as MenuItem[])
      : []),
    { kind: "divider" },
    { label: "Move to", onSelect: () => setMoveTarget(p) },
    { label: "Delete", danger: true, onSelect: () => setConfirmDelete(p) },
  ];

  // Move targets are films (top-level folders), plus loose. Moving into a
  // different film or out to loose uses the same one filing handler.
  const moveTargets = useMemo(
    () => listFilms(projects, folders).filter((f) => f.kind === "folder"),
    [projects, folders]
  );

  /* ---- Row renders ---- */

  const rowKebab = (p: ProjectMeta) => (
    <button
      type="button"
      className="fh-kebab"
      aria-label={`Actions for ${p.title}`}
      aria-haspopup="menu"
      onClick={(e) => openMenu(e, { kind: "row", id: p.id })}
    >
      <DotsIcon />
    </button>
  );

  const draftRow = (p: ProjectMeta) => (
    <div
      key={p.id}
      className="dline"
      role="button"
      tabIndex={0}
      onClick={() => renamingRow !== p.id && onOpen(p.id)}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && renamingRow !== p.id) {
          e.preventDefault();
          onOpen(p.id);
        }
      }}
    >
      {renamingRow === p.id ? (
        <NameInput
          initial={p.title}
          className="line-rename"
          ariaLabel="Draft title"
          onCommit={(name) => {
            if (name && name !== p.title) onRename(p.id, name);
          }}
          onDone={() => setRenamingRow(null)}
        />
      ) : (
        <span className="d-title">{p.title}</span>
      )}
      <span className="d-when">
        {p.pageCount != null ? `${p.pageCount} pp` : ""}
        {p.pageCount != null ? "  " : ""}
        {relativeTime(p.updatedAt)}
      </span>
      {rowKebab(p)}
    </div>
  );

  const docRow = (p: ProjectMeta, idx: number) => (
    <div
      key={p.id}
      className={"dline" + (draggingDoc === p.id ? " dragging" : "")}
      role="button"
      tabIndex={0}
      draggable={renamingRow !== p.id}
      onDragStart={(e) => {
        dragDoc.current = p.id;
        setDraggingDoc(p.id);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", p.id);
      }}
      onDragEnd={clearDocDrag}
      onClick={() => renamingRow !== p.id && onOpen(p.id)}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && renamingRow !== p.id) {
          e.preventDefault();
          onOpen(p.id);
        }
      }}
      {...docRowDragProps(idx)}
    >
      {renamingRow === p.id ? (
        <NameInput
          initial={p.title}
          className="line-rename"
          ariaLabel="Document title"
          onCommit={(name) => {
            if (name && name !== p.title) onRename(p.id, name);
          }}
          onDone={() => setRenamingRow(null)}
        />
      ) : (
        <span className="d-title">{p.title}</span>
      )}
      <span className="d-when">{relativeTime(p.updatedAt)}</span>
      {rowKebab(p)}
    </div>
  );

  const menuTargetRow =
    menu?.kind === "row" ? projects.find((p) => p.id === menu.id) ?? null : null;

  if (!film) return null;

  return (
    <div className="home">
      <header className="home-topbar">
        <button type="button" className="fh-back" onClick={onBack}>
          <ChevronLeftIcon />
          Films
        </button>
        <div className="toolbar-spacer" />
        <button
          type="button"
          className="tb-icon"
          aria-label="More"
          title="More"
          aria-haspopup="menu"
          onClick={(e) => openMenu(e, { kind: "overflow" })}
        >
          <DotsIcon />
        </button>
        <button
          type="button"
          className="ui-btn ui-btn-solid fh-new"
          aria-haspopup="menu"
          onClick={(e) => openMenu(e, { kind: "new" })}
        >
          New draft
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </header>

      <main className="fh-page">
        <div className="pp-head">
          <div className="pp-kicker">
            <span className="pp-mark" style={{ background: film.color }} aria-hidden="true" />
            <span className="pp-kind">Film</span>
          </div>
          <input
            className="pp-title"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              } else if (e.key === "Escape") {
                setNameDraft(folder.name);
                (e.target as HTMLInputElement).blur();
              }
            }}
            aria-label="Film name"
          />
          <div className="pp-meta">
            {draft && (
              <>
                <button
                  type="button"
                  className="pp-continue"
                  onClick={() => onOpen(draft.id)}
                >
                  {/* pageCount is total pages, not a caret position */}
                  Continue {draft.title}
                  {draft.pageCount != null ? `, ${draft.pageCount} pages` : ""}
                </button>
                <span className="pp-sep" aria-hidden="true">
                  &middot;
                </span>
              </>
            )}
            <span>{STATUS_WORD[film.status]}</span>
            <span className="pp-sep" aria-hidden="true">
              &middot;
            </span>
            <span>edited {relativeTime(film.lastTouched)}</span>
          </div>
        </div>

        <div className="band">Script</div>
        {draft ? (
          <>
            <div
              className="sline"
              role="button"
              tabIndex={0}
              onClick={() => renamingRow !== draft.id && onOpen(draft.id)}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && renamingRow !== draft.id) {
                  e.preventDefault();
                  onOpen(draft.id);
                }
              }}
            >
              {renamingRow === draft.id ? (
                <NameInput
                  initial={draft.title}
                  className="line-rename"
                  ariaLabel="Draft title"
                  onCommit={(name) => {
                    if (name && name !== draft.title) onRename(draft.id, name);
                  }}
                  onDone={() => setRenamingRow(null)}
                />
              ) : (
                <span className="s-title">{draft.title}</span>
              )}
              {draftLine && (
                <span
                  className={"s-open" + (draftLine.isScene ? " s-open-scene" : "")}
                >
                  {draftLine.text}
                </span>
              )}
              <span className="s-meta">
                <StatusWord status={draft.status} />
                {draft.pageCount != null && <span>{draft.pageCount} pp</span>}
                <span>{relativeTime(draft.updatedAt)}</span>
              </span>
              {rowKebab(draft)}
            </div>
            {earlier.length > 0 && (
              <button
                type="button"
                className="mline"
                aria-expanded={showEarlier}
                onClick={() => setShowEarlier((v) => !v)}
              >
                Earlier drafts ({earlier.length})
              </button>
            )}
            {showEarlier && earlier.map(draftRow)}
          </>
        ) : (
          // A film without a script yet: the page still stands, and the
          // script starts from right here.
          <button
            type="button"
            className="sline sline-start"
            onClick={() => createHere("screenplay", "Untitled screenplay")}
          >
            Start the script
          </button>
        )}

        <div className="band band-later">Documents</div>
        <div
          onDragOver={(e) => {
            // Below the last row still counts as a drop at the end.
            if (dragDoc.current) e.preventDefault();
          }}
          onDrop={(e) => {
            if (dragDoc.current) {
              e.preventDefault();
              dropDocs();
            }
          }}
        >
          {documents.map((p, i) => (
            <div key={p.id} className="dline-slot">
              {caretIdx === i && <div className="drop-caret" aria-hidden="true" />}
              {docRow(p, i)}
            </div>
          ))}
          {caretIdx === documents.length && documents.length > 0 && (
            <div className="drop-caret" aria-hidden="true" />
          )}
        </div>
        <div className="jot">
          <input
            type="text"
            value={jot}
            placeholder={`Add a note to ${film.name} and press Enter`}
            aria-label="Add a note"
            onChange={(e) => setJot(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") jotNote();
            }}
          />
        </div>
      </main>

      {/* ---- Anchored menus ---- */}
      {menu?.kind === "overflow" && (
        <Menu anchor={menu.anchor} items={overflowItems} onClose={() => setMenu(null)} ariaLabel="More" />
      )}
      {menu?.kind === "new" && (
        <Menu anchor={menu.anchor} items={newItems} onClose={() => setMenu(null)} ariaLabel="Create" />
      )}
      {menuTargetRow && menu?.kind === "row" && (
        <Menu
          anchor={menu.anchor}
          items={rowItems(menuTargetRow)}
          onClose={() => setMenu(null)}
          ariaLabel="Project actions"
        />
      )}

      {/* ---- Move to (the keyboard path for filing) ---- */}
      {moveTarget && (
        <Modal title={`Move "${moveTarget.title}"`} onClose={() => setMoveTarget(null)}>
          <div className="move-list">
            <button
              type="button"
              className="move-item"
              onClick={() => {
                onSetFolder(moveTarget.id, null);
                setMoveTarget(null);
              }}
            >
              Loose (no film)
            </button>
            {moveTargets.map((f) => (
              <button
                key={f.id}
                type="button"
                className={"move-item" + (f.id === folder.id ? " move-current" : "")}
                onClick={() => {
                  onSetFolder(moveTarget.id, f.id);
                  setMoveTarget(null);
                }}
              >
                <span className="move-dot" style={{ background: f.color }} aria-hidden="true" />
                {f.name}
              </button>
            ))}
          </div>
        </Modal>
      )}

      {/* ---- Delete a draft or document ---- */}
      {confirmDelete && (
        <Modal
          title="Delete project"
          onClose={() => setConfirmDelete(null)}
          actions={[
            { label: "Cancel", onClick: () => setConfirmDelete(null) },
            {
              label: "Delete",
              variant: "danger",
              onClick: () => {
                onDelete(confirmDelete.id);
                setConfirmDelete(null);
              },
            },
          ]}
        >
          <p>Delete &quot;{confirmDelete.title}&quot;? This cannot be undone.</p>
        </Modal>
      )}
    </div>
  );
}
