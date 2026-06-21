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
  listFolders,
  createFolder,
  updateFolder,
  deleteFolder,
  reorderFolders,
  stageOfStatus,
  FOLDER_COLORS,
  STAGE_LABEL,
  STAGE_ORDER,
  type Folder,
  type Stage,
} from "@/lib/storage/folders";
import { SCREENPLAY_TEMPLATES, buildTemplate } from "@/lib/editor/templates";
import { hasTitlePage, type TitlePage } from "@/lib/export/titlePage";

const DOC_STAGE_OPTIONS: { value: ProjectStatus; label: string }[] = [
  { value: "not_started", label: "Idea" },
  { value: "writing", label: "In progress" },
  { value: "done", label: "Completed" },
];

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

function FolderGlyph({ color }: { color: string }) {
  return (
    <svg className="folder-glyph" width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill={color}
        d="M3 6a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
      />
    </svg>
  );
}

export function ProjectsHome({
  projects,
  user,
  cloudConfigured,
  prefs,
  onPrefsChange,
  lastOpenedId,
  onOpen,
  onCreate,
  onDelete,
  onRename,
  onStatusChange,
  onSetFolder,
  onReorder,
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
    opts?: { content?: JSONContent; titlePage?: TitlePage | null; pageTarget?: number }
  ) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onStatusChange: (id: string, status: ProjectStatus) => void;
  onSetFolder: (id: string, folderId: string | null) => void;
  onReorder: (orderedIds: string[]) => void;
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

  const [folders, setFolders] = useState<Folder[]>([]);
  const reloadFolders = () => setFolders(listFolders());
  useEffect(reloadFolders, []);

  const [openFolder, setOpenFolder] = useState<string | null>(null);
  const [confirmDeleteFolder, setConfirmDeleteFolder] = useState<Folder | null>(null);

  // Drag bookkeeping. Refs hold the dragged item; dropHi drives the highlight.
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

  const continueProject =
    lastOpenedId != null ? projects.find((p) => p.id === lastOpenedId) ?? null : null;

  const byOrder = (a: ProjectMeta, b: ProjectMeta) =>
    (a.order ?? Infinity) - (b.order ?? Infinity) ||
    (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0);

  const chipsIn = (folderId: string | null) =>
    projects.filter((p) => (p.folderId ?? null) === folderId).sort(byOrder);

  // Move a project into a container (folder id or null for loose), appended last.
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

  // Drop a project before another chip: file into that chip's container (if
  // needed) and order it just before the target.
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

  const addFolder = () => {
    const f = createFolder();
    reloadFolders();
    setOpenFolder(f.id);
  };

  const removeFolder = (f: Folder) => {
    projects.filter((p) => p.folderId === f.id).forEach((p) => onSetFolder(p.id, null));
    deleteFolder(f.id);
    reloadFolders();
    setConfirmDeleteFolder(null);
    if (openFolder === f.id) setOpenFolder(null);
  };

  const projectChip = (p: ProjectMeta) => {
    const stage = stageOfStatus(p.status);
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
        <div className="chip-meta">
          <span className={"badge badge-" + p.type}>{typeLabel(p.type)}</span>
          <select
            className={"chip-stage stage-" + stage}
            value={p.status}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onStatusChange(p.id, e.target.value as ProjectStatus)}
            aria-label="Stage"
          >
            {DOC_STAGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
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

  const folderTile = (f: Folder) => {
    const count = projects.filter((p) => p.folderId === f.id).length;
    return (
      <div
        key={f.id}
        className={
          "folder-tile" +
          (dropHi === "folder:" + f.id ? " folder-tile-drop" : "") +
          (dropHi === "freorder:" + f.id ? " folder-tile-reorder" : "") +
          (openFolder === f.id ? " folder-tile-open" : "")
        }
        draggable
        onDragStart={(e) => {
          dragKind.current = "folder";
          dragId.current = f.id;
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", f.id);
        }}
        onDragEnd={clearDrag}
        onDragOver={(e) => {
          if (dragKind.current === "project") {
            e.preventDefault();
            setDropHi("folder:" + f.id);
          } else if (dragKind.current === "folder" && dragId.current !== f.id) {
            e.preventDefault();
            setDropHi("freorder:" + f.id);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (dragKind.current === "project" && dragId.current) {
            fileInto(dragId.current, f.id);
          } else if (dragKind.current === "folder" && dragId.current && dragId.current !== f.id) {
            const ids = folders.map((x) => x.id).filter((x) => x !== dragId.current);
            const at = ids.indexOf(f.id);
            ids.splice(at < 0 ? ids.length : at, 0, dragId.current);
            reorderFolders(ids);
            reloadFolders();
          }
          clearDrag();
        }}
        onClick={() => setOpenFolder(openFolder === f.id ? null : f.id)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpenFolder(openFolder === f.id ? null : f.id);
          }
        }}
        title={count === 1 ? "1 project" : `${count} projects`}
      >
        <div className="folder-tile-top">
          <FolderGlyph color={f.color} />
          <span className="folder-tile-count">{count}</span>
        </div>
        <div className="folder-tile-name">{f.name}</div>
        <span className={"stage-chip stage-" + f.stage}>{STAGE_LABEL[f.stage]}</span>
      </div>
    );
  };

  const loose = chipsIn(null);
  const open = folders.find((f) => f.id === openFolder) ?? null;
  const openChips = open ? chipsIn(open.id) : [];

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
          <select
            className="tb-select"
            value={prefs.font}
            onChange={(e) => onPrefsChange({ font: e.target.value as Prefs["font"] })}
            title="Font"
          >
            <option value="courier-prime">Courier Prime</option>
            <option value="courier">Courier</option>
          </select>
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
        <button type="button" className="tb-btn" onClick={addFolder} title="Create a folder">
          New folder
        </button>
        <button type="button" className="tb-btn tb-btn-active home-new" onClick={() => setShowNew(true)}>
          New project
        </button>
      </div>

      <div className="home-body">
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
            {continueProject && (
              <div className="home-continue">
                <div className="home-continue-label">Continue</div>
                <div className="project-card" onClick={() => onOpen(continueProject.id)} role="button" tabIndex={0}>
                  <div className="project-card-head">
                    <span className="project-card-title">{continueProject.title}</span>
                    <span className={"badge badge-" + continueProject.type}>
                      {typeLabel(continueProject.type)}
                    </span>
                  </div>
                  <div className="project-meta">Opened {relativeTime(continueProject.updatedAt)}</div>
                </div>
              </div>
            )}

            <div className="home-sec-label">Projects</div>
            <div
              className={"chip-grid" + (dropHi === "loose" ? " grid-drop" : "")}
              onDragOver={(e) => {
                if (dragKind.current === "project") {
                  e.preventDefault();
                  setDropHi("loose");
                }
              }}
              onDrop={(e) => {
                if (dragKind.current === "project" && dragId.current) {
                  e.preventDefault();
                  fileInto(dragId.current, null);
                }
                clearDrag();
              }}
            >
              {loose.length === 0 ? (
                <div className="chip-grid-empty">Every project is filed into a folder.</div>
              ) : (
                loose.map(projectChip)
              )}
            </div>

            {folders.length > 0 && (
              <>
                <div className="home-sec-label">Folders</div>
                <div className="folder-grid">{folders.map(folderTile)}</div>
              </>
            )}

            {open && (
              <div className="open-folder">
                <div className="open-folder-head">
                  <span className="folder-dot" style={{ background: open.color }} aria-hidden="true" />
                  <input
                    className="folder-name-input"
                    value={open.name}
                    onChange={(e) => {
                      updateFolder(open.id, { name: e.target.value });
                      reloadFolders();
                    }}
                    aria-label="Folder name"
                  />
                  <div className="folder-swatches" role="group" aria-label="Folder color">
                    {FOLDER_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={"swatch" + (open.color === c ? " swatch-on" : "")}
                        style={{ background: c }}
                        onClick={() => {
                          updateFolder(open.id, { color: c });
                          reloadFolders();
                        }}
                        aria-label={"Color " + c}
                      />
                    ))}
                  </div>
                  <select
                    className="folder-stage-select"
                    value={open.stage}
                    onChange={(e) => {
                      updateFolder(open.id, { stage: e.target.value as Stage });
                      reloadFolders();
                    }}
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
                    className="tb-btn tb-btn-danger"
                    onClick={() => setConfirmDeleteFolder(open)}
                  >
                    Delete
                  </button>
                  <button type="button" className="tb-btn" onClick={() => setOpenFolder(null)}>
                    Close
                  </button>
                </div>
                <div
                  className={"chip-grid open-folder-grid" + (dropHi === "open" ? " grid-drop" : "")}
                  onDragOver={(e) => {
                    if (dragKind.current === "project") {
                      e.preventDefault();
                      setDropHi("open");
                    }
                  }}
                  onDrop={(e) => {
                    if (dragKind.current === "project" && dragId.current) {
                      e.preventDefault();
                      fileInto(dragId.current, open.id);
                    }
                    clearDrag();
                  }}
                >
                  {openChips.length === 0 ? (
                    <div className="chip-grid-empty">
                      Drag projects from above onto this folder to add them here.
                    </div>
                  ) : (
                    openChips.map(projectChip)
                  )}
                </div>
              </div>
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

      {confirmDeleteFolder && (
        <div className="modal-backdrop" onClick={() => setConfirmDeleteFolder(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">Delete folder</h2>
            <p className="modal-text">
              Delete the folder &quot;{confirmDeleteFolder.name}&quot;? The projects inside move
              back out to your loose projects. Nothing is deleted.
            </p>
            <div className="modal-actions">
              <button type="button" className="tb-btn" onClick={() => setConfirmDeleteFolder(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="tb-btn tb-btn-danger"
                onClick={() => removeFolder(confirmDeleteFolder)}
              >
                Delete folder
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
