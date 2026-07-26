"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CloudUser as User } from "@/lib/cloud/client";
import type { JSONContent } from "@tiptap/core";
import { lsGet, lsSet, type Prefs } from "@/lib/storage/localStore";
import {
  getLastOpenedId,
  type ProjectMeta,
  type ProjectStatus,
  type ProjectType,
} from "@/lib/storage/projects";
import { FOLDER_COLORS, type Folder } from "@/lib/storage/folders";
import { listLibrary, type Card } from "@/lib/storage/library";
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

/**
 * Which folders the writer has explicitly opened or shut on the home, as
 * id -> open. A folder with no entry falls back to its default: stages start
 * open, projects start shut (except the one being written), sub-folders start
 * shut. So the home opens as a list of what you are making, not a wall of
 * every file inside it. Additive and local-only.
 */
const FOLDS_KEY = "less:home:folds:v1";

/* Two quiet glyphs so a draft and a note read apart at a glance: a page with
   a folded corner for a script, a lined sheet for a document. */
const ScriptGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <polyline points="14 3 14 8 19 8" />
  </svg>
);
const DocGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="5" y1="7" x2="19" y2="7" />
    <line x1="5" y1="12" x2="19" y2="12" />
    <line x1="5" y1="17" x2="13" y2="17" />
  </svg>
);

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

/* ---- The home ------------------------------------------------------------ */

