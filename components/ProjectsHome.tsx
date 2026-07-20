"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CloudUser as User } from "@/lib/cloud/client";
import type { JSONContent } from "@tiptap/core";
import { lsGet, lsSet, type Prefs } from "@/lib/storage/localStore";
import {
  loadPageLock,
  loadProjectDoc,
  loadProjectTitlePage,
  type ProjectMeta,
  type ProjectStatus,
  type ProjectType,
} from "@/lib/storage/projects";
import { FOLDER_COLORS, type Folder } from "@/lib/storage/folders";
import { SCREENPLAY_TEMPLATES, buildTemplate } from "@/lib/editor/templates";
import { docText } from "@/lib/editor/docUtils";
import type { TitlePage } from "@/lib/export/titlePage";
import { IMPORT_ACCEPT, exportDoc, type ExportFormat } from "@/lib/export";
import { claimSyncCode } from "@/lib/cloud/auth";
import { Menu, type MenuItem } from "./ui/Menu";
import { Modal } from "./ui/Modal";
import { showToast } from "./ui/Toast";
import { DotsIcon, PersonIcon } from "./chrome/icons";

/**
 * The dashboard (Superaudit 2, Part 2C): a writer's desk, not a filing cabinet.
 * One 48px top bar (wordmark, search, overflow, account avatar, split New
 * button), a 220px
 * folder sidebar on the left, and a content column with the Continue card and
 * 52px script rows. Folder stages are retired from display entirely.
 */

/* ---- Small shared pieces ------------------------------------------------- */

const STATUS_LABEL: Record<ProjectStatus, string> = {
  not_started: "Idea",
  writing: "Writing",
  done: "Done",
};

const NEXT_STATUS: Record<ProjectStatus, ProjectStatus> = {
  not_started: "writing",
  writing: "done",
  done: "not_started",
};

type SortKey = "recent" | "title" | "created";
const SORT_LABEL: Record<SortKey, string> = {
  recent: "Recent",
  title: "Title",
  created: "Created",
};
/** NEW additive key (never the deleted HomeView shape). */
const SORT_KEY = "less:homeSort";

function loadSort(): SortKey {
  const raw = lsGet(SORT_KEY);
  return raw === "title" || raw === "created" ? raw : "recent";
}

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
      className="srow-icon"
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

/**
 * Name field that buffers keystrokes locally and commits on blur or Enter, so
 * a cloud-synced rename fires one write instead of one per letter.
 */
