"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CloudUser as User } from "@/lib/cloud/client";
import type { JSONContent } from "@tiptap/core";
import type { Prefs } from "@/lib/storage/localStore";
import {
  loadProjectDoc,
  type ProjectMeta,
  type ProjectStatus,
  type ProjectType,
} from "@/lib/storage/projects";
import { FOLDER_COLORS, type Folder } from "@/lib/storage/folders";
import { listFilms, listIdeas, type Film } from "@/lib/storage/films";
import { docText } from "@/lib/editor/docUtils";
import type { TitlePage } from "@/lib/export/titlePage";
import { IMPORT_ACCEPT } from "@/lib/export";
import { claimSyncCode } from "@/lib/cloud/auth";
import { Menu, type MenuItem } from "./ui/Menu";
import { Modal } from "./ui/Modal";
import { showToast } from "./ui/Toast";
import { DotsIcon, PersonIcon } from "./chrome/icons";

/**
 * The home (films-home build, Altitude 1): one question, "what am I working
 * on?" One line per film, the film touched last rendered big as the lead, and
 * the loose ideas underneath with a zero-ceremony jot line. Films are read
 * through lib/storage/films (folders reinterpreted, data untouched); every
 * write still goes through the existing useProjects handlers.
 */

/* ---- Small shared pieces ------------------------------------------------- */

const STATUS_LABEL: Record<ProjectStatus, string> = {
  not_started: "Idea",
  writing: "Writing",
  done: "Done",
};

export function relativeTime(iso: string): string {
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

/** The status dot + word pair used in film state lines. */
export function StatusWord({ status }: { status: ProjectStatus }) {
  return (
    <span className="st">
      <span className={"dot dot-" + status} aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}

const ChevronDown = () => (
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
);

/**
 * Press-and-hold to confirm a destructive action. The bar fills over ~2s; let
 * go early and nothing happens. Deliberately harder than a single click so a
 * film is never deleted by accident. Lives inside the confirm modal.
 */
export function HoldDelete({ onConfirm }: { onConfirm: () => void }) {
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
  );
}

/**
 * Name field that buffers keystrokes locally and commits on blur or Enter, so
 * a cloud-synced rename fires one write instead of one per letter.
 */
export function NameInput({
  initial,
  className,
  ariaLabel,
  onCommit,
  onDone,
}: {
  initial: string;
  className: string;
  ariaLabel: string;
  onCommit: (name: string) => void;
  onDone: () => void;
}) {
  const [val, setVal] = useState(initial);
  const commit = () => onCommit(val.trim());
  const ref = useRef<HTMLInputElement>(null);
  // Focus on the next tick, not via autoFocus: the Menu that triggered this
  // rename restores focus to its opener when it closes, and that restore runs
  // after this input mounts. The timeout wins the race, so typing lands here.
  useEffect(() => {
    const t = setTimeout(() => {
      ref.current?.focus();
      ref.current?.select();
    }, 0);
    return () => clearTimeout(t);
  }, []);
  return (
    <input
      ref={ref}
      className={className}
      value={val}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => {
        commit();
        onDone();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          commit();
          onDone();
        } else if (e.key === "Escape") {
          onDone();
        }
      }}
      aria-label={ariaLabel}
    />
  );
}

/** First non-empty line of a stored doc: the lead film's live specimen. */
export function firstLine(meta: ProjectMeta): { text: string; isScene: boolean } | null {
  const doc = loadProjectDoc(meta.id);
  if (!doc?.content) return null;
  if (meta.type === "screenplay") {
    const scene = doc.content.find(
      (l) => l.attrs?.element === "scene_heading" && docText(l)
    );
    if (scene) return { text: docText(scene), isScene: true };
  }
  const any = doc.content.find((l) => docText(l));
  return any ? { text: docText(any), isScene: false } : null;
}

/* ---- The home ------------------------------------------------------------ */