export function ProjectsHome({
  projects,
  folders,
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
  onReorderFolders,
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
  /** Commit a new manual order for the ids of one container. */
  onReorder: (orderedIds: string[]) => void;
  /** Commit a new manual order for folders. */
  onReorderFolders: (orderedIds: string[]) => void;
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
    | { kind: "card" | "section" | "idea" | "item"; id: string; anchor: DOMRect }
  >(null);
  const openMenu = (
    e: React.MouseEvent,
    m:
      | { kind: "overflow" | "account" | "new" }
      | { kind: "card" | "section" | "idea" | "item"; id: string }
  ) => {
    e.stopPropagation();
    setMenu({ ...m, anchor: e.currentTarget.getBoundingClientRect() });
  };

  // Modals and inline edits.
  const [colorTarget, setColorTarget] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ProjectMeta | null>(null);
  // What the Move to modal is moving: a project, or a whole folder.
  const [moveTarget, setMoveTarget] = useState<
    null | { kind: "item"; meta: ProjectMeta } | { kind: "folder"; folder: Folder }
  >(null);
  const [confirmDeleteFilm, setConfirmDeleteFilm] = useState<Folder | null>(null);
  const [showCodeImport, setShowCodeImport] = useState(false);
  const [renamingFilm, setRenamingFilm] = useState<string | null>(null);
  const [renamingSection, setRenamingSection] = useState<string | null>(null);
  const [renamingItem, setRenamingItem] = useState<string | null>(null);

  // Which films are folded shut. Everything is OPEN by default: the home is
  // the whole library, not a table of contents, so a script is never more than
  // one click away. Only the films the writer folds by hand are remembered.
  const [folds, setFolds] = useState<Record<string, boolean>>(() => {
    try {
      const raw = JSON.parse(lsGet(FOLDS_KEY) ?? "{}");
      return raw && typeof raw === "object" ? (raw as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });
  /** Open unless the writer says otherwise, or the default says otherwise. */
  const isOpenFolder = (id: string, fallback: boolean) => folds[id] ?? fallback;
  const toggleFold = (id: string, fallback: boolean) => {
    setFolds((prev) => {
      const next = { ...prev, [id]: !(prev[id] ?? fallback) };
      lsSet(FOLDS_KEY, JSON.stringify(next));
      return next;
    });
  };

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

  /* ---- The library: the writer's own folders, at their own depth ---- */

  const library = useMemo(() => listLibrary(projects, folders), [projects, folders]);
  const sections = library.sections;
  const unfiled = library.unfiled;
  // "Now writing" is the folder holding whatever was last OPENED, not whatever
  // was last written to. Filing something stamps its clock, so a recency lead
  // moved the crown (and the wide card with it) when the writer was only
  // tidying up. Opening is a deliberate act; moving a file is not.
  const lead = useMemo(() => {
    const withWork = sections.flatMap((s) => s.cards).filter((c) => c.current);
    const lastId = getLastOpenedId();
    if (lastId) {
      const holding = withWork.find(
        (c) =>
          c.items.some((p) => p.id === lastId) ||
          c.shelves.some((sh) => sh.items.some((p) => p.id === lastId))
      );
      if (holding) return holding;
    }
    // Nothing opened on this device yet: fall back to the newest work.
    return (
      [...withWork].sort((a, b) =>
        a.lastTouched < b.lastTouched ? 1 : a.lastTouched > b.lastTouched ? -1 : 0
      )[0] ?? null
    );
  }, [sections]);

  /* ---- Drag: move anything into any folder ---- */

  // What is being dragged: a project (script or note), or a whole folder.
  // The ref is the authority during the drag (drop can fire before a render);
  // the state only drives the wash and the dimmed row.
  const drag = useRef<{ kind: "item" | "folder"; id: string } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  // The folder id currently under the pointer, or "unfiled" for the last band.
  const [dropFilm, setDropFilm] = useState<string | null>(null);

  // Where the row would land: which container, and the slot within it. The ref
  // is the authority (drop can fire before a render); the state draws the line.
  const caretRef = useRef<{ container: string; at: number } | null>(null);
  const [caret, setCaret] = useState<{ container: string; at: number } | null>(null);

  const clearDrag = () => {
    drag.current = null;
    caretRef.current = null;
    setDragging(null);
    setDropFilm(null);
    setCaret(null);
  };

  /** Is `maybe` inside `folderId` (or the folder itself)? A folder can never be
   *  dropped into its own branch: that would orphan it from the tree. */
  const isSelfOrInside = (folderId: string, maybe: string): boolean => {
    if (folderId === maybe) return true;
    const byId = new Map(folders.map((f) => [f.id, f]));
    let cur = byId.get(folderId);
    const seen = new Set<string>();
    while (cur?.parentId && byId.has(cur.parentId) && !seen.has(cur.parentId)) {
      if (cur.parentId === maybe) return true;
      seen.add(cur.parentId);
      cur = byId.get(cur.parentId);
    }
    return false;
  };

  /** Can what is being dragged land here? null means the unfiled band. */
  const canDropOn = (folderId: string | null): boolean => {
    const d = drag.current;
    if (!d) return false;
    if (d.kind === "item") return true;
    // A folder cannot go into itself or into anything already inside it.
    return folderId === null ? true : !isSelfOrInside(folderId, d.id);
  };

  /** Do the move, through the existing handlers so clocks stamp correctly. */
  const dropInto = (folderId: string | null) => {
    const d = drag.current;
    if (!d || !canDropOn(folderId)) return clearDrag();
    if (d.kind === "item") onSetFolder(d.id, folderId);
    else onUpdateFolder(d.id, { parentId: folderId });
    clearDrag();
  };

  /**
   * A heading is both a destination and a thing you can rearrange. Carrying a
   * TOP-LEVEL folder onto another heading reorders the headings; carrying
   * anything else onto it files that thing into the folder. Same level means
   * arrange, different level means put inside.
   */
  const isTopLevel = (id: string) => {
    const f = folders.find((x) => x.id === id);
    if (!f) return false;
    // An orphan parent means the folder already reads as top level.
    return !f.parentId || !folders.some((x) => x.id === f.parentId);
  };

  const headingDropProps = (sectionId: string) => ({
    onDragOver: (e: React.DragEvent) => {
      const d = drag.current;
      if (!d) return;
      const reordering = d.kind === "folder" && isTopLevel(d.id);
      if (!reordering) {
        if (!canDropOn(sectionId)) return;
        e.preventDefault();
        e.stopPropagation();
        setDropFilm(sectionId);
        caretRef.current = null;
        setCaret(null);
        return;
      }
      if (d.id === sectionId) return;
      e.preventDefault();
      e.stopPropagation();
      const tops = sections.map((sec) => sec.folder.id);
      const r = e.currentTarget.getBoundingClientRect();
      const idx = tops.indexOf(sectionId);
      const at = e.clientY < r.top + r.height / 2 ? idx : idx + 1;
      caretRef.current = { container: "sections", at };
      setCaret({ container: "sections", at });
      setDropFilm(null);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
        setDropFilm((f) => (f === sectionId ? null : f));
      }
    },
    onDrop: (e: React.DragEvent) => {
      const d = drag.current;
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      const target = caretRef.current;
      if (d.kind === "folder" && isTopLevel(d.id) && target?.container === "sections") {
        const ids = sections.map((sec) => sec.folder.id);
        const from = ids.indexOf(d.id);
        const to = target.at > from ? target.at - 1 : target.at;
        if (from >= 0 && to !== from) {
          ids.splice(from, 1);
          ids.splice(to, 0, d.id);
          onReorderFolders(ids);
        }
        clearDrag();
        return;
      }
      dropInto(sectionId);
    },
  });

  /** A folder or heading: drop here to file into it, order untouched. */
  const dropProps = (folderId: string | null, key: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!canDropOn(folderId)) return;
      e.preventDefault();
      e.stopPropagation();
      setDropFilm(key);
      caretRef.current = null;
      setCaret(null);
    },
    onDragLeave: (e: React.DragEvent) => {
      // Crossing a target's own children also fires dragleave; only a real
      // exit clears the wash.
      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
        setDropFilm((f) => (f === key ? null : f));
      }
    },
    onDrop: (e: React.DragEvent) => {
      if (!drag.current) return;
      e.preventDefault();
      e.stopPropagation();
      dropInto(folderId);
    },
  });

  /** Whatever can be picked up wears these. */
  const dragProps = (kind: "item" | "folder", id: string) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      // The innermost draggable wins: a row inside a card must not start the
      // card dragging as well.
      e.stopPropagation();
      drag.current = { kind, id };
      setDragging(id);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
    },
    onDragEnd: clearDrag,
  });

  /**
   * Placing a row is hit-tested across a WHOLE list, not per row. Aiming at
   * the hairline between two rows is impossible: land a pixel off and the card
   * behind them used to claim the drop and file the row into the wrong folder.
   * Now the nearest slot wins, wherever in the list you release, and a row
   * inside a sub-folder stays in that sub-folder.
   */
  const listDropProps = (
    containers: Record<string, ProjectMeta[]>,
    fallback: string
  ) => ({
    onDragOver: (e: React.DragEvent) => {
      if (drag.current?.kind !== "item") return;
      e.preventDefault();
      e.stopPropagation();
      const slots = [
        ...e.currentTarget.querySelectorAll<HTMLElement>("[data-slot]"),
      ];
      let target: { container: string; at: number } | null = null;
      for (const el of slots) {
        const r = el.getBoundingClientRect();
        if (e.clientY < r.top + r.height / 2) {
          target = { container: el.dataset.container!, at: Number(el.dataset.index) };
          break;
        }
      }
      if (!target) {
        const last = slots[slots.length - 1];
        target = last
          ? { container: last.dataset.container!, at: Number(last.dataset.index) + 1 }
          : { container: fallback, at: 0 };
      }
      caretRef.current = target;
      setCaret(target);
      setDropFilm(null);
    },
    onDrop: (e: React.DragEvent) => {
      const d = drag.current;
      const target = caretRef.current;
      if (d?.kind !== "item" || !target) return;
      e.preventDefault();
      e.stopPropagation();
      const items = containers[target.container] ?? [];
      const ids = items.map((p) => p.id);
      const from = ids.indexOf(d.id);
      if (from >= 0) {
        const to = target.at > from ? target.at - 1 : target.at; // the row leaves its slot first
        if (to !== from) {
          ids.splice(from, 1);
          ids.splice(to, 0, d.id);
          onReorder(ids);
        }
      } else {
        // Arriving from another folder: file it here, then place it.
        onSetFolder(d.id, target.container === "unfiled" ? null : target.container);
        ids.splice(target.at, 0, d.id);
        onReorder(ids);
      }
      clearDrag();
    },
  });

  /** A list of rows, each tagged with where it sits so the list can hit-test. */
  const itemList = (
    container: string,
    items: ProjectMeta[],
    opts: { indent?: number; currentId?: string } = {}
  ) => (
    <>
      {items.map((p, i) => (
        <div
          key={p.id}
          className="row-slot"
          data-slot=""
          data-container={container}
          data-index={i}
        >
          {caret?.container === container && caret.at === i && (
            <div className="drop-caret" aria-hidden="true" />
          )}
          {itemRow(p, opts.indent ?? 0, !!opts.currentId && p.id === opts.currentId)}
        </div>
      ))}
      {caret?.container === container && caret.at === items.length && (
        <div className="drop-caret" aria-hidden="true" />
      )}
    </>
  );

  /* ---- Flows ---- */

  /** Make something inside a folder and open it. */
  const createIn = (type: ProjectType, title: string, folderId: string) => {
    try {
      const meta = onCreate(type, title, { folderId });
      onOpen(meta.id, { focusTitle: true });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not create the project.", {
        variant: "danger",
      });
    }
  };

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

  // A new project inside a section: the folder appears on the desk as an empty
  // card, named on the spot.
  const newProjectIn = (sectionId: string) => {
    const f = onCreateFolder(sectionId);
    onUpdateFolder(f.id, { name: "Untitled project" });
    setRenamingFilm(f.id);
  };

  // A new top-level folder: a new heading on the home.
  const newSection = () => {
    const f = onCreateFolder();
    onUpdateFolder(f.id, { name: "Untitled folder" });
    setRenamingSection(f.id);
  };

  // Deleting a folder deletes ONLY the folder. Whatever it held moves up one
  // level to its parent, through the existing handlers, so nothing a writer
  // wrote is ever destroyed and nothing falls out of the tree.
  const removeFolder = (target: Folder) => {
    const up = target.parentId ?? null;
    folders
      .filter((sf) => sf.parentId === target.id)
      .forEach((sf) => onUpdateFolder(sf.id, { parentId: up }));
    projects
      .filter((p) => p.folderId === target.id)
      .forEach((p) => onSetFolder(p.id, up));
    onDeleteFolder(target.id);
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

  // Every folder with its path, so two folders sharing a name are still
  // telling apart. Drag does the same job with the mouse; this is the way that
  // works from the keyboard.
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

  // The two levels of the home, plus the two kinds of writing.
  const newItems: MenuItem[] = [
    { label: "New script", onSelect: () => createAndOpen("screenplay", "Untitled screenplay") },
    { label: "New document", onSelect: () => createAndOpen("plain", "") },
    { kind: "divider" },
    { label: "New folder", onSelect: newSection },
    {
      label: importing ? "Importing" : "Import files",
      onSelect: () => importInputRef.current?.click(),
      disabled: importing,
    },
  ];

  /** A folder's kebab, on a card or a shelf: everything you can do to it. */
  const cardItems = (f: Folder): MenuItem[] => [
    {
      label: "New script here",
      onSelect: () => createIn("screenplay", "Untitled screenplay", f.id),
    },
    { label: "New document here", onSelect: () => createIn("plain", "", f.id) },
    { kind: "divider" },
    { label: "Rename", onSelect: () => setRenamingFilm(f.id) },
    { label: "Color", onSelect: () => setColorTarget(f.id) },
    { label: "Move to", onSelect: () => setMoveTarget({ kind: "folder", folder: f }) },
    { kind: "divider" },
    { label: "Delete folder", danger: true, onSelect: () => setConfirmDeleteFilm(f) },
  ];

  /** A section heading's kebab. */
  const sectionItems = (f: Folder): MenuItem[] => [
    { label: "New project in here", onSelect: () => newProjectIn(f.id) },
    {
      label: "New script here",
      onSelect: () => createIn("screenplay", "Untitled screenplay", f.id),
    },
    { label: "New document here", onSelect: () => createIn("plain", "", f.id) },
    { label: "Rename", onSelect: () => setRenamingSection(f.id) },
    { label: "Move to", onSelect: () => setMoveTarget({ kind: "folder", folder: f }) },
    { kind: "divider" },
    { label: "Delete folder", danger: true, onSelect: () => setConfirmDeleteFilm(f) },
  ];

  // A draft or document listed under its film on the home.
  const itemItems = (p: ProjectMeta): MenuItem[] => [
    { label: "Open", onSelect: () => onOpen(p.id) },
    { label: "Rename", onSelect: () => setRenamingItem(p.id) },
    { label: "Move to", onSelect: () => setMoveTarget({ kind: "item", meta: p }) },
    { kind: "divider" },
    { label: "Delete", danger: true, onSelect: () => setConfirmDelete(p) },
  ];

  const ideaItems = (idea: ProjectMeta): MenuItem[] => [
    { label: "Open", onSelect: () => onOpen(idea.id) },
    { label: "Move to", onSelect: () => setMoveTarget({ kind: "item", meta: idea }) },
    { kind: "divider" },
    { label: "Delete", danger: true, onSelect: () => setConfirmDelete(idea) },
  ];

  /* ---- Search: one flat list across everything ---- */

  const q = query.trim().toLowerCase();
  type Hit =
    | { key: string; kind: "folder"; folder: Folder; where: string }
    | { key: string; kind: "script" | "document"; meta: ProjectMeta; where: string };
  const hits = useMemo<Hit[]>(() => {
    if (!q) return [];
    const out: Hit[] = [];
    const addProject = (p: ProjectMeta, where: string) => {
      if (p.title.toLowerCase().includes(q)) {
        out.push({
          key: "p:" + p.id,
          kind: p.type === "screenplay" ? "script" : "document",
          meta: p,
          where,
        });
      }
    };
    for (const section of sections) {
      if (section.folder.name.toLowerCase().includes(q)) {
        out.push({ key: "f:" + section.folder.id, kind: "folder", folder: section.folder, where: "" });
      }
      for (const p of section.loose) addProject(p, section.folder.name);
      for (const card of section.cards) {
        if (card.folder.name.toLowerCase().includes(q)) {
          out.push({
            key: "f:" + card.folder.id,
            kind: "folder",
            folder: card.folder,
            where: section.folder.name,
          });
        }
        for (const p of card.items) addProject(p, card.folder.name);
        for (const shelf of card.shelves) {
          if (shelf.folder.name.toLowerCase().includes(q)) {
            out.push({
              key: "f:" + shelf.folder.id,
              kind: "folder",
              folder: shelf.folder,
              where: card.folder.name,
            });
          }
          for (const p of shelf.items) addProject(p, shelf.folder.name);
        }
      }
    }
    for (const p of unfiled) addProject(p, "");
    return out;
  }, [q, sections, unfiled]);

  /** Open a folder and everything above it, so it is actually on screen. */
  const revealFolder = (id: string) => {
    const byId = new Map(folders.map((f) => [f.id, f]));
    const next: Record<string, boolean> = { ...folds };
    let cur = byId.get(id);
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      next[cur.id] = true;
      seen.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    setFolds(next);
    lsSet(FOLDS_KEY, JSON.stringify(next));
    setQuery("");
  };

  const openHit = (hit: Hit) => {
    // A folder is not a place you go to; it is a thing on this page. Show it.
    if (hit.kind === "folder") revealFolder(hit.folder.id);
    else onOpen(hit.meta.id);
  };

  const HIT_WORD: Record<Hit["kind"], string> = {
    folder: "Folder",
    script: "Script",
    document: "Document",
  };

  /* ---- Renders ---- */

  /** One script or document, listed inside its card. The home lists everything
   *  a folder holds, so nothing lives more than one click from here.
   *  `indent` steps the row in to match the shelf it belongs to. */
  const itemRow = (p: ProjectMeta, indent = 0, isCurrent = false) => {
    const renaming = renamingItem === p.id;
    const open = (e: React.SyntheticEvent) => {
      // The card around this row has its own click action.
      e.stopPropagation();
      if (!renaming) onOpen(p.id);
    };
    return (
      <div
        key={p.id}
        className={"fh-item" + (dragging === p.id ? " dragging" : "")}
        style={indent ? { paddingLeft: 14 + indent * 12 } : undefined}
        role="button"
        tabIndex={0}
        {...dragProps("item", p.id)}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open(e);
          }
        }}
      >
        <span className="fh-item-kind" aria-hidden="true">
          {p.type === "screenplay" ? <ScriptGlyph /> : <DocGlyph />}
        </span>
        {renaming ? (
          <NameInput
            initial={p.title}
            className="line-rename"
            ariaLabel={p.type === "screenplay" ? "Draft title" : "Document title"}
            onCommit={(name) => {
              if (name && name !== p.title) onRename(p.id, name);
            }}
            onDone={() => setRenamingItem(null)}
          />
        ) : (
          <span className="fh-item-title">{p.title}</span>
        )}
        <span className="fh-item-meta">
          {/* Only the lead card carries this: it marks the row its Continue
              line points at, so that line reads as a shortcut to this row
              rather than a second copy of it. Elsewhere it would just be
              noise, and on an archive folder it would be a lie. */}
          {isCurrent && <span className="fh-item-current">Current</span>}
          {p.type === "screenplay" && p.pageCount != null && (
            <span>{p.pageCount} pp</span>
          )}
          <span>{relativeTime(p.updatedAt)}</span>
        </span>
        <button
          type="button"
          className="fh-kebab"
          aria-label={`Actions for ${p.title}`}
          aria-haspopup="menu"
          onClick={(e) => openMenu(e, { kind: "item", id: p.id })}
        >
          <DotsIcon />
        </button>
      </div>
    );
  };

  /** One card: a project folder, with everything it holds inside its edges.
   *  Sub-folders keep their own names as shelves, at any depth. */
  const cardBlock = (card: Card, isLead: boolean) => {
    const f = card.folder;
    const renaming = renamingFilm === f.id;
    // A project starts shut; the card you are writing in starts open.
    const isOpen = isOpenFolder(f.id, isLead);
    const draft = card.current;
    const openFolder = (e: React.SyntheticEvent) => {
      e.stopPropagation();
      if (!renaming) toggleFold(f.id, isLead);
    };
    return (
      <article
        key={f.id}
        className={
          "pcard" +
          (isLead ? " lead" : "") +
          (dropFilm === f.id ? " dropping" : "") +
          (dragging === f.id ? " dragging" : "")
        }
        style={{ ["--fc" as string]: f.color }}
        {...dragProps("folder", f.id)}
        {...dropProps(f.id, f.id)}
      >
        <div className="pcard-spine" aria-hidden="true" />
        <div className="pcard-head">
          {isLead && <div className="lead-label">Now writing</div>}
          <div className="pcard-top">
            {card.total > 0 && (
              <button
                type="button"
                className={"film-caret" + (isOpen ? " open" : "")}
                aria-expanded={isOpen}
                aria-label={
                  isOpen ? `Hide what is inside ${f.name}` : `Show what is inside ${f.name}`
                }
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFold(f.id, isLead);
                }}
              >
                <ChevronDown />
              </button>
            )}
            {renaming ? (
              <NameInput
                initial={f.name}
                className="pcard-rename"
                ariaLabel="Folder name"
                onCommit={(name) => {
                  if (name) onUpdateFolder(f.id, { name });
                }}
                onDone={() => setRenamingFilm(null)}
              />
            ) : (
              <button type="button" className="pcard-name" onClick={openFolder}>
                {f.name}
              </button>
            )}
            <button
              type="button"
              className="fh-kebab"
              aria-label={`Actions for ${f.name}`}
              aria-haspopup="menu"
              onClick={(e) => openMenu(e, { kind: "card", id: f.id })}
            >
              <DotsIcon />
            </button>
          </div>

          <div className="pcard-meta">
            {isLead && draft ? (
              <button
                type="button"
                className="pcard-continue"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen(draft.id);
                }}
              >
                Continue {draft.title}
                {draft.pageCount != null
                    ? `, ${draft.pageCount} page${draft.pageCount === 1 ? "" : "s"}`
                    : ""}
              </button>
            ) : (
              <span>{card.total === 0 ? "Empty" : `${card.total} item${card.total === 1 ? "" : "s"}`}</span>
            )}
            <span className="film-when">{relativeTime(card.lastTouched)}</span>
          </div>
        </div>

        {isOpen && card.total > 0 && (
          <div
            className="pcard-list"
            {...listDropProps(
              {
                [f.id]: card.items,
                ...Object.fromEntries(card.shelves.map((sh) => [sh.folder.id, sh.items])),
              },
              f.id
            )}
          >
            {itemList(f.id, card.items, {
              currentId: isLead ? card.current?.id : undefined,
            })}
            {card.shelves.map((shelf) => {
              const shelfOpen = isOpenFolder(shelf.folder.id, false);
              return (
              <div key={shelf.folder.id} className="pcard-shelfgroup">
                <div
                  className={
                    "shelf" +
                    (dropFilm === shelf.folder.id ? " dropping" : "") +
                    (dragging === shelf.folder.id ? " dragging" : "")
                  }
                  style={{ paddingLeft: 14 + (shelf.depth - 1) * 12 }}
                  {...dragProps("folder", shelf.folder.id)}
                  {...dropProps(shelf.folder.id, shelf.folder.id)}
                >
                  {shelf.items.length > 0 && (
                    <button
                      type="button"
                      className={"film-caret shelf-caret" + (shelfOpen ? " open" : "")}
                      aria-expanded={shelfOpen}
                      aria-label={
                        shelfOpen
                          ? `Hide what is inside ${shelf.folder.name}`
                          : `Show what is inside ${shelf.folder.name}`
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFold(shelf.folder.id, false);
                      }}
                    >
                      <ChevronDown />
                    </button>
                  )}
                  <span
                    className="shelf-dot"
                    style={{ background: shelf.folder.color }}
                    aria-hidden="true"
                  />
                  <button
                    type="button"
                    className="shelf-name"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFold(shelf.folder.id, false);
                    }}
                  >
                    {shelf.folder.name}
                  </button>
                  <span className="shelf-ct">{shelf.items.length}</span>
                  <button
                    type="button"
                    className="fh-kebab"
                    aria-label={`Actions for ${shelf.folder.name}`}
                    aria-haspopup="menu"
                    onClick={(e) => openMenu(e, { kind: "card", id: shelf.folder.id })}
                  >
                    <DotsIcon />
                  </button>
                </div>
                {shelfOpen &&
                  itemList(shelf.folder.id, shelf.items, {
                    indent: shelf.depth,
                    currentId: isLead ? card.current?.id : undefined,
                  })}
              </div>
              );
            })}
          </div>
        )}
      </article>
    );
  };

  const ideaRow = (idea: ProjectMeta) => (
    <div
      key={idea.id}
      className={"idea" + (dragging === idea.id ? " dragging" : "")}
      role="button"
      tabIndex={0}
      {...dragProps("item", idea.id)}
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

  const menuTargetCard =
    menu?.kind === "card" ? folders.find((f) => f.id === menu.id) ?? null : null;
  const menuTargetSection =
    menu?.kind === "section" ? folders.find((f) => f.id === menu.id) ?? null : null;
  const menuTargetIdea =
    menu?.kind === "idea" ? unfiled.find((p) => p.id === menu.id) ?? null : null;
  const menuTargetItem =
    menu?.kind === "item" ? projects.find((p) => p.id === menu.id) ?? null : null;
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
          /* Searching: the desk hides and one flat result list takes over. */
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
                    {hit.kind === "folder" ? hit.folder.name : hit.meta.title}
                  </span>
                  <span className="fh-hit-kind">{HIT_WORD[hit.kind]}</span>
                  {hit.where && <span className="fh-hit-film">{hit.where}</span>}
                </div>
              ))}
            </div>
          ) : (
            <p className="list-empty">Nothing matches that search.</p>
          )
        ) : (
          <>
            {sections.map((section, si) => {
              const sf = section.folder;
              const renamingSec = renamingSection === sf.id;
              const sectionOpen = isOpenFolder(sf.id, true);
              // What folding this away would hide, so the count is only shown
              // when it is the one clue left.
              const held =
                section.cards.reduce((n, c) => n + c.total, 0) + section.loose.length;
              return (
                <section key={sf.id} className="desk-section">
                  {caret?.container === "sections" && caret.at === si && (
                    <div className="drop-caret caret-section" aria-hidden="true" />
                  )}
                  <div
                    className={
                      "band" +
                      (si > 0 ? " later" : "") +
                      (dropFilm === sf.id ? " dropping" : "") +
                      (dragging === sf.id ? " dragging" : "")
                    }
                    {...dragProps("folder", sf.id)}
                    {...headingDropProps(sf.id)}
                  >
                    <button
                      type="button"
                      className={"film-caret band-caret" + (sectionOpen ? " open" : "")}
                      aria-expanded={sectionOpen}
                      aria-label={
                        sectionOpen ? `Fold ${sf.name} away` : `Open ${sf.name}`
                      }
                      onClick={() => toggleFold(sf.id, true)}
                    >
                      <ChevronDown />
                    </button>
                    {renamingSec ? (
                      <NameInput
                        initial={sf.name}
                        className="band-rename"
                        ariaLabel="Folder name"
                        onCommit={(name) => {
                          if (name) onUpdateFolder(sf.id, { name });
                        }}
                        onDone={() => setRenamingSection(null)}
                      />
                    ) : (
                      <button
                        type="button"
                        className="band-name"
                        onClick={() => toggleFold(sf.id, true)}
                      >
                        {sf.name}
                      </button>
                    )}
                    <button
                      type="button"
                      className="fh-kebab band-kebab"
                      aria-label={`Actions for ${sf.name}`}
                      aria-haspopup="menu"
                      onClick={(e) => openMenu(e, { kind: "section", id: sf.id })}
                    >
                      <DotsIcon />
                    </button>
                    {!sectionOpen && held > 0 && (
                      <span className="band-ct">
                        {held} item{held === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>

                  {sectionOpen && (
                    <>
                      <div className="desk-grid">
                        {section.cards.map((card) => cardBlock(card, card === lead))}
                        <button
                          type="button"
                          className="pcard pcard-new"
                          onClick={() => newProjectIn(sf.id)}
                        >
                          New project in {sf.name}
                        </button>
                      </div>

                      {section.loose.length > 0 && (
                        <div
                          className="desk-loose"
                          {...listDropProps({ [sf.id]: section.loose }, sf.id)}
                        >
                          {itemList(sf.id, section.loose)}
                        </div>
                      )}
                    </>
                  )}
                  {caret?.container === "sections" &&
                    caret.at === sections.length &&
                    si === sections.length - 1 && (
                      <div className="drop-caret caret-section" aria-hidden="true" />
                    )}
                </section>
              );
            })}

            <div
              className={
                "band" +
                (sections.length > 0 ? " later" : "") +
                (dropFilm === "unfiled" ? " dropping" : "")
              }
              {...dropProps(null, "unfiled")}
            >
              <span className="band-name band-plain">Not in a folder</span>
            </div>
            {unfiled.map(ideaRow)}
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
      {menuTargetCard && menu?.kind === "card" && (
        <Menu
          anchor={menu.anchor}
          items={cardItems(menuTargetCard)}
          onClose={() => setMenu(null)}
          ariaLabel="Folder actions"
        />
      )}
      {menuTargetSection && menu?.kind === "section" && (
        <Menu
          anchor={menu.anchor}
          items={sectionItems(menuTargetSection)}
          onClose={() => setMenu(null)}
          ariaLabel="Folder actions"
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
      {menuTargetItem && menu?.kind === "item" && (
        <Menu
          anchor={menu.anchor}
          items={itemItems(menuTargetItem)}
          onClose={() => setMenu(null)}
          ariaLabel={menuTargetItem.type === "screenplay" ? "Draft actions" : "Document actions"}
        />
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

      {/* ---- Move to: the keyboard path for what drag does with a mouse ---- */}
      {moveTarget && (
        <Modal
          title={`Move "${
            moveTarget.kind === "item" ? moveTarget.meta.title : moveTarget.folder.name
          }"`}
          onClose={() => setMoveTarget(null)}
        >
          <div className="move-list">
            <button
              type="button"
              className="move-item"
              onClick={() => {
                if (moveTarget.kind === "item") onSetFolder(moveTarget.meta.id, null);
                else onUpdateFolder(moveTarget.folder.id, { parentId: null });
                setMoveTarget(null);
              }}
            >
              Not in a folder
            </button>
            {moveTargets
              .filter(
                ({ folder: f }) =>
                  moveTarget.kind === "item" ||
                  !isSelfOrInside(f.id, moveTarget.folder.id)
              )
              .map(({ folder: f, path }) => {
                const here =
                  moveTarget.kind === "item"
                    ? moveTarget.meta.folderId === f.id
                    : moveTarget.folder.parentId === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    className={"move-item" + (here ? " move-current" : "")}
                    onClick={() => {
                      if (moveTarget.kind === "item") onSetFolder(moveTarget.meta.id, f.id);
                      else onUpdateFolder(moveTarget.folder.id, { parentId: f.id });
                      setMoveTarget(null);
                    }}
                  >
                    <span
                      className="move-dot"
                      style={{ background: f.color }}
                      aria-hidden="true"
                    />
                    {f.name}
                    {path && <span className="move-path">{path}</span>}
                  </button>
                );
              })}
          </div>
        </Modal>
      )}

      {/* ---- Delete a folder (the folder only; contents move up a level) ---- */}
      {confirmDeleteFilm && (
        <Modal
          title="Delete folder"
          onClose={() => setConfirmDeleteFilm(null)}
          actions={[{ label: "Cancel", onClick: () => setConfirmDeleteFilm(null) }]}
        >
          <p>
            Delete the folder &quot;{confirmDeleteFilm.name}&quot;? Nothing inside
            it is deleted. Its scripts, documents and sub-folders move up one
            level, into{" "}
            {confirmDeleteFilm.parentId
              ? `"${folders.find((f) => f.id === confirmDeleteFilm.parentId)?.name ?? "the level above"}"`
              : "the top level"}
            .
          </p>
          <div className="hold-row">
            <HoldDelete onConfirm={() => removeFolder(confirmDeleteFilm)} />
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
