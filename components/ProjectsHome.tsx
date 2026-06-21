"use client";

import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import type { JSONContent } from "@tiptap/core";
import type { Prefs } from "@/lib/storage/localStore";
import {
  DEFAULT_HOME_VIEW,
  loadHomeView,
  saveHomeView,
  type HomeSort,
} from "@/lib/storage/localStore";
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
  toggleFolderCollapsed,
  stageOfStatus,
  FOLDER_COLORS,
  STAGE_LABEL,
  STAGE_ORDER,
  type Folder,
  type Stage,
} from "@/lib/storage/folders";
import { SCREENPLAY_TEMPLATES, buildTemplate } from "@/lib/editor/templates";
import { hasTitlePage, type TitlePage } from "@/lib/export/titlePage";

// The three document stages, relabeled over the underlying status values so the
// vocabulary matches the folder stages without a data migration.
const DOC_STAGE_OPTIONS: { value: ProjectStatus; label: string }[] = [
  { value: "not_started", label: "Idea" },
  { value: "writing", label: "In progress" },
  { value: "done", label: "Completed" },
];

const SORT_LABEL: Record<HomeSort, string> = {
  updated: "Recently updated",
  title: "Title (A to Z)",
  created: "Date created",
};
const SORT_OPTIONS: HomeSort[] = ["updated", "title", "created"];

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

  // Folders (device-local). Reloaded from storage after each change.
  const [folders, setFolders] = useState<Folder[]>([]);
  const reloadFolders = () => setFolders(listFolders());
  useEffect(reloadFolders, []);

  const [tools, setTools] = useState<string | null>(null); // folder id whose tools are open
  const [confirmDeleteFolder, setConfirmDeleteFolder] = useState<Folder | null>(null);

  // Drag-and-drop bookkeeping. Refs hold what is being dragged; state drives the
  // drop highlight. dragKind distinguishes filing a document from reordering a
  // folder so the same drop zones can serve both.
  const dragKind = useRef<null | "doc" | "folder">(null);
  const dragId = useRef<string | null>(null);
  const [fileTarget, setFileTarget] = useState<string | null>(null); // folderId | "unfiled"
  const [reorderTarget, setReorderTarget] = useState<string | null>(null);
  const clearDrag = () => {
    dragKind.current = null;
    dragId.current = null;
    setFileTarget(null);
    setReorderTarget(null);
  };

  // Sort is the only home view pref still used (folders carry their own collapse).
  const [homeView, setHomeView] = useState(DEFAULT_HOME_VIEW);
  useEffect(() => setHomeView(loadHomeView()), []);
  const setSort = (sort: HomeSort) =>
    setHomeView((v) => {
      const next = { ...v, sort };
      saveHomeView(next);
      return next;
    });

  useEffect(() => {
    if (renaming) renameRef.current?.focus();
  }, [renaming]);

  const continueProject =
    lastOpenedId != null ? projects.find((p) => p.id === lastOpenedId) ?? null : null;

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

  const sortItems = (list: ProjectMeta[]): ProjectMeta[] => {
    const arr = [...list];
    if (homeView.sort === "title") {
      arr.sort((a, b) => a.title.localeCompare(b.title));
    } else if (homeView.sort === "created") {
      arr.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    } else {
      arr.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
    }
    return arr;
  };

  const addFolder = () => {
    const f = createFolder();
    reloadFolders();
    setTools(f.id); // open its tools so the user can name and color it
  };

  const removeFolder = (f: Folder) => {
    // Move its documents back to Unfiled through the hook so the list refreshes;
    // the folder itself is then removed. Documents are never deleted.
    projects.filter((p) => p.folderId === f.id).forEach((p) => onSetFolder(p.id, null));
    deleteFolder(f.id);
    reloadFolders();
    setConfirmDeleteFolder(null);
    setTools(null);
  };

  const docRow = (p: ProjectMeta) => {
    const stage = stageOfStatus(p.status);
    return (
      <div
        key={p.id}
        className="doc-row"
        draggable
        onDragStart={(e) => {
          dragKind.current = "doc";
          dragId.current = p.id;
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", p.id);
        }}
        onDragEnd={clearDrag}
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
        <span className="doc-grip" aria-hidden="true">⠿</span>
        {renaming === p.id ? (
          <input
            ref={renameRef}
            className="doc-rename"
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
          <span className="doc-title">{p.title}</span>
        )}
        <span className={"badge badge-" + p.type}>{typeLabel(p.type)}</span>
        <select
          className={"doc-stage stage-" + stage}
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
        <span className="doc-meta">{relativeTime(p.updatedAt)}</span>
        <span className="doc-actions" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="tb-btn"
            onClick={() => {
              setRenameDraft(p.title);
              setRenaming(p.id);
            }}
          >
            Rename
          </button>
          <button type="button" className="tb-btn tb-btn-danger" onClick={() => setConfirmDelete(p)}>
            Delete
          </button>
        </span>
      </div>
    );
  };

  const folderCard = (f: Folder) => {
    const items = sortItems(projects.filter((p) => p.folderId === f.id));
    const collapsed = Boolean(f.collapsed);
    const toolsOpen = tools === f.id;
    return (
      <section
        key={f.id}
        className={
          "folder-card" +
          (fileTarget === f.id ? " folder-drop" : "") +
          (reorderTarget === f.id ? " folder-reorder" : "")
        }
        onDragOver={(e) => {
          if (dragKind.current === "doc") {
            e.preventDefault();
            setFileTarget(f.id);
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target && fileTarget === f.id) setFileTarget(null);
        }}
        onDrop={(e) => {
          if (dragKind.current === "doc" && dragId.current) {
            e.preventDefault();
            onSetFolder(dragId.current, f.id);
          }
          clearDrag();
        }}
      >
        <div
          className="folder-head"
          draggable
          onDragStart={(e) => {
            dragKind.current = "folder";
            dragId.current = f.id;
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", f.id);
          }}
          onDragEnd={clearDrag}
          onDragOver={(e) => {
            if (dragKind.current === "folder" && dragId.current !== f.id) {
              e.preventDefault();
              setReorderTarget(f.id);
            }
          }}
          onDrop={(e) => {
            if (dragKind.current === "folder" && dragId.current && dragId.current !== f.id) {
              e.preventDefault();
              const ids = folders.map((x) => x.id).filter((x) => x !== dragId.current);
              const at = ids.indexOf(f.id);
              ids.splice(at < 0 ? ids.length : at, 0, dragId.current);
              reorderFolders(ids);
              reloadFolders();
            }
            clearDrag();
          }}
        >
          <button
            type="button"
            className="folder-toggle"
            aria-expanded={!collapsed}
            onClick={() => {
              toggleFolderCollapsed(f.id);
              reloadFolders();
            }}
            title={collapsed ? "Expand" : "Collapse"}
          >
            <svg
              className={"home-chevron" + (collapsed ? " home-chevron-collapsed" : "")}
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          <span className="folder-dot" style={{ background: f.color }} aria-hidden="true" />
          <span className="folder-name">{f.name}</span>
          <span className={"stage-chip stage-" + f.stage}>{STAGE_LABEL[f.stage]}</span>
          <span className="folder-count">{items.length}</span>
          <button
            type="button"
            className={"folder-tools-btn" + (toolsOpen ? " tb-btn-active" : "")}
            onClick={() => setTools(toolsOpen ? null : f.id)}
            aria-label="Folder options"
            title="Folder options"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="12" r="1.6" />
              <circle cx="12" cy="12" r="1.6" />
              <circle cx="19" cy="12" r="1.6" />
            </svg>
          </button>
        </div>

        {toolsOpen && (
          <div className="folder-tools">
            <input
              className="folder-name-input"
              value={f.name}
              onChange={(e) => {
                updateFolder(f.id, { name: e.target.value });
                reloadFolders();
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
                  onClick={() => {
                    updateFolder(f.id, { color: c });
                    reloadFolders();
                  }}
                  aria-label={"Color " + c}
                />
              ))}
            </div>
            <select
              className="folder-stage-select"
              value={f.stage}
              onChange={(e) => {
                updateFolder(f.id, { stage: e.target.value as Stage });
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
              onClick={() => setConfirmDeleteFolder(f)}
            >
              Delete folder
            </button>
          </div>
        )}

        {!collapsed && (
          <div className="folder-body">
            {items.length === 0 ? (
              <div className="folder-empty">Drag projects here, or this folder is empty.</div>
            ) : (
              items.map(docRow)
            )}
          </div>
        )}
      </section>
    );
  };

  const unfiled = sortItems(projects.filter((p) => !p.folderId));

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
          {projects.length > 0 && (
            <select
              className="tb-select"
              value={homeView.sort}
              onChange={(e) => setSort(e.target.value as HomeSort)}
              title="Sort projects"
              aria-label="Sort projects"
            >
              {SORT_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {SORT_LABEL[s]}
                </option>
              ))}
            </select>
          )}
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
              Start a screenplay or a plain document, and group your work into folders.
              Everything is saved on this device, and syncs when you sign in.
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

            {folders.map(folderCard)}

            <section
              className={"unfiled-section" + (fileTarget === "unfiled" ? " folder-drop" : "")}
              onDragOver={(e) => {
                if (dragKind.current === "doc") {
                  e.preventDefault();
                  setFileTarget("unfiled");
                }
              }}
              onDragLeave={(e) => {
                if (e.currentTarget === e.target && fileTarget === "unfiled") setFileTarget(null);
              }}
              onDrop={(e) => {
                if (dragKind.current === "doc" && dragId.current) {
                  e.preventDefault();
                  onSetFolder(dragId.current, null);
                }
                clearDrag();
              }}
            >
              <div className="unfiled-title">
                Unfiled <span className="folder-count">{unfiled.length}</span>
              </div>
              <div className="folder-body">
                {unfiled.length === 0 ? (
                  <div className="folder-empty">Everything is filed into a folder.</div>
                ) : (
                  unfiled.map(docRow)
                )}
              </div>
            </section>
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
              back to Unfiled. Nothing is deleted.
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