export function ProjectsHome({
  projects,
  folders,
  user,
  cloudConfigured,
  prefs,
  onPrefsChange,
  onOpen,
  onOpenFilm,
  onCreate,
  onDelete,
  onRename,
  onSetFolder,
  onCreateFolder,
  onUpdateFolder,
  onDeleteFolder,
  onImportScreenplays,
  onSyncNow,
  onSignIn,
  onSignOut,
}: {
  projects: ProjectMeta[];
  folders: Folder[];
  user: User | null;
  cloudConfigured: boolean;
  prefs: Prefs;
  onPrefsChange: (next: Partial<Prefs>) => void;
  onOpen: (id: string, opts?: { focusTitle?: boolean }) => void;
  /** Opens a folder film's project page (#/f/<folderId>). */
  onOpenFilm: (folderId: string) => void;
  /** Creates without opening; the home decides whether to open. */
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
  onCreateFolder: (parentId?: string) => Folder;
  onUpdateFolder: (
    id: string,
    patch: { name?: string; color?: string; parentId?: string | null }
  ) => void;
  onDeleteFolder: (id: string) => void;
  onImportScreenplays: (files: File[]) => Promise<{ imported: number; failed: string[] }>;
  onSyncNow: () => Promise<boolean>;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  /* ---- View state ---- */
  const [query, setQuery] = useState("");
  const [jot, setJot] = useState("");

  // Anchored menus: which one is open and where it hangs.
  const [menu, setMenu] = useState<
    | null
    | { kind: "overflow" | "account" | "new"; anchor: DOMRect }
    | { kind: "film" | "idea"; id: string; anchor: DOMRect }
  >(null);
  const openMenu = (
    e: React.MouseEvent,
    m: { kind: "overflow" | "account" | "new" } | { kind: "film" | "idea"; id: string }
  ) => {
    e.stopPropagation();
    setMenu({ ...m, anchor: e.currentTarget.getBoundingClientRect() });
  };

  // Modals and inline edits.
  const [colorTarget, setColorTarget] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ProjectMeta | null>(null);
  const [confirmDeleteFilm, setConfirmDeleteFilm] = useState<Film | null>(null);
  const [showCodeImport, setShowCodeImport] = useState(false);
  const [renamingFilm, setRenamingFilm] = useState<string | null>(null);

  // Relative times refresh once a minute while the home is on screen.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  // "/" focuses the search field when not already typing somewhere.
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ---- The reinterpretation: films and ideas ---- */

  const films = useMemo(() => listFilms(projects, folders), [projects, folders]);
  const ideas = useMemo(() => listIdeas(projects, folders), [projects, folders]);
  const lead = films[0] ?? null;

  // The lead's live specimen: its draft's first scene line, re-read only when
  // the draft or its content clock changes.
  const leadDraft = lead?.currentDraft ?? null;
  const leadLine = useMemo(
    () => (leadDraft ? firstLine(leadDraft) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [leadDraft?.id, leadDraft?.updatedAt]
  );

  /* ---- Drag: idea lines onto films ---- */

  const dragIdea = useRef<string | null>(null);
  const [draggingIdea, setDraggingIdea] = useState<string | null>(null);
  const [dropFilm, setDropFilm] = useState<string | null>(null);
  const clearDrag = () => {
    dragIdea.current = null;
    setDraggingIdea(null);
    setDropFilm(null);
  };

  /** File an idea into a film. Folder films take it directly; an implicit
   *  film MATERIALIZES first: a folder named after the script appears and
   *  both the script and the idea are filed into it, all through the
   *  existing handlers so every clock stamps correctly. */
  const fileIdeaInto = (film: Film, ideaId: string) => {
    if (film.kind === "folder") {
      onSetFolder(ideaId, film.id);
      return;
    }
    const scriptId = film.id; // an implicit film IS its loose screenplay
    const f = onCreateFolder();
    onUpdateFolder(f.id, { name: film.name });
    onSetFolder(scriptId, f.id);
    onSetFolder(ideaId, f.id);
  };

  const filmDropProps = (film: Film) => ({
    onDragOver: (e: React.DragEvent) => {
      if (dragIdea.current) {
        e.preventDefault();
        setDropFilm(film.id);
      }
    },
    onDragLeave: (e: React.DragEvent) => {
      // Moving between a film's own children also fires dragleave; only a
      // real exit clears the wash.
      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
        setDropFilm((f) => (f === film.id ? null : f));
      }
    },
    onDrop: (e: React.DragEvent) => {
      if (dragIdea.current) {
        e.preventDefault();
        fileIdeaInto(film, dragIdea.current);
      }
      clearDrag();
    },
  });

  /* ---- Flows ---- */

  const createAndOpen = (type: ProjectType, title: string) => {
    try {
      const meta = onCreate(type, title);
      onOpen(meta.id, { focusTitle: true });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not create the project.", {
        variant: "danger",
      });
    }
  };

  // The jot: Enter turns the line into a loose plain project (title only,
  // empty body) and stays right here. The new idea line appearing is the
  // feedback; no toast, no navigation.
  const jotIdea = () => {
    const title = jot.trim();
    if (!title) return;
    try {
      onCreate("plain", title);
      setJot("");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not save the idea.", {
        variant: "danger",
      });
    }
  };

  // "Make this a film": a folder named after the idea materializes and the
  // idea files itself into it, so the film starts life holding its first note.
  const makeFilmOf = (idea: ProjectMeta) => {
    const f = onCreateFolder();
    onUpdateFolder(f.id, { name: idea.title });
    onSetFolder(idea.id, f.id);
  };

  // Deleting a film deletes only the folder: its drafts and documents are
  // reparented up a level through the existing handlers (top level = loose),
  // so nothing a writer wrote is ever destroyed by this.
  const removeFilm = (film: Film) => {
    folders
      .filter((sf) => sf.parentId === film.id)
      .forEach((sf) => onUpdateFolder(sf.id, { parentId: null }));
    projects
      .filter((p) => p.folderId === film.id)
      .forEach((p) => onSetFolder(p.id, null));
    onDeleteFolder(film.id);
    setConfirmDeleteFilm(null);
  };

  // Bulk import behind the New menu; results land as a toast.
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const runImport = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setImporting(true);
    try {
      const { imported, failed } = await onImportScreenplays(Array.from(fileList));
      showToast(
        `Imported ${imported} script${imported === 1 ? "" : "s"}` +
          (failed.length ? `, ${failed.length} could not be read.` : ".")
      );
    } catch {
      showToast("Import failed.", { variant: "danger" });
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  const runSync = async () => {
    showToast("Syncing.");
    try {
      const ok = await onSyncNow();
      showToast(ok ? "Synced." : "Sync did not finish. Check your connection.");
    } catch {
      showToast("Sync did not finish. Check your connection.", { variant: "danger" });
    }
  };

  /* ---- Menu item builders ---- */

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

  // Account lives behind its own avatar button, not the overflow.
  const accountItems: MenuItem[] = user
    ? [
        { label: user.email ?? "Signed in", onSelect: () => {}, disabled: true },
        { label: "Sync now", onSelect: () => void runSync() },
        { label: "Import a code", onSelect: () => setShowCodeImport(true) },
        { kind: "divider" },
        { label: "Sign out", onSelect: onSignOut },
      ]
    : [{ label: "Sign in", onSelect: onSignIn }];

  // Folders are never created by hand anymore; they materialize when an idea
  // lands on a script. So New offers exactly the three real beginnings.
  const newItems: MenuItem[] = [
    { label: "New script", onSelect: () => createAndOpen("screenplay", "Untitled screenplay") },
    { label: "New document", onSelect: () => createAndOpen("plain", "") },
    {
      label: importing ? "Importing" : "Import files",
      onSelect: () => importInputRef.current?.click(),
      disabled: importing,
    },
  ];

  const filmItems = (film: Film): MenuItem[] =>
    film.kind === "folder"
      ? [
          { label: "Rename", onSelect: () => setRenamingFilm(film.id) },
          { label: "Color", onSelect: () => setColorTarget(film.id) },
          { kind: "divider" },
          { label: "Delete", danger: true, onSelect: () => setConfirmDeleteFilm(film) },
        ]
      : [
          // An implicit film IS its script: these act on the project itself.
          { label: "Rename", onSelect: () => setRenamingFilm(film.id) },
          { kind: "divider" },
          {
            label: "Delete",
            danger: true,
            onSelect: () => {
              const meta = projects.find((p) => p.id === film.id);
              if (meta) setConfirmDelete(meta);
            },
          },
        ];

  const ideaItems = (idea: ProjectMeta): MenuItem[] => [
    { label: "Open", onSelect: () => onOpen(idea.id) },
    { label: "Make this a film", onSelect: () => makeFilmOf(idea) },
    { kind: "divider" },
    { label: "Delete", danger: true, onSelect: () => setConfirmDelete(idea) },
  ];

  /* ---- Search: one flat list across everything ---- */

  const q = query.trim().toLowerCase();
  type Hit =
    | { key: string; kind: "film"; film: Film }
    | { key: string; kind: "draft" | "document"; meta: ProjectMeta; film: Film }
    | { key: string; kind: "idea"; meta: ProjectMeta };
  const hits = useMemo<Hit[]>(() => {
    if (!q) return [];
    const out: Hit[] = [];
    for (const film of films) {
      if (film.name.toLowerCase().includes(q)) {
        out.push({ key: "f:" + film.id, kind: "film", film });
      }
      // An implicit film IS its draft; listing both would be the same line twice.
      if (film.kind === "implicit") continue;
      const drafts = film.currentDraft
        ? [film.currentDraft, ...film.earlierDrafts]
        : film.earlierDrafts;
      for (const d of drafts) {
        if (d.title.toLowerCase().includes(q)) {
          out.push({ key: "p:" + d.id, kind: "draft", meta: d, film });
        }
      }
      for (const doc of film.documents) {
        if (doc.title.toLowerCase().includes(q)) {
          out.push({ key: "p:" + doc.id, kind: "document", meta: doc, film });
        }
      }
    }
    for (const idea of ideas) {
      if (idea.title.toLowerCase().includes(q)) {
        out.push({ key: "p:" + idea.id, kind: "idea", meta: idea });
      }
    }
    return out;
  }, [q, films, ideas]);

  const openHit = (hit: Hit) => {
    if (hit.kind === "film") {
      if (hit.film.kind === "folder") onOpenFilm(hit.film.id);
      else onOpen(hit.film.id);
    } else {
      onOpen(hit.meta.id);
    }
  };

  const HIT_WORD: Record<Exclude<Hit["kind"], never>, string> = {
    film: "Film",
    draft: "Draft",
    document: "Document",
    idea: "Idea",
  };

  /* ---- Renders ---- */

  const filmRow = (film: Film, isLead: boolean) => {
    const draft = film.currentDraft;
    const renaming = renamingFilm === film.id;
    // The lead opens straight into the writing; other folder films open their
    // page; an implicit film has no page, so it opens its script.
    const open = () => {
      if (renaming) return;
      if (isLead && draft) onOpen(draft.id);
      else if (film.kind === "folder") onOpenFilm(film.id);
      else onOpen(film.id);
    };
    const docsWord =
      film.documents.length > 0
        ? `${film.documents.length} document${film.documents.length === 1 ? "" : "s"}`
        : null;
    return (
      <div
        key={film.id}
        className={
          "film" +
          (isLead ? " lead" : "") +
          (dropFilm === film.id ? " dropping" : "")
        }
        style={{ ["--fc" as string]: film.color }}
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !renaming) {
            e.preventDefault();
            open();
          }
        }}
        {...filmDropProps(film)}
      >
        {isLead && <div className="lead-label">Now writing</div>}
        <div className="film-top">
          <span className="film-mark" aria-hidden="true" />
          {renaming ? (
            <NameInput
              initial={film.name}
              className="film-rename"
              ariaLabel="Film name"
              onCommit={(name) => {
                if (!name) return;
                if (film.kind === "folder") onUpdateFolder(film.id, { name });
                else if (name !== film.name) onRename(film.id, name);
              }}
              onDone={() => setRenamingFilm(null)}
            />
          ) : film.kind === "folder" ? (
            // The name is always the way into the film's world, even on the
            // lead (whose block otherwise opens the draft directly).
            <button
              type="button"
              className="film-name film-name-link"
              onClick={(e) => {
                e.stopPropagation();
                onOpenFilm(film.id);
              }}
            >
              {film.name}
            </button>
          ) : (
            <span className="film-name">{film.name}</span>
          )}
          <button
            type="button"
            className="fh-kebab"
            aria-label={`Actions for ${film.name}`}
            aria-haspopup="menu"
            onClick={(e) => openMenu(e, { kind: "film", id: film.id })}
          >
            <DotsIcon />
          </button>
        </div>
        {isLead && draft ? (
          <div className="film-state">
            {/* pageCount is the draft's TOTAL pages, not a caret position, so
                the copy says its length rather than pretending to know where
                the writer left the cursor. */}
            <span className="film-continue">
              Continue {draft.title}
              {draft.pageCount != null ? `, ${draft.pageCount} pages` : ""}
            </span>
            {leadLine && (
              <span
                className={
                  "film-courier" + (leadLine.isScene ? " film-courier-scene" : "")
                }
              >
                {leadLine.text}
              </span>
            )}
            <span className="film-when">{relativeTime(film.lastTouched)}</span>
          </div>
        ) : (
          <div className="film-state">
            <StatusWord status={film.status} />
            {draft?.pageCount != null && <span>{draft.pageCount} pp</span>}
            {docsWord && <span>{docsWord}</span>}
            <span className="film-when">{relativeTime(film.lastTouched)}</span>
          </div>
        )}
      </div>
    );
  };

  const ideaRow = (idea: ProjectMeta) => (
    <div
      key={idea.id}
      className={"idea" + (draggingIdea === idea.id ? " dragging" : "")}
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(e) => {
        dragIdea.current = idea.id;
        setDraggingIdea(idea.id);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", idea.id);
      }}
      onDragEnd={clearDrag}
      onClick={() => onOpen(idea.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(idea.id);
        }
      }}
    >
      <span className="idea-title">{idea.title}</span>
      <span className="idea-when">{relativeTime(idea.updatedAt)}</span>
      <button
        type="button"
        className="fh-kebab"
        aria-label={`Actions for ${idea.title}`}
        aria-haspopup="menu"
        onClick={(e) => openMenu(e, { kind: "idea", id: idea.id })}
      >
        <DotsIcon />
      </button>
    </div>
  );

  const menuTargetFilm = menu?.kind === "film" ? films.find((f) => f.id === menu.id) : null;
  const menuTargetIdea = menu?.kind === "idea" ? ideas.find((p) => p.id === menu.id) : null;
  const colorFolder = colorTarget
    ? folders.find((f) => f.id === colorTarget) ?? null
    : null;

  return (
    <div className="home">
      <header className="home-topbar">
        <div className="home-brand" title="Last Ever Screenwriting Software">
          LESS
        </div>
        <input
          ref={searchRef}
          type="search"
          className="home-search"
          placeholder="Search everything"
          aria-label="Search everything"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setQuery("");
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
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
        {cloudConfigured && (
          <button
            type="button"
            className="tb-icon"
            aria-label="Account"
            title={user ? user.email ?? "Account" : "Account"}
            aria-haspopup="menu"
            onClick={(e) => openMenu(e, { kind: "account" })}
          >
            {user ? (
              <span className="home-avatar" aria-hidden="true">
                {(user.email ?? "?").slice(0, 1).toUpperCase()}
              </span>
            ) : (
              <PersonIcon />
            )}
          </button>
        )}
        <button
          type="button"
          className="ui-btn ui-btn-solid fh-new"
          aria-haspopup="menu"
          onClick={(e) => openMenu(e, { kind: "new" })}
        >
          New
          <ChevronDown />
        </button>
        <input
          ref={importInputRef}
          type="file"
          multiple
          accept={`${IMPORT_ACCEPT},.json`}
          style={{ display: "none" }}
          onChange={(e) => void runImport(e.target.files)}
        />
      </header>

      <main className="fh-page">
        {q ? (
          /* Searching: the bands hide and one flat result list takes over. */
          hits.length > 0 ? (
            <div className="fh-hits">
              {hits.map((hit) => (
                <div
                  key={hit.key}
                  className="fh-hit"
                  role="button"
                  tabIndex={0}
                  onClick={() => openHit(hit)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openHit(hit);
                    }
                  }}
                >
                  <span className="fh-hit-title">
                    {hit.kind === "film" ? hit.film.name : hit.meta.title}
                  </span>
                  <span className="fh-hit-kind">{HIT_WORD[hit.kind]}</span>
                  {(hit.kind === "draft" || hit.kind === "document") && (
                    <span className="fh-hit-film">
                      <span
                        className="fh-dot"
                        style={{ background: hit.film.color }}
                        aria-hidden="true"
                      />
                      {hit.film.name}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="list-empty">Nothing matches that search.</p>
          )
        ) : (
          <>
            {films.length > 0 && (
              <>
                <div className="band">Films</div>
                {films.map((film, i) => filmRow(film, i === 0))}
              </>
            )}

            <div className={"band" + (films.length > 0 ? " band-later" : "")}>Ideas</div>
            {ideas.map(ideaRow)}
            <div className="jot">
              <input
                type="text"
                value={jot}
                placeholder="Jot an idea and press Enter"
                aria-label="Jot an idea"
                onChange={(e) => setJot(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") jotIdea();
                }}
              />
            </div>
          </>
        )}
      </main>

      {/* ---- Anchored menus ---- */}
      {menu?.kind === "overflow" && (
        <Menu anchor={menu.anchor} items={overflowItems} onClose={() => setMenu(null)} ariaLabel="More" />
      )}
      {menu?.kind === "account" && (
        <Menu
          anchor={menu.anchor}
          items={accountItems}
          onClose={() => setMenu(null)}
          ariaLabel="Account"
        />
      )}
      {menu?.kind === "new" && (
        <Menu anchor={menu.anchor} items={newItems} onClose={() => setMenu(null)} ariaLabel="Create" />
      )}
      {menuTargetFilm && menu?.kind === "film" && (
        <Menu
          anchor={menu.anchor}
          items={filmItems(menuTargetFilm)}
          onClose={() => setMenu(null)}
          ariaLabel="Film actions"
        />
      )}
      {menuTargetIdea && menu?.kind === "idea" && (
        <Menu
          anchor={menu.anchor}
          items={ideaItems(menuTargetIdea)}
          onClose={() => setMenu(null)}
          ariaLabel="Idea actions"
        />
      )}

      {/* ---- Film color ---- */}
      {colorFolder && (
        <Modal title="Film color" onClose={() => setColorTarget(null)}>
          <div className="folder-swatches" role="group" aria-label="Film color">
            {FOLDER_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={"swatch" + (colorFolder.color === c ? " swatch-on" : "")}
                style={{ background: c }}
                onClick={() => {
                  onUpdateFolder(colorFolder.id, { color: c });
                  setColorTarget(null);
                }}
                aria-label={"Color " + c}
              />
            ))}
            {(() => {
              const custom = !FOLDER_COLORS.includes(colorFolder.color);
              return (
                <label
                  className={"swatch swatch-custom" + (custom ? " swatch-on" : "")}
                  style={custom ? { background: colorFolder.color } : undefined}
                  title="Custom color"
                >
                  <input
                    type="color"
                    className="swatch-custom-input"
                    value={colorFolder.color}
                    onChange={(e) => onUpdateFolder(colorFolder.id, { color: e.target.value })}
                    aria-label="Pick a custom film color"
                  />
                </label>
              );
            })()}
          </div>
        </Modal>
      )}

      {/* ---- Import a code ---- */}
      {showCodeImport && (
        <CodeImportModal
          onClose={() => setShowCodeImport(false)}
          onSyncNow={onSyncNow}
        />
      )}

      {/* ---- Delete a project (an idea, or an implicit film's script) ---- */}
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

      {/* ---- Delete a film (the folder only; its contents drop out loose) ---- */}
      {confirmDeleteFilm && (
        <Modal
          title="Delete film"
          onClose={() => setConfirmDeleteFilm(null)}
          actions={[{ label: "Cancel", onClick: () => setConfirmDeleteFilm(null) }]}
        >
          <p>
            Delete the film &quot;{confirmDeleteFilm.name}&quot;? Its drafts and
            documents are kept: they return to the home as loose items.
          </p>
          <div className="hold-row">
            <HoldDelete onConfirm={() => removeFilm(confirmDeleteFilm)} />
          </div>
        </Modal>
      )}
    </div>
  );
}

/** "Import a code": pull another sync code's work into this account. */
function CodeImportModal({
  onClose,
  onSyncNow,
}: {
  onClose: () => void;
  onSyncNow: () => Promise<boolean>;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const ok = await claimSyncCode(code);
      if (!ok) {
        setError("That code did not work. Paste the full code from your other device.");
        return;
      }
      await onSyncNow();
      onClose();
      showToast("Imported. Your other work is now in this account.");
    } catch {
      setError("Could not import that code.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Import a code"
      onClose={onClose}
      actions={[
        { label: "Cancel", onClick: onClose },
        {
          label: busy ? "Importing" : "Apply",
          variant: "solid",
          onClick: () => void apply(),
          disabled: busy || !code.trim(),
        },
      ]}
    >
      <p>Pull in work saved under a sync code from another device.</p>
      <input
        type="text"
        className="code-input"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Paste a sync code"
        autoComplete="off"
        spellCheck={false}
        aria-label="Sync code"
        onKeyDown={(e) => {
          if (e.key === "Enter" && code.trim() && !busy) void apply();
        }}
      />
      {error && <p className="ui-modal-note">{error}</p>}
    </Modal>
  );
}