function NameInput({
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

/** First non-empty line of a stored doc: the Continue card's live specimen. */
function firstLine(meta: ProjectMeta): { text: string; isScene: boolean } | null {
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

/** First few lines of a template, formatted for the 12pt Courier preview. */
function templatePreview(id: string): string[] {
  const doc = buildTemplate(id);
  if (!doc?.content) return [];
  const upper = new Set(["scene_heading", "transition", "character"]);
  return doc.content
    .map((l) => {
      const text = docText(l);
      if (!text) return "";
      const el = typeof l.attrs?.element === "string" ? l.attrs.element : "";
      return upper.has(el) ? text.toUpperCase() : text;
    })
    .filter(Boolean)
    .slice(0, 4);
}

/* ---- The dashboard ------------------------------------------------------- */

type Selection = "all" | "unfiled" | { folderId: string };

export function ProjectsHome({
  projects,
  folders,
  user,
  cloudConfigured,
  prefs,
  onPrefsChange,
  lastOpenedId,
  onOpen,
  onCreate,
  onDelete,
  onRename,
  onSetStatus,
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
  lastOpenedId: string | null;
  onOpen: (id: string, opts?: { focusTitle?: boolean }) => void;
  /** Creates without opening; the dashboard decides whether to open. */
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
  onSetStatus: (id: string, status: ProjectStatus) => void;
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
  const [sel, setSel] = useState<Selection>("all");
  const [query, setQuery] = useState("");
  const [sort, setSortState] = useState<SortKey>(loadSort);
  const setSort = (s: SortKey) => {
    setSortState(s);
    lsSet(SORT_KEY, s);
  };

  // Anchored menus: which one is open and where it hangs.
  const [menu, setMenu] = useState<
    | null
    | { kind: "overflow" | "account" | "new" | "sort"; anchor: DOMRect }
    | { kind: "row" | "folder"; id: string; anchor: DOMRect }
  >(null);
  const openMenu = (
    e: React.MouseEvent,
    m:
      | { kind: "overflow" | "account" | "new" | "sort" }
      | { kind: "row" | "folder"; id: string }
  ) => {
    e.stopPropagation();
    setMenu({ ...m, anchor: e.currentTarget.getBoundingClientRect() });
  };

  // Modals.
  const [showTemplates, setShowTemplates] = useState(false);
  const [moveTarget, setMoveTarget] = useState<ProjectMeta | null>(null);
  const [colorTarget, setColorTarget] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ProjectMeta | null>(null);
  const [showCodeImport, setShowCodeImport] = useState(false);

  // Inline renames and the armed folder delete.
  const [renamingRow, setRenamingRow] = useState<string | null>(null);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<string | null>(null);

  // Relative times refresh once a minute while the dashboard is on screen.
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

  /* ---- Data shaping ---- */

  // Orphan-safe: a folderId/parentId pointing at a folder we do not have is
  // treated as top level, so nothing vanishes.
  const folderById = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  const effFolderId = (p: ProjectMeta) =>
    p.folderId && folderById.has(p.folderId) ? p.folderId : null;
  const effParentId = (f: Folder) =>
    f.parentId && folderById.has(f.parentId) ? f.parentId : null;

  const subfolders = (parentId: string | null) =>
    folders
      .filter((f) => effParentId(f) === parentId)
      .sort((a, b) => a.order - b.order || (a.createdAt < b.createdAt ? -1 : 1));

  const countIn = useMemo(() => {
    const m = new Map<string | null, number>();
    for (const p of projects) {
      const k = effFolderId(p);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, folders]);

  const sorters: Record<SortKey, (a: ProjectMeta, b: ProjectMeta) => number> = {
    recent: (a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0),
    title: (a, b) => a.title.localeCompare(b.title),
    created: (a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0),
  };

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    const base = q
      ? projects.filter((p) => p.title.toLowerCase().includes(q))
      : sel === "all"
        ? projects
        : projects.filter(
            (p) => effFolderId(p) === (sel === "unfiled" ? null : sel.folderId)
          );
    return base.slice().sort(sorters[sort]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, folders, q, sel, sort]);

  const listTitle = q
    ? "Search results"
    : sel === "all"
      ? "All scripts"
      : sel === "unfiled"
        ? "Unfiled"
        : folderById.get(sel.folderId)?.name || "Untitled folder";

  // The Continue card (B10: lastOpenedId lives again). Shown on the plain
  // "All scripts" desk only; hidden while searching or browsing a folder.
  const contMeta =
    !q && sel === "all" && lastOpenedId
      ? projects.find((p) => p.id === lastOpenedId) ?? null
      : null;
  const contLine = useMemo(
    () => (contMeta ? firstLine(contMeta) : null),
    // Re-read only when the project or its content clock changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contMeta?.id, contMeta?.updatedAt]
  );

  /* ---- Drag: rows onto sidebar folders ---- */
  const dragId = useRef<string | null>(null);
  const [dropHi, setDropHi] = useState<string | null>(null); // "unfiled" | folderId
  const clearDrag = () => {
    dragId.current = null;
    setDropHi(null);
  };
  const dropProps = (key: string, folderId: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (dragId.current) {
        e.preventDefault();
        setDropHi(key);
      }
    },
    onDragLeave: () => setDropHi((h) => (h === key ? null : h)),
    onDrop: (e: React.DragEvent) => {
      if (dragId.current) {
        e.preventDefault();
        const cur = projects.find((p) => p.id === dragId.current);
        if (cur && effFolderId(cur) !== folderId) onSetFolder(cur.id, folderId);
      }
      clearDrag();
    },
  });

  /* ---- Flows ---- */

  const createAndOpen = (
    type: ProjectType,
    title: string,
    opts?: { content?: JSONContent }
  ) => {
    try {
      const folderId = !q && sel !== "all" && sel !== "unfiled" ? sel.folderId : undefined;
      const meta = onCreate(type, title, { ...opts, folderId });
      onOpen(meta.id, { focusTitle: true });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not create the project.", {
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
        folderId: effFolderId(p),
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

  const addFolder = (parentId?: string) => {
    const f = onCreateFolder(parentId);
    setRenamingFolder(f.id);
  };

  const removeFolder = (f: Folder) => {
    // Reparent children (subfolders and scripts) up a level, then delete.
    folders
      .filter((sf) => sf.parentId === f.id)
      .forEach((sf) => onUpdateFolder(sf.id, { parentId: f.parentId ?? null }));
    projects
      .filter((p) => p.folderId === f.id)
      .forEach((p) => onSetFolder(p.id, f.parentId ?? null));
    onDeleteFolder(f.id);
    setDeletingFolder(null);
    setSel((s) => (s !== "all" && s !== "unfiled" && s.folderId === f.id ? "all" : s));
  };

  // Bulk import behind the split menu; results land as a toast.
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

  // Account lives behind its own avatar button (2C), not the overflow.
  const accountItems: MenuItem[] = user
    ? [
        { label: user.email ?? "Signed in", onSelect: () => {}, disabled: true },
        { label: "Sync now", onSelect: () => void runSync() },
        { label: "Import a code", onSelect: () => setShowCodeImport(true) },
        { kind: "divider" },
        { label: "Sign out", onSelect: onSignOut },
      ]
    : [{ label: "Sign in", onSelect: onSignIn }];

  const newItems: MenuItem[] = [
    { label: "New document", onSelect: () => createAndOpen("plain", "") },
    { label: "From template…", onSelect: () => setShowTemplates(true) },
    {
      label: importing ? "Importing…" : "Import files…",
      onSelect: () => importInputRef.current?.click(),
      disabled: importing,
    },
    { kind: "divider" },
    { label: "New folder", onSelect: () => addFolder() },
  ];

  const sortItems: MenuItem[] = (["recent", "title", "created"] as SortKey[]).map((s) => ({
    kind: "radio",
    group: "sort",
    label: SORT_LABEL[s],
    checked: sort === s,
    onSelect: () => setSort(s),
  }));

  const rowItems = (p: ProjectMeta): MenuItem[] => [
    {
      label: "Rename",
      onSelect: () => setRenamingRow(p.id),
    },
    { label: "Move to…", onSelect: () => setMoveTarget(p) },
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
    { label: "Delete", danger: true, onSelect: () => setConfirmDelete(p) },
  ];

  const folderItems = (f: Folder): MenuItem[] => [
    { label: "Rename", onSelect: () => setRenamingFolder(f.id) },
    { label: "Color", onSelect: () => setColorTarget(f.id) },
    { label: "New subfolder", onSelect: () => addFolder(f.id) },
    { kind: "divider" },
    { label: "Delete", danger: true, onSelect: () => setDeletingFolder(f.id) },
  ];

  /* ---- Renders ---- */

  const folderRow = (f: Folder, depth: number): React.ReactNode => {
    const selected = sel !== "all" && sel !== "unfiled" && sel.folderId === f.id;
    return (
      <div key={f.id} className="snav-group">
        <div
          className={
            "snav-row" +
            (selected ? " snav-active" : "") +
            (dropHi === f.id ? " snav-drop" : "")
          }
          style={{ "--indent": depth * 14 + "px" } as React.CSSProperties}
          role="button"
          tabIndex={0}
          onClick={() => {
            setQuery("");
            setSel({ folderId: f.id });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setQuery("");
              setSel({ folderId: f.id });
            }
          }}
          {...dropProps(f.id, f.id)}
        >
          <span className="snav-dot" style={{ background: f.color }} aria-hidden="true" />
          {deletingFolder === f.id ? (
            <HoldDelete
              onConfirm={() => removeFolder(f)}
              onCancel={() => setDeletingFolder(null)}
            />
          ) : renamingFolder === f.id ? (
            <NameInput
              initial={f.name}
              className="snav-rename"
              ariaLabel="Folder name"
              onCommit={(name) => onUpdateFolder(f.id, { name: name || "Untitled folder" })}
              onDone={() => setRenamingFolder(null)}
            />
          ) : (
            <>
              <span className="snav-label">{f.name || "Untitled folder"}</span>
              <span className="snav-count">{countIn.get(f.id) ?? 0}</span>
              <button
                type="button"
                className="snav-kebab"
                aria-label={`Folder actions for ${f.name || "Untitled folder"}`}
                onClick={(e) => openMenu(e, { kind: "folder", id: f.id })}
                aria-haspopup="menu"
              >
                <DotsIcon />
              </button>
            </>
          )}
        </div>
        {subfolders(f.id).map((sf) => folderRow(sf, depth + 1))}
      </div>
    );
  };

  const scriptRow = (p: ProjectMeta) => {
    const fid = effFolderId(p);
    const iconColor = (fid ? folderById.get(fid)?.color : null) ?? "var(--muted)";
    return (
      <div
        key={p.id}
        className="srow"
        role="button"
        tabIndex={0}
        draggable={renamingRow !== p.id}
        onDragStart={(e) => {
          dragId.current = p.id;
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", p.id);
        }}
        onDragEnd={clearDrag}
        onClick={() => {
          if (renamingRow !== p.id) onOpen(p.id);
        }}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && renamingRow !== p.id) {
            e.preventDefault();
            onOpen(p.id);
          }
        }}
      >
        <TypeIcon type={p.type} color={iconColor} />
        {renamingRow === p.id ? (
          <NameInput
            initial={p.title}
            className="srow-rename"
            ariaLabel="Script title"
            onCommit={(name) => {
              if (name && name !== p.title) onRename(p.id, name);
            }}
            onDone={() => setRenamingRow(null)}
          />
        ) : (
          <span className="srow-title">{p.title}</span>
        )}
        <button
          type="button"
          className={"srow-status st-" + p.status}
          title="Click to change the status"
          onClick={(e) => {
            e.stopPropagation();
            onSetStatus(p.id, NEXT_STATUS[p.status]);
          }}
        >
          <span className="srow-statusdot" aria-hidden="true" />
          {STATUS_LABEL[p.status]}
        </button>
        {p.type === "screenplay" && p.pageCount != null && (
          <span className="srow-pp">{p.pageCount} pp</span>
        )}
        <span className="srow-time">{relativeTime(p.updatedAt)}</span>
        <button
          type="button"
          className="srow-kebab"
          aria-label={`Actions for ${p.title}`}
          aria-haspopup="menu"
          onClick={(e) => openMenu(e, { kind: "row", id: p.id })}
        >
          <DotsIcon />
        </button>
      </div>
    );
  };

  // The Move to… picker lists every folder, indented by depth.
  const flatFolders = useMemo(() => {
    const out: { folder: Folder; depth: number }[] = [];
    const walk = (parentId: string | null, depth: number) => {
      for (const f of subfolders(parentId)) {
        out.push({ folder: f, depth });
        walk(f.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders]);

  const menuTargetRow = menu?.kind === "row" ? projects.find((p) => p.id === menu.id) : null;
  const menuTargetFolder =
    menu?.kind === "folder" ? folderById.get(menu.id) ?? null : null;
  const colorFolder = colorTarget ? folderById.get(colorTarget) ?? null : null;

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
          placeholder="Search scripts"
          aria-label="Search scripts"
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
        <div className="home-split">
          <button
            type="button"
            className="ui-btn ui-btn-solid home-split-main"
            onClick={() => createAndOpen("screenplay", "Untitled screenplay")}
          >
            New script
          </button>
          <button
            type="button"
            className="ui-btn ui-btn-solid home-split-caret"
            aria-label="More ways to create"
            aria-haspopup="menu"
            onClick={(e) => openMenu(e, { kind: "new" })}
          >
            <ChevronDown />
          </button>
        </div>
        <input
          ref={importInputRef}
          type="file"
          multiple
          accept={`${IMPORT_ACCEPT},.json`}
          style={{ display: "none" }}
          onChange={(e) => void runImport(e.target.files)}
        />
      </header>

      <div className="home-layout">
        <nav className="home-sidebar" aria-label="Folders">
          <div
            className={
              "snav-row" + (sel === "all" && !q ? " snav-active" : "")
            }
            role="button"
            tabIndex={0}
            onClick={() => {
              setQuery("");
              setSel("all");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setQuery("");
                setSel("all");
              }
            }}
          >
            <span className="snav-label">All scripts</span>
            <span className="snav-count">{projects.length}</span>
          </div>
          <div
            className={
              "snav-row" +
              (sel === "unfiled" && !q ? " snav-active" : "") +
              (dropHi === "unfiled" ? " snav-drop" : "")
            }
            role="button"
            tabIndex={0}
            onClick={() => {
              setQuery("");
              setSel("unfiled");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setQuery("");
                setSel("unfiled");
              }
            }}
            {...dropProps("unfiled", null)}
          >
            <span className="snav-label">Unfiled</span>
            <span className="snav-count">{countIn.get(null) ?? 0}</span>
          </div>
          {folders.length > 0 && <div className="snav-sep" aria-hidden="true" />}
          {subfolders(null).map((f) => folderRow(f, 0))}
        </nav>

        <main className="home-content">
          {contMeta && (
            <button
              type="button"
              className="cont-card"
              onClick={() => onOpen(contMeta.id)}
            >
              <span className="cont-label">Continue</span>
              <span className="cont-title">{contMeta.title}</span>
              <span className="cont-meta">
                {contMeta.type === "screenplay" && contMeta.pageCount != null
                  ? `Page ${contMeta.pageCount} · `
                  : ""}
                edited {relativeTime(contMeta.updatedAt)}
              </span>
              {contLine && (
                <span
                  className={
                    "cont-specimen" + (contLine.isScene ? " cont-specimen-scene" : "")
                  }
                >
                  {contLine.text}
                </span>
              )}
            </button>
          )}

          <div className="list-head">
            <h2 className="list-title">{listTitle}</h2>
            <button
              type="button"
              className="list-sort"
              aria-haspopup="menu"
              title="Sort"
              onClick={(e) => openMenu(e, { kind: "sort" })}
            >
              {SORT_LABEL[sort]}
              <ChevronDown />
            </button>
          </div>

          {visible.length > 0 ? (
            <div className="srow-list">{visible.map(scriptRow)}</div>
          ) : (
            <p className="list-empty">
              {q
                ? "Nothing matches that search."
                : sel === "all"
                  ? "Nothing here yet. Press New to start."
                  : "Nothing here yet. Drag a script in, or press New."}
            </p>
          )}
        </main>
      </div>

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
      {menu?.kind === "sort" && (
        <Menu anchor={menu.anchor} items={sortItems} onClose={() => setMenu(null)} ariaLabel="Sort" />
      )}
      {menuTargetRow && menu?.kind === "row" && (
        <Menu
          anchor={menu.anchor}
          items={rowItems(menuTargetRow)}
          onClose={() => setMenu(null)}
          ariaLabel="Script actions"
        />
      )}
      {menuTargetFolder && menu?.kind === "folder" && (
        <Menu
          anchor={menu.anchor}
          items={folderItems(menuTargetFolder)}
          onClose={() => setMenu(null)}
          ariaLabel="Folder actions"
        />
      )}

      {/* ---- Template picker ---- */}
      {showTemplates && (
        <Modal title="From template" onClose={() => setShowTemplates(false)}>
          <div className="tpl-list">
            {SCREENPLAY_TEMPLATES.map((t) => {
              const preview = templatePreview(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  className="tpl-item"
                  onClick={() => {
                    setShowTemplates(false);
                    createAndOpen(
                      "screenplay",
                      "Untitled screenplay",
                      t.id === "blank" ? undefined : { content: buildTemplate(t.id) ?? undefined }
                    );
                  }}
                >
                  <span className="tpl-name">{t.label}</span>
                  <span className="tpl-desc">{t.description}</span>
                  {preview.length > 0 && (
                    <span className="tpl-preview">
                      {preview.map((line, i) => (
                        <span key={i}>{line}</span>
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </Modal>
      )}

      {/* ---- Move to… (the keyboard path for filing) ---- */}
      {moveTarget && (
        <Modal title={`Move "${moveTarget.title}"`} onClose={() => setMoveTarget(null)}>
          <div className="move-list">
            <button
              type="button"
              className={
                "move-item" + (effFolderId(moveTarget) === null ? " move-current" : "")
              }
              onClick={() => {
                onSetFolder(moveTarget.id, null);
                setMoveTarget(null);
              }}
            >
              Unfiled
            </button>
            {flatFolders.map(({ folder, depth }) => (
              <button
                key={folder.id}
                type="button"
                className={
                  "move-item" +
                  (effFolderId(moveTarget) === folder.id ? " move-current" : "")
                }
                style={{ paddingLeft: 12 + depth * 16 }}
                onClick={() => {
                  onSetFolder(moveTarget.id, folder.id);
                  setMoveTarget(null);
                }}
              >
                <span
                  className="snav-dot"
                  style={{ background: folder.color }}
                  aria-hidden="true"
                />
                {folder.name || "Untitled folder"}
              </button>
            ))}
          </div>
        </Modal>
      )}

      {/* ---- Folder color ---- */}
      {colorFolder && (
        <Modal title="Folder color" onClose={() => setColorTarget(null)}>
          <div className="folder-swatches" role="group" aria-label="Folder color">
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
                    aria-label="Pick a custom folder color"
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

      {/* ---- Delete a project ---- */}
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
          label: busy ? "Importing…" : "Apply",
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
