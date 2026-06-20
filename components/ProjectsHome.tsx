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
import { SCREENPLAY_TEMPLATES, buildTemplate } from "@/lib/editor/templates";

const STATUS_LABEL: Record<ProjectStatus, string> = {
  not_started: "Not started",
  writing: "Writing",
  done: "Done",
};
// Writing first for re-entry ergonomics, then Not started, then Done.
const SECTION_ORDER: ProjectStatus[] = ["writing", "not_started", "done"];
const SECTION_EMPTY: Record<ProjectStatus, string> = {
  writing: "Nothing in progress yet.",
  not_started: "Nothing waiting to start.",
  done: "Nothing finished yet.",
};
const STATUS_SEG: ProjectStatus[] = ["not_started", "writing", "done"];

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
  onCreate: (type: ProjectType, title: string, content?: JSONContent) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onStatusChange: (id: string, status: ProjectStatus) => void;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  const [showNew, setShowNew] = useState(false);
  const [newType, setNewType] = useState<ProjectType>("screenplay");
  const [newName, setNewName] = useState("");
  const [newTemplate, setNewTemplate] = useState("blank");
  const [confirmDelete, setConfirmDelete] = useState<ProjectMeta | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);

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
    onCreate(newType, newName.trim(), content);
    setShowNew(false);
    setNewName("");
    setNewType("screenplay");
    setNewTemplate("blank");
  };

  const commitRename = (id: string) => {
    const next = renameDraft.trim();
    const cur = projects.find((p) => p.id === id);
    if (next && cur && next !== cur.title) onRename(id, next);
    setRenaming(null);
  };

  const card = (p: ProjectMeta) => (
    <div
      key={p.id}
      className="project-card"
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
      <div className="project-card-head">
        {renaming === p.id ? (
          <input
            ref={renameRef}
            className="project-rename"
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
          <span className="project-card-title">{p.title}</span>
        )}
        <span className={"badge badge-" + p.type}>{typeLabel(p.type)}</span>
      </div>

      <div className="project-meta">Updated {relativeTime(p.updatedAt)}</div>

      <div className="project-card-foot" onClick={(e) => e.stopPropagation()}>
        <div className="status-seg" role="group" aria-label="Status">
          {STATUS_SEG.map((s) => (
            <button
              key={s}
              type="button"
              className={"seg" + (p.status === s ? " seg-active" : "")}
              onClick={() => onStatusChange(p.id, s)}
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        <div className="project-actions">
          <button type="button" className="tb-btn" onClick={() => onOpen(p.id)}>
            Open
          </button>
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
          <button
            type="button"
            className="tb-btn tb-btn-danger"
            onClick={() => setConfirmDelete(p)}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );

  const byStatus = (s: ProjectStatus) => projects.filter((p) => p.status === s);

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
            onClick={() => onPrefsChange({ theme: prefs.theme === "dark" ? "light" : "dark" })}
            title="Toggle dark mode"
          >
            {prefs.theme === "dark" ? "Light" : "Dark"}
          </button>
        </div>
        <button type="button" className="tb-btn tb-btn-active home-new" onClick={() => setShowNew(true)}>
          New project
        </button>
      </div>

      <div className="home-body">
        {projects.length === 0 ? (
          <div className="home-empty">
            <h2>No projects yet</h2>
            <p>
              Start a screenplay or a plain document. Everything is saved on this device,
              and syncs when you sign in.
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
                  <div className="project-meta">
                    Opened {relativeTime(continueProject.updatedAt)}
                  </div>
                </div>
              </div>
            )}

            {SECTION_ORDER.map((s) => {
              const items = byStatus(s);
              return (
                <section key={s} className="home-section">
                  <h2 className="home-section-title">
                    {STATUS_LABEL[s]} <span className="home-count">{items.length}</span>
                  </h2>
                  {items.length === 0 ? (
                    <p className="home-section-empty">{SECTION_EMPTY[s]}</p>
                  ) : (
                    <div className="home-grid">{items.map(card)}</div>
                  )}
                </section>
              );
            })}
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
                <select
                  value={newTemplate}
                  onChange={(e) => setNewTemplate(e.target.value)}
                >
                  {SCREENPLAY_TEMPLATES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label} — {t.description}
                    </option>
                  ))}
                </select>
              </label>
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
