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
import { folderView, listLibrary } from "@/lib/storage/library";
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
  onOpenFolder,
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
  /** Open another folder's page: the breadcrumb and the sub-folder headings. */
  onOpenFolder: (folderId: string) => void;
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
  // Any folder has a page, at any depth: this is the writer's own folder,
  // not a reinterpretation of it.
  const film = useMemo(
    () => folderView(folder.id, projects, folders),
    [folder.id, projects, folders]
  );

  // AppShell already guards unknown folder ids; this catches the folder being
  // deleted while its page is open.
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

  // This folder's own scripts, newest first: the first one is what "Continue"
  // opens. Scripts filed in sub-folders belong to those sub-folders, and are
  // listed under their own names further down.
  const ownScripts = useMemo(
    () => (film?.items ?? []).filter((p) => p.type === "screenplay"),
    [film]
  );
  const draft = ownScripts[0] ?? null;
  const earlier = ownScripts.slice(1);

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
    const docs = (film?.items ?? []).filter((p) => p.type === "plain");
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

  // Move targets are every folder the writer has, shown with their path so two
  // folders with the same name are still telling apart. Moving out to "not in a
  // folder" uses the same one filing handler.
  const moveTargets = useMemo(() => {
    const out: { folder: Folder; path: string }[] = [];
    const walk = (parentId: string | undefined, path: string) => {
      for (const f of folders.filter((c) => (c.parentId ?? undefined) === parentId)) {
        out.push({ folder: f, path });
        walk(f.id, path ? `${path} / ${f.name}` : f.name);
      }
    };
    walk(undefined, "");
    return out;
  }, [folders]);

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
            <span className="pp-mark" style={{ background: folder.color }} aria-hidden="true" />
            {film.trail.length > 0 ? (
              film.trail.map((up) => (
                <button
                  key={up.id}
                  type="button"
                  className="pp-crumb"
                  onClick={() => onOpenFolder(up.id)}
                >
                  {up.name}
                </button>
              ))
            ) : (
              <span className="pp-kind">Folder</span>
            )}
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
            aria-label="Folder name"
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
                  {draft.pageCount != null
                    ? `, ${draft.pageCount} page${draft.pageCount === 1 ? "" : "s"}`
                    : ""}
                </button>
                <span className="pp-sep" aria-hidden="true">
                  &middot;
                </span>
              </>
            )}
            <span>
              {film.total} item{film.total === 1 ? "" : "s"}
            </span>
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
          {documents.length === 0 && <p className="list-empty">No documents in here yet.</p>}
        </div>

        {/* Sub-folders keep their own names and their own pages: this folder
            shows what it holds, never what its children hold. */}
        {film.shelves
          .filter((sh) => sh.depth === 1)
          .map((sh) => (
            <div key={sh.folder.id}>
              <div className="band band-later">
                <button
                  type="button"
                  className="band-name"
                  onClick={() => onOpenFolder(sh.folder.id)}
                >
                  {sh.folder.name}
                </button>
              </div>
              {sh.items.map(draftRow)}
              {(() => {
                const deeper = film.shelves.filter(
                  (d) => d.depth > 1 && d.folder.parentId === sh.folder.id
                );
                const buried = deeper.reduce((n, d) => n + d.items.length, 0);
                return deeper.length > 0 ? (
                  <button
                    type="button"
                    className="mline"
                    onClick={() => onOpenFolder(sh.folder.id)}
                  >
                    {deeper.length} folder{deeper.length === 1 ? "" : "s"} deeper, holding{" "}
                    {buried} item{buried === 1 ? "" : "s"}
                  </button>
                ) : null;
              })()}
            </div>
          ))}
        <div className="jot">
          <input
            type="text"
            value={jot}
            placeholder={`Add a note to ${folder.name} and press Enter`}
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
              Not in a folder
            </button>
            {moveTargets.map(({ folder: f, path }) => (
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
                {path && <span className="move-path">{path}</span>}
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
