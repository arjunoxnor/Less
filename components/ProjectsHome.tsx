"use client";

import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import type { JSONContent } from "@tiptap/core";
import type { Prefs } from "@/lib/storage/localStore";
import type {
  ProjectMeta,
  ProjectStatus,
  ProjectType,
} from "@/lib/storage/projects";
import {
  FOLDER_COLORS,
  STAGE_LABEL,
  STAGE_ORDER,
  type Folder,
  type Stage,
} from "@/lib/storage/folders";
import { SCREENPLAY_TEMPLATES, buildTemplate } from "@/lib/editor/templates";
import { hasTitlePage, type TitlePage } from "@/lib/export/titlePage";

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} ${hrs === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days} ${days === 1 ? "day" : "days"} ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function typeLabel(type: ProjectType): string {
  return type === "plain" ? "Document" : "Screenplay";
}

/** A document (page) or screenplay (clapperboard) glyph, tinted by `color`. */
function TypeIcon({ type, color }: { type: ProjectType; color: string }) {
  return (
    <svg
      className="chip-icon"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color }}
      role="img"
      aria-label={typeLabel(type)}
    >
      {type === "plain" ? (
        <>
          <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
          <polyline points="14 3 14 9 20 9" />
          <line x1="8" y1="13" x2="16" y2="13" />
          <line x1="8" y1="17" x2="13" y2="17" />
        </>
      ) : (
        <>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="3" y1="8.5" x2="21" y2="8.5" />
          <line x1="7.5" y1="3" x2="5.5" y2="8.5" />
          <line x1="12.5" y1="3" x2="10.5" y2="8.5" />
          <line x1="17.5" y1="3" x2="15.5" y2="8.5" />
        </>
      )}
    </svg>
  );
}

/**
 * Press-and-hold to confirm a destructive action. The bar fills over ~2s; let
 * go early and nothing happens. Deliberately harder than a single click so a
 * folder is never deleted by accident.
 */
function HoldDelete({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };
  const start = () => {
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setHolding(false);
      onConfirm();
    }, 2000);
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (
    <span className="hold-del">
      <button
        type="button"
        className={"hold-btn" + (holding ? " holding" : "")}
        onPointerDown={start}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onPointerCancel={cancel}
      >
        <span className="hold-fill" />
        <span className="hold-label">{holding ? "Keep holding" : "Hold to delete"}</span>
      </button>
      <button type="button" className="hold-cancel" title="Cancel" onClick={onCancel}>
        ×
      </button>
    </span>
  );
}

export function ProjectsHome({
  projects,
  user,
  cloudConfigured,
  prefs,
  onPrefsChange,
  onOpen,
  onCreate,
  onDelete,
  onRename,
  onSetFolder,
  onReorder,
  folders,
  onCreateFolder,
  onUpdateFolder,
  onDeleteFolder,
  onReorderFolders,
  onToggleFolder,
  onSignIn,
  onSignOut,
}: {
  projects: ProjectMeta[];
  user: User | null;
  cloudConfigured: boolean;
  prefs: Prefs;
  onPrefsChange: (next: Partial<Prefs>) => void;
  lastOpenedId: string | null;
  onOpen: (id: string) => void;
  onCreate: (
    type: ProjectType,
    title: string,
    opts?: {
      content?: JSONContent;
      titlePage?: TitlePage | null;
      pageTarget?: number;
      folderId?: string | null;
    }
  ) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onStatusChange: (id: string, status: ProjectStatus) => void;
  onSetFolder: (id: string, folderId: string | null) => void;
  onReorder: (orderedIds: string[]) => void;
  folders: Folder[];
  onCreateFolder: (parentId?: string) => Folder;
  onUpdateFolder: (
    id: string,
    patch: { name?: string; color?: string; stage?: Stage; collapsed?: boolean; parentId?: string | null }
  ) => void;
  onDeleteFolder: (id: string) => void;
  onReorderFolders: (orderedIds: string[]) => void;
  onToggleFolder: (id: string) => void;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  const [showNew, setShowNew] = useState(false);
  const [newType, setNewType] = useState<ProjectType>("screenplay");
  const [newName, setNewName] = useState("");
  const [newTemplate, setNewTemplate] = useState("blank");
  const [newWrittenBy, setNewWrittenBy] = useState("");
  const [newPageTarget, setNewPageTarget] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<ProjectMeta | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);

  // Editing a folder (name/color/stage) is off by default and opened only from
  // the pencil button, then closed with Done. `deleting` is the folder whose
  // hold-to-confirm delete is currently armed.
  const [editing, setEditing] = useState<Set<string>>(new Set());
  const openEdit = (id: string) => setEditing((p) => new Set(p).add(id));
  const closeEdit = (id: string) =>
    setEditing((p) => {
      const n = new Set(p);
      n.delete(id);
      return n;
    });
  const [deleting, setDeleting] = useState<string | null>(null);

  const dragKind = useRef<null | "project" | "folder">(null);
  const dragId = useRef<string | null>(null);
  const [dropHi, setDropHi] = useState<string | null>(null);
  const clearDrag = () => {
    dragKind.current = null;
    dragId.current = null;
    setDropHi(null);
  };

  useEffect(() => {
    if (renaming) renameRef.current?.focus();
  }, [renaming]);

  const byOrder = (a: ProjectMeta, b: ProjectMeta) =>
    (a.order ?? Infinity) - (b.order ?? Infinity) ||
    (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0);

  // Orphan-safe: a folderId/parentId pointing at a folder we do not have is
  // treated as top level, so nothing vanishes.
  const folderExists = (id?: string) => !!id && folders.some((f) => f.id === id);
  const effFolderId = (p: ProjectMeta) => (folderExists(p.folderId) ? p.folderId! : null);
  const effParentId = (f: Folder) => (folderExists(f.parentId) ? f.parentId! : null);

  const chipsIn = (folderId: string | null) =>
    projects.filter((p) => effFolderId(p) === folderId).sort(byOrder);
  const subfolders = (parentId: string | null) =>
    folders.filter((f) => effParentId(f) === parentId).sort((a, b) => a.order - b.order);

  const isAncestor = (ancestorId: string, nodeId: string): boolean => {
    const seen = new Set<string>();
    let c: Folder | undefined = folders.find((f) => f.id === nodeId);
    while (c && !seen.has(c.id)) {
      if (c.id === ancestorId) return true;
      seen.add(c.id);
      c = c.parentId ? folders.find((f) => f.id === c!.parentId) : undefined;
    }
    return false;
  };

  const fileInto = (id: string, folderId: string | null) => {
    const cur = projects.find((p) => p.id === id);
    if ((cur?.folderId ?? null) === folderId) return;
    const ids = chipsIn(folderId)
      .map((p) => p.id)
      .filter((x) => x !== id);
    ids.push(id);
    onSetFolder(id, folderId);
    onReorder(ids);
  };

  const moveBefore = (id: string, target: ProjectMeta) => {
    if (id === target.id) return;
    const container = target.folderId ?? null;
    const ids = chipsIn(container)
      .map((p) => p.id)
      .filter((x) => x !== id);
    const at = ids.indexOf(target.id);
    ids.splice(at < 0 ? ids.length : at, 0, id);
    const cur = projects.find((p) => p.id === id);
    if ((cur?.folderId ?? null) !== container) onSetFolder(id, container);
    onReorder(ids);
  };

  const nestFolder = (id: string, parentId: string | null) => {
    if (id === parentId) return;
    if (parentId && isAncestor(id, parentId)) return;
    onUpdateFolder(id, { parentId });
  };

  // Drop folder `id` just before `target`, as a sibling (re-parenting if needed).
  const moveFolderBefore = (id: string, target: Folder) => {
    if (id === target.id) return;
    const parent = effParentId(target);
    if (parent && isAncestor(id, parent)) return; // would nest a folder under itself
    const dragged = folders.find((f) => f.id === id);
    if ((dragged?.parentId ?? null) !== parent) onUpdateFolder(id, { parentId: parent });
    const ids = subfolders(parent)
      .map((f) => f.id)
      .filter((x) => x !== id);
    const at = ids.indexOf(target.id);
    ids.splice(at < 0 ? ids.length : at, 0, id);
    onReorderFolders(ids);
  };

  const create = () => {
    const content =
      newType === "screenplay" && newTemplate !== "blank"
        ? buildTemplate(newTemplate) ?? undefined
        : undefined;
    let titlePage: TitlePage | undefined;
    let pageTarget: number | undefined;
    if (newType === "screenplay") {
      const name = newName.trim();
      const wb = newWrittenBy.trim();
      const tp: TitlePage = {
        title: name || undefined,
        credit: wb ? "Written by" : undefined,
        author: wb || undefined,
      };
      if (hasTitlePage(tp)) titlePage = tp;
      const pt = parseInt(newPageTarget, 10);
      if (!Number.isNaN(pt) && pt > 0) pageTarget = pt;
    }
    onCreate(newType, newName.trim(), { content, titlePage, pageTarget });
    setShowNew(false);
    setNewName("");
    setNewType("screenplay");
    setNewTemplate("blank");
    setNewWrittenBy("");
    setNewPageTarget("");
  };

  const commitRename = (id: string) => {
    const next = renameDraft.trim();
    const cur = projects.find((p) => p.id === id);
    if (next && cur && next !== cur.title) onRename(id, next);
    setRenaming(null);
  };

  const addFolder = (parentId?: string) => {
    const f = onCreateFolder(parentId);
    // Make sure the parent is open so the new sub-folder is visible.
    if (parentId && folders.find((x) => x.id === parentId)?.collapsed !== false) {
      onToggleFolder(parentId);
    }
    openEdit(f.id); // open edit once so it can be named, with a Done to close
  };

  const removeFolder = (f: Folder) => {
    folders.filter((sf) => sf.parentId === f.id).forEach((sf) =>
      onUpdateFolder(sf.id, { parentId: f.parentId ?? null })
    );
    projects.filter((p) => p.folderId === f.id).forEach((p) =>
      onSetFolder(p.id, f.parentId ?? null)
    );
    onDeleteFolder(f.id);
    setDeleting(null);
  };

  const projectChip = (p: ProjectMeta) => {
    // The type glyph is tinted with the colour of the folder the project lives
    // in (a neutral tone when it is loose at the top level).
    const fid = effFolderId(p);
    const iconColor =
      (fid ? folders.find((f) => f.id === fid)?.color : null) ?? "var(--muted)";
    return (
      <div
        key={p.id}
        className={"chip" + (dropHi === "chip:" + p.id ? " chip-drop" : "")}
        draggable={renaming !== p.id}
        onDragStart={(e) => {
          dragKind.current = "project";
          dragId.current = p.id;
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", p.id);
        }}
        onDragEnd={clearDrag}
        onDragOver={(e) => {
          if (dragKind.current === "project" && dragId.current !== p.id) {
            e.preventDefault();
            e.stopPropagation();
            setDropHi("chip:" + p.id);
          }
        }}
        onDrop={(e) => {
          if (dragKind.current === "project" && dragId.current) {
            e.preventDefault();
            e.stopPropagation();
            moveBefore(dragId.current, p);
          }
          clearDrag();
        }}
        onClick={() => {
          if (renaming !== p.id) onOpen(p.id);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && renaming !== p.id) {
            e.preventDefault();
            onOpen(p.id);
          }
        }}
      >
        <div className="chip-head">
          <TypeIcon type={p.type} color={iconColor} />
          {renaming === p.id ? (
            <input
              ref={renameRef}
              className="chip-rename"
              value={renameDraft}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setRenameDraft(e.target.value)}
              onBlur={() => commitRename(p.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitRename(p.id);
                } else if (e.key === "Escape") {
                  setRenaming(null);
                }
              }}
            />
          ) : (
            <div className="chip-title">{p.title}</div>
          )}
        </div>
        <div className="chip-foot">
          <span className="chip-time">{relativeTime(p.updatedAt)}</span>
          <span className="chip-actions" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="chip-act"
              onClick={() => {
                setRenameDraft(p.title);
                setRenaming(p.id);
              }}
            >
              Rename
            </button>
            <button type="button" className="chip-act chip-act-danger" onClick={() => setConfirmDelete(p)}>
              Delete
            </button>
          </span>
        </div>
      </div>
    );
  };

  const folderNode = (f: Folder) => {
    const expanded = f.collapsed === false; // collapsed by default, so the home is a grid of boxes
    const subs = subfolders(f.id);
    const chips = chipsIn(f.id);
    const count = subs.length + chips.length;
    const isEditing = editing.has(f.id);
    return (
      <div
        key={f.id}
        className={
          "fcard" +
          (expanded || isEditing ? " fcard-open" : "") +
          (dropHi === "folder:" + f.id || dropHi === "into:" + f.id ? " fcard-drop" : "") +
          (dropHi === "before:" + f.id ? " fcard-before" : "")
        }
        style={{ borderLeftColor: f.color }}
        onDragOver={(e) => {
          // The whole card is a drop target. A dragged PROJECT files into it. A
          // dragged FOLDER reorders (when over the box) or nests (when dropped
          // inside the open body). Nested cards/chips stopPropagation.
          const k = dragKind.current;
          if (k === "project") {
            e.preventDefault();
            e.stopPropagation();
            setDropHi("folder:" + f.id);
          } else if (k === "folder" && dragId.current && dragId.current !== f.id && !isAncestor(dragId.current, f.id)) {
            e.preventDefault();
            e.stopPropagation();
            const inBody = !!(e.target as HTMLElement).closest(".fcard-body");
            setDropHi((inBody ? "into:" : "before:") + f.id);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (dragKind.current === "project" && dragId.current) {
            fileInto(dragId.current, f.id);
          } else if (dragKind.current === "folder" && dragId.current && dragId.current !== f.id) {
            const inBody = !!(e.target as HTMLElement).closest(".fcard-body");
            if (inBody) nestFolder(dragId.current, f.id);
            else moveFolderBefore(dragId.current, f);
          }
          clearDrag();
        }}
      >
        <div
          className="fcard-head"
          draggable
          title="Click to open or close. Drag to move."
          onClick={() => onToggleFolder(f.id)}
          onDragStart={(e) => {
            dragKind.current = "folder";
            dragId.current = f.id;
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", f.id);
          }}
          onDragEnd={clearDrag}
        >
          <div className="fcard-top">
            <svg className="fcard-icon" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
              <path fill={f.color} d="M3 6a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
            <div className="fcard-acts" onClick={(e) => e.stopPropagation()}>
              {deleting === f.id ? (
                <HoldDelete onConfirm={() => removeFolder(f)} onCancel={() => setDeleting(null)} />
              ) : (
                <>
                  <button type="button" className="fcard-btn" title="Rename / recolor" onClick={() => openEdit(f.id)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                    </svg>
                  </button>
                  <button type="button" className="fcard-btn" title="Add sub-folder" onClick={() => addFolder(f.id)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                      <line x1="12" y1="11" x2="12" y2="17" />
                      <line x1="9" y1="14" x2="15" y2="14" />
                    </svg>
                  </button>
                  <button type="button" className="fcard-btn fcard-btn-danger" title="Delete folder" onClick={() => setDeleting(f.id)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      <path d="M10 11v6M14 11v6" />
                      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                    </svg>
                  </button>
                </>
              )}
            </div>
          </div>
          <span className="fcard-name">{f.name || "Untitled folder"}</span>
          <div className="fcard-meta">
            <span className={"stage-chip stage-" + f.stage}>{STAGE_LABEL[f.stage]}</span>
            <span className="folder-count">
              {count} {count === 1 ? "item" : "items"}
            </span>
          </div>
        </div>

        {isEditing && (
          <div className="fcard-edit">
            <input
              className="folder-name-input"
              value={f.name}
              autoFocus
              onChange={(e) => onUpdateFolder(f.id, { name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onUpdateFolder(f.id, { name: f.name.trim() || "Untitled folder" });
                  closeEdit(f.id);
                }
              }}
              aria-label="Folder name"
            />
            <div className="folder-swatches" role="group" aria-label="Folder color">
              {FOLDER_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={"swatch" + (f.color === c ? " swatch-on" : "")}
                  style={{ background: c }}
                  onClick={() => onUpdateFolder(f.id, { color: c })}
                  aria-label={"Color " + c}
                />
              ))}
            </div>
            <select
              className="folder-stage-select"
              value={f.stage}
              onChange={(e) => onUpdateFolder(f.id, { stage: e.target.value as Stage })}
              aria-label="Folder stage"
            >
              {STAGE_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABEL[s]}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="tb-btn tb-btn-active"
              onClick={() => {
                onUpdateFolder(f.id, { name: f.name.trim() || "Untitled folder" });
                closeEdit(f.id);
              }}
            >
              Done
            </button>
          </div>
        )}

        {expanded && (
          <div className="fcard-body">
            {subs.length > 0 && <div className="fnode-list">{subs.map((s) => folderNode(s))}</div>}
            {chips.length > 0 && <div className="chip-grid">{chips.map(projectChip)}</div>}
            {count === 0 && (
              <div className="fnode-empty">Empty. Drag a project or folder here to add it.</div>
            )}
          </div>
        )}
      </div>
    );
  };

  const topFolders = subfolders(null);
  const loose = chipsIn(null);

  return (
    <div className="home">
      <div className="home-bar">
        <div className="toolbar-brand" title="Last Ever Screenwriting Software">
          LESS
        </div>
        <div className="toolbar-spacer" />
        {cloudConfigured &&
          (user ? (
            <div className="toolbar-group toolbar-account">
              <span className="account-email" title={user.email ?? ""}>
                {user.email}
              </span>
              <button type="button" className="tb-btn" onClick={onSignOut}>
                Sign out
              </button>
            </div>
          ) : (
            <button type="button" className="tb-btn" onClick={onSignIn} title="Sync across devices">
              Sign in to save
            </button>
          ))}
        <div className="toolbar-group">
          <button
            type="button"
            className="tb-btn"
            onClick={() =>
              onPrefsChange({
                theme:
                  prefs.theme === "light" ? "dark" : prefs.theme === "dark" ? "system" : "light",
              })
            }
            title="Theme: light, dark, or system. Click to cycle."
          >
            {prefs.theme === "system" ? "System" : prefs.theme === "dark" ? "Dark" : "Light"}
          </button>
        </div>
        <button type="button" className="tb-btn" onClick={() => addFolder()} title="Create a folder">
          New folder
        </button>
        <button type="button" className="tb-btn tb-btn-active home-new" onClick={() => setShowNew(true)}>
          New project
        </button>
      </div>

      <div
        className={"home-body" + (dropHi === "root" ? " root-drop" : "")}
        onDragOver={(e) => {
          if (dragKind.current === "project" || dragKind.current === "folder") {
            e.preventDefault();
            setDropHi("root");
          }
        }}
        onDrop={(e) => {
          if (dragKind.current === "project" && dragId.current) {
            e.preventDefault();
            fileInto(dragId.current, null);
          } else if (dragKind.current === "folder" && dragId.current) {
            e.preventDefault();
            nestFolder(dragId.current, null);
          }
          clearDrag();
        }}
      >
        {projects.length === 0 && folders.length === 0 ? (
          <div className="home-empty">
            <h2>No projects yet</h2>
            <p>
              Start a screenplay or a plain document, then make folders and drag projects into
              them. Everything is saved on this device, and syncs when you sign in.
            </p>
            <button type="button" className="tb-btn tb-btn-active" onClick={() => setShowNew(true)}>
              New project
            </button>
          </div>
        ) : (
          <>
            {loose.length > 0 && (
              <>
                <div className="home-sec-label">Loose projects</div>
                <div className="chip-grid">{loose.map(projectChip)}</div>
              </>
            )}

            {topFolders.length > 0 && (
              <>
                <div className="home-sec-label">Folders</div>
                <div className="fnode-list">{topFolders.map((f) => folderNode(f))}</div>
              </>
            )}
          </>
        )}
      </div>

      {showNew && (
        <div className="modal-backdrop" onClick={() => setShowNew(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">New project</h2>
            <label className="field">
              <span>Name</span>
              <input
                placeholder="Untitled"
                value={newName}
                autoFocus
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") create();
                }}
              />
            </label>
            <div className="field">
              <span>Type</span>
              <div className="status-seg" role="group" aria-label="Project type">
                <button
                  type="button"
                  className={"seg" + (newType === "screenplay" ? " seg-active" : "")}
                  onClick={() => setNewType("screenplay")}
                >
                  Screenplay
                </button>
                <button
                  type="button"
                  className={"seg" + (newType === "plain" ? " seg-active" : "")}
                  onClick={() => setNewType("plain")}
                >
                  Document
                </button>
              </div>
            </div>
            {newType === "screenplay" && (
              <label className="field">
                <span>Template</span>
                <select value={newTemplate} onChange={(e) => setNewTemplate(e.target.value)}>
                  {SCREENPLAY_TEMPLATES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}: {t.description}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {newType === "screenplay" && (
              <>
                <label className="field">
                  <span>Written by (optional)</span>
                  <input
                    placeholder="Your name"
                    value={newWrittenBy}
                    onChange={(e) => setNewWrittenBy(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Page target (optional)</span>
                  <input
                    type="number"
                    min="1"
                    placeholder="e.g. 110"
                    value={newPageTarget}
                    onChange={(e) => setNewPageTarget(e.target.value)}
                  />
                </label>
              </>
            )}
            <div className="modal-actions">
              <button type="button" className="tb-btn" onClick={() => setShowNew(false)}>
                Cancel
              </button>
              <button type="button" className="tb-btn modal-primary" onClick={create}>
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="modal-backdrop" onClick={() => setConfirmDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">Delete project</h2>
            <p className="modal-text">
              Delete &quot;{confirmDelete.title}&quot;? This cannot be undone.
            </p>
            <div className="modal-actions">
              <button type="button" className="tb-btn" onClick={() => setConfirmDelete(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="tb-btn tb-btn-danger"
                onClick={() => {
                  onDelete(confirmDelete.id);
                  setConfirmDelete(null);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
