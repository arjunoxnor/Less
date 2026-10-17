"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/core";
import type { CloudUser as User } from "@/lib/cloud/client";
import { lsGet, lsSet, type Prefs } from "@/lib/storage/localStore";
import {
  getLastOpenedId,
  loadBreakdown,
  loadProjectDoc,
  saveBreakdown,
  type ProjectMeta,
  type ProjectType,
} from "@/lib/storage/projects";
import { copyTitle, loadBodyForCopy } from "@/lib/storage/duplicate";
import type { Folder } from "@/lib/storage/folders";
import {
  canMoveFolderTo,
  canMoveProjectTo,
  listLibrary,
  MAX_LIBRARY_NAME_LENGTH,
  pruneFolderFolds,
  reorderIdsAtSlot,
  type Card,
  type Section,
  type Shelf,
} from "@/lib/storage/library";
import { planFolderCardDrop } from "@/lib/storage/libraryInteraction";
import type { TitlePage } from "@/lib/export/titlePage";
import { IMPORT_ACCEPT } from "@/lib/export";
import {
  isProseKind,
  KIND_LABEL,
  KIND_ONE,
  KIND_PLURAL,
  kindOf,
  type DocKind,
} from "@/lib/cover/kinds";
import { groupStacks, headOf, suggestStacks, versionRoot, type StackGroup, type StackSuggestion } from "@/lib/cover/stacks";
import {
  groupKeyOf,
  insertAtGroupSlot,
  paletteSeedOf,
  planDraftStack,
  planMakeCurrent,
  planStack,
  planStackAll,
  planUnstack,
  reorderGroups,
  type OrgFields,
  type OrgPatch,
} from "@/lib/cover/desk";
import { KIND_COLOR, paletteFor, stickyFor } from "@/lib/cover/palette";
import { NEW_TITLE, starterFor } from "@/lib/cover/starters";
import { Menu, type MenuItem } from "./ui/Menu";
import { showToast } from "./ui/Toast";
import { DotsIcon, PersonIcon } from "./chrome/icons";
import { ThemeToggle } from "./chrome/ThemeToggle";
import { Cover } from "./desk/Cover";
import { DeskTile } from "./desk/DeskTile";
import { DeskGrid, DeskTray } from "./desk/DeskGrid";
import { ProjectTile } from "./desk/ProjectTile";
import { KindPickerModal, StackWithModal } from "./desk/DeskModals";
import { CoversGlyph, ListGlyph } from "./desk/glyphs";
import {
  ChevronDown,
  CodeImportModal,
  FolderGlyph,
  MenuGlyph,
  NameInput,
  relativeTime,
  SearchGlyph,
  STATUS_LABEL,
} from "./home/homeParts";
import { HomeRow } from "./home/HomeRow";
import { HomeSidebar, type HomeView } from "./home/HomeSidebar";
import { useHomeDrag, type HomeDragSource, type HomeDrop } from "./home/useHomeDrag";
import {
  DeleteFolderModal,
  DeleteProjectModal,
  FolderColorModal,
  MoveToModal,
  type MoveTarget,
} from "./home/HomeModals";

export { HoldDelete, NameInput, relativeTime, StatusWord } from "./home/homeParts";

/**
 * The home: a library. Down the left, the writer's own folders at the depth
 * they built them: stages (InProgress, Completed) with their projects inside.
 * On the right, Recent (the script being written, big, then what was touched
 * lately), a stage (its projects as cards), or a project (everything in it,
 * its own folders as groups). Every write goes through the existing handlers,
 * so sync, clocks and folder rules behave exactly as before.
 *
 * Dragging is pointer-based (components/home/useHomeDrag.ts): a script can be
 * carried onto any project in the sidebar, or to a place in a list, and both
 * panes scroll by themselves near their edges while it is carried.
 */

/** Which folders the writer has opened or shut, as id -> open. Local only. */
const FOLDS_KEY = "less:home:folds:v1";
/** What the home was showing, so it comes back to the same place. */
const VIEW_KEY = "less:home:view:v1";
/** Covers (the desk) or the plain list. Local only. */
const LAYOUT_KEY = "less:home:layout:v1";
/** Stack suggestions the writer said "Not now" to. Local only. */
const DISMISSED_KEY = "less:desk:dismissed:v1";
const RECENT_COUNT = 8;

type Layout = "covers" | "list";

const nowIso = () => new Date().toISOString();
const freshId = () => crypto.randomUUID();
const capitalize = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1);

function readDismissed(): string[] {
  try {
    const raw = JSON.parse(lsGet(DISMISSED_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((k): k is string => typeof k === "string").slice(-200) : [];
  } catch {
    return [];
  }
}

/** "Pitch, Oct 17", or "Pitch, Oct 17 (2)" when that name is taken. */
function draftTitle(title: string, taken: string[]): string {
  const day = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const base = `${title.trim() || "Untitled"}, ${day}`;
  const names = new Set(taken.map((t) => t.trim().toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  let n = 2;
  while (names.has(`${base} (${n})`.toLowerCase())) n++;
  return `${base} (${n})`;
}

function readView(): HomeView {
  const raw = lsGet(VIEW_KEY) ?? "";
  if (raw === "unfiled") return { kind: "unfiled" };
  if (raw.startsWith("stage:")) return { kind: "stage", id: raw.slice(6) };
  if (raw.startsWith("project:")) return { kind: "project", id: raw.slice(8) };
  return { kind: "recent" };
}

function writeView(view: HomeView) {
  lsSet(
    VIEW_KEY,
    view.kind === "recent" || view.kind === "unfiled" ? view.kind : `${view.kind}:${view.id}`
  );
}

/** The first line worth showing from a script: its first scene heading, else its first words. */
function firstLineOf(id: string): string {
  const doc = loadProjectDoc(id);
  let first = "";
  for (const node of doc?.content ?? []) {
    const text = (node.content ?? []).map((n) => n.text ?? "").join("").trim();
    if (!text) continue;
    if ((node.attrs as { element?: string } | undefined)?.element === "scene_heading") {
      return text.slice(0, 90);
    }
    if (!first) first = text;
  }
  return first.slice(0, 90);
}

type HomeMenu =
  | null
  | { kind: "overflow" | "account" | "new"; anchor: DOMRect }
  | { kind: "folder" | "item"; id: string; anchor: DOMRect };

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
  onSetOrg,
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
      status?: ProjectMeta["status"];
      kind?: string;
      stackId?: string;
      stackTop?: string;
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
  /** Change what a document is, or which stack it is a version in. */
  onSetOrg?: (id: string, fields: OrgFields) => void;
}) {
  /* ---- View state ---- */
  const [query, setQuery] = useState("");
  const [jot, setJot] = useState("");
  // Starts on Recent to match the page as it was built; the view the writer
  // left is restored once the page is live (reading storage during the first
  // render would disagree with the prebuilt page).
  const [view, setViewState] = useState<HomeView>({ kind: "recent" });
  // Covers unless the writer chose the list; restored with the view, after
  // the first render, for the same reason.
  const [layout, setLayoutState] = useState<Layout>("covers");
  useEffect(() => {
    setViewState(readView());
    if (lsGet(LAYOUT_KEY) === "list") setLayoutState("list");
  }, []);
  const setLayout = (next: Layout) => {
    setLayoutState(next);
    lsSet(LAYOUT_KEY, next);
    setTrayKey(null);
  };
  const desk = layout === "covers";
  /** The stack fanned out on the desk, as "<where>|<group key>". */
  const [trayKey, setTrayKey] = useState<string | null>(null);
  /** Show only one kind of thing (a project's own filter). */
  const [kindFilter, setKindFilter] = useState<DocKind | null>(null);
  /** The document whose kind is being picked, or which is being stacked. */
  const [kindTarget, setKindTarget] = useState<string | null>(null);
  const [stackTarget, setStackTarget] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  useEffect(() => setDismissed(readDismissed()), []);
  const [sideOpen, setSideOpen] = useState(false);
  const [menu, setMenu] = useState<HomeMenu>(null);
  const [colorTarget, setColorTarget] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ProjectMeta | null>(null);
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);
  const [confirmDeleteFolder, setConfirmDeleteFolder] = useState<Folder | null>(null);
  const [showCodeImport, setShowCodeImport] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renamingItem, setRenamingItem] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const sideRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  const select = (next: HomeView) => {
    setViewState(next);
    writeView(next);
    setSideOpen(false);
    setQuery("");
    setTrayKey(null);
    setKindFilter(null);
    mainRef.current?.scrollTo?.({ top: 0 });
  };

  /* ---- Folds: stages start open, folders inside a project start shut ---- */
  const [folds, setFolds] = useState<Record<string, boolean>>(() => {
    try {
      const raw = JSON.parse(lsGet(FOLDS_KEY) ?? "{}");
      return raw && typeof raw === "object" ? (raw as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });
  const foldersLoadedRef = useRef(folders.length > 0);
  const isOpenFolder = (id: string, fallback: boolean) => folds[id] ?? fallback;
  const setFold = (id: string, open: boolean) => {
    setFolds((prev) => {
      if (prev[id] === open) return prev;
      const next = { ...prev, [id]: open };
      lsSet(FOLDS_KEY, JSON.stringify(next));
      return next;
    });
  };
  const toggleFold = (id: string, fallback: boolean) => setFold(id, !(folds[id] ?? fallback));

  useEffect(() => {
    // useProjects hydrates folders after the first render. An initial empty
    // array is not proof that every saved folder was deleted.
    if (folders.length === 0 && !foldersLoadedRef.current) return;
    if (folders.length > 0) foldersLoadedRef.current = true;
    setFolds((prev) => {
      const next = pruneFolderFolds(prev, folders);
      if (
        Object.keys(next).length === Object.keys(prev).length &&
        Object.keys(next).every((id) => next[id] === prev[id])
      ) {
        return prev;
      }
      lsSet(FOLDS_KEY, JSON.stringify(next));
      return next;
    });
  }, [folders]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== FOLDS_KEY && event.key !== null) return;
      try {
        const raw = event.newValue ? JSON.parse(event.newValue) : {};
        setFolds(pruneFolderFolds(raw && typeof raw === "object" ? raw : {}, folders));
      } catch {
        setFolds({});
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [folders]);

  // Relative times refresh once a minute while the home is on screen.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  // "/" focuses the search field when not already typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ---- The library: the writer's own folders, at their own depth ---- */

  const library = useMemo(() => listLibrary(projects, folders), [projects, folders]);
  const { sections, unfiled } = library;
  const lookups = useMemo(() => {
    const projectById = new Map<string, ProjectMeta>();
    const folderById = new Map<string, Folder>();
    const sectionById = new Map<string, Section>();
    const cardById = new Map<string, Card>();
    const shelfById = new Map<string, Shelf>();
    const stageOfCard = new Map<string, Section>();
    // Where each project lives, as the Recent list and search name it.
    const place = new Map<string, { label: string; color: string }>();
    for (const p of unfiled) projectById.set(p.id, p);
    for (const section of sections) {
      sectionById.set(section.folder.id, section);
      folderById.set(section.folder.id, section.folder);
      for (const p of section.loose) {
        projectById.set(p.id, p);
        place.set(p.id, { label: section.folder.name, color: section.folder.color });
      }
      for (const card of section.cards) {
        cardById.set(card.folder.id, card);
        stageOfCard.set(card.folder.id, section);
        folderById.set(card.folder.id, card.folder);
        for (const p of card.items) {
          projectById.set(p.id, p);
          place.set(p.id, { label: card.folder.name, color: card.folder.color });
        }
        for (const shelf of card.shelves) {
          shelfById.set(shelf.folder.id, shelf);
          folderById.set(shelf.folder.id, shelf.folder);
          for (const p of shelf.items) {
            projectById.set(p.id, p);
            place.set(p.id, {
              label: `${card.folder.name} / ${shelf.folder.name}`,
              color: card.folder.color,
            });
          }
        }
      }
    }
    return { projectById, folderById, sectionById, cardById, shelfById, stageOfCard, place };
  }, [sections, unfiled]);
  const { projectById, folderById, sectionById, cardById, shelfById, stageOfCard, place } = lookups;

  /* ---- The desk: what each thing is, and the stacks it is in ---- */

  /**
   * Folder names from a document's own folder outward, for reading its kind
   * from where it is filed (a document in "One Pagers" is a one-pager). The
   * top level is left out: a stage called "Ideas" is a stage, and does not
   * make everything in it a note.
   */
  const folderTrail = useMemo(() => {
    const cache = new Map<string, string[]>();
    return (id: string | undefined): string[] => {
      if (!id) return [];
      const hit = cache.get(id);
      if (hit) return hit;
      const names: string[] = [];
      const seen = new Set<string>();
      let cursor = folderById.get(id);
      while (cursor && !seen.has(cursor.id) && cursor.parentId && folderById.has(cursor.parentId)) {
        seen.add(cursor.id);
        names.push(cursor.name);
        cursor = folderById.get(cursor.parentId);
      }
      cache.set(id, names);
      return names;
    };
  }, [folderById]);
  const kindFor = (p: ProjectMeta): DocKind => kindOf(p.type, p.title, p.kind, folderTrail(p.folderId));
  const seedFor = (p: ProjectMeta) => paletteSeedOf(p);
  const allDocs = useMemo(() => [...projectById.values()], [projectById]);
  /** Every version in a document's stack, wherever each is filed, current first. */
  const stackOf = (p: ProjectMeta): ProjectMeta[] => {
    if (!p.stackId) return [p];
    const members = allDocs.filter((d) => d.stackId === p.stackId);
    if (members.length < 2) return [p];
    const head = headOf(members);
    return [head, ...members.filter((m) => m !== head).sort((a, b) => b.createdAt.localeCompare(a.createdAt))];
  };
  const coverColor = (p: ProjectMeta) =>
    kindFor(p) === "notes" ? stickyFor(seedFor(p)) : paletteFor(seedFor(p)).bg;

  /** The projects in one container, in the writer's order. */
  const itemsIn = (container: string): ProjectMeta[] =>
    container === "unfiled"
      ? unfiled
      : (sectionById.get(container)?.loose ??
        cardById.get(container)?.items ??
        shelfById.get(container)?.items ??
        []);

  /** A folder with no live parent reads as a stage (top level). */
  const isStage = (id: string) => {
    const f = folderById.get(id);
    return !!f && (!f.parentId || !folderById.has(f.parentId));
  };

  // A view whose folder is gone (deleted here or in another tab) goes back
  // to Recent rather than showing an empty page.
  useEffect(() => {
    if (!foldersLoadedRef.current && folders.length === 0) return;
    if (
      (view.kind === "stage" && !sectionById.has(view.id)) ||
      (view.kind === "project" && !cardById.has(view.id))
    ) {
      setViewState({ kind: "recent" });
      writeView({ kind: "recent" });
    }
  }, [view, sectionById, cardById, folders.length]);

  // Keep open layers attached to live data. A rename in another tab updates
  // the wording in place; a delete closes the stale action before it can run.
  useEffect(() => {
    setConfirmDelete((target) => (target ? projectById.get(target.id) ?? null : null));
    setConfirmDeleteFolder((target) => (target ? folderById.get(target.id) ?? null : null));
    setMoveTarget((target) => {
      if (!target) return null;
      if (target.kind === "item") {
        const meta = projectById.get(target.meta.id);
        return meta ? { kind: "item", meta } : null;
      }
      const folder = folderById.get(target.folder.id);
      return folder ? { kind: "folder", folder } : null;
    });
  }, [folderById, projectById]);

  useEffect(() => {
    const menuStale =
      menu?.kind === "folder"
        ? !folderById.has(menu.id)
        : menu?.kind === "item"
          ? !projectById.has(menu.id)
          : false;
    const stale =
      menuStale ||
      (colorTarget !== null && !folderById.has(colorTarget)) ||
      (confirmDelete !== null && !projectById.has(confirmDelete.id)) ||
      (confirmDeleteFolder !== null && !folderById.has(confirmDeleteFolder.id)) ||
      (renamingFolder !== null && !folderById.has(renamingFolder)) ||
      (renamingItem !== null && !projectById.has(renamingItem)) ||
      (kindTarget !== null && !projectById.has(kindTarget)) ||
      (stackTarget !== null && !projectById.has(stackTarget)) ||
      (moveTarget?.kind === "item" && !projectById.has(moveTarget.meta.id)) ||
      (moveTarget?.kind === "folder" && !folderById.has(moveTarget.folder.id));
    if (!stale) return;
    if (menuStale) setMenu(null);
    if (colorTarget !== null && !folderById.has(colorTarget)) setColorTarget(null);
    if (confirmDelete !== null && !projectById.has(confirmDelete.id)) setConfirmDelete(null);
    if (confirmDeleteFolder !== null && !folderById.has(confirmDeleteFolder.id)) {
      setConfirmDeleteFolder(null);
    }
    if (renamingFolder !== null && !folderById.has(renamingFolder)) setRenamingFolder(null);
    if (renamingItem !== null && !projectById.has(renamingItem)) setRenamingItem(null);
    if (kindTarget !== null && !projectById.has(kindTarget)) setKindTarget(null);
    if (stackTarget !== null && !projectById.has(stackTarget)) setStackTarget(null);
    if (
      (moveTarget?.kind === "item" && !projectById.has(moveTarget.meta.id)) ||
      (moveTarget?.kind === "folder" && !folderById.has(moveTarget.folder.id))
    ) {
      setMoveTarget(null);
    }
    queueMicrotask(() => {
      const active = document.activeElement;
      if (!active || active === document.body || !active.isConnected) searchRef.current?.focus();
    });
  }, [
    colorTarget,
    confirmDelete,
    confirmDeleteFolder,
    folderById,
    menu,
    moveTarget,
    projectById,
    renamingFolder,
    renamingItem,
    kindTarget,
    stackTarget,
  ]);

  /* ---- Continue, and what was touched lately ---- */

  // "Now writing" is whatever was last OPENED, not whatever was last written
  // to: filing something stamps its clock, and tidying up must not move it.
  const lead = useMemo(() => {
    const lastId = getLastOpenedId();
    const opened = lastId ? projectById.get(lastId) : undefined;
    if (opened) return opened;
    const newest = [...projectById.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return newest.find((p) => p.type === "screenplay") ?? newest[0] ?? null;
  }, [projectById]);
  const leadLine = useMemo(
    () => (lead ? firstLineOf(lead.id) : ""),
    // Re-read only when the lead changes or is saved again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lead?.id, lead?.updatedAt]
  );
  const recents = useMemo(
    () =>
      [...projectById.values()]
        .filter((p) => p.id !== lead?.id)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, RECENT_COUNT),
    [projectById, lead]
  );

  // Escape folds a fanned-out stack (menus and dialogs take Escape first).
  useEffect(() => {
    if (!trayKey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      setTrayKey(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [trayKey]);

  /* ---- Making things ---- */

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Make something (inside a folder, or loose) and open it. */
  const createAndOpen = (
    type: ProjectType,
    title: string,
    folderId?: string,
    extra?: { kind?: DocKind; content?: JSONContent }
  ) => {
    try {
      const meta = onCreate(type, title, {
        ...(folderId ? { folderId } : {}),
        ...(extra?.kind ? { kind: extra.kind } : {}),
        ...(extra?.content ? { content: extra.content } : {}),
      });
      onOpen(meta.id, { focusTitle: true });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not create that.", { variant: "danger" });
    }
  };

  /** A new thing of a kind: a script, a board, or a document born as a one-pager, an outline... */
  const createKind = (kind: DocKind, folderId?: string) => {
    if (kind === "script") return createAndOpen("screenplay", "Untitled screenplay", folderId);
    if (kind === "board") return createAndOpen("board", "", folderId);
    if (kind === "document" || !onSetOrg) return createAndOpen("plain", "", folderId);
    createAndOpen("plain", NEW_TITLE[kind] ?? "", folderId, { kind, content: starterFor(kind) });
  };

  // The jot: Enter turns the line into a loose note (title only) and stays
  // right here. The new note landing on the desk is the feedback.
  const jotIdea = () => {
    const title = jot.trim();
    if (!title) return;
    try {
      onCreate("plain", title, onSetOrg ? { kind: "notes" } : undefined);
      setJot("");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not save the idea.", { variant: "danger" });
    }
  };

  /** A new project inside a stage, named on the spot in the sidebar. */
  const newProjectIn = (stageId: string) => {
    const f = onCreateFolder(stageId);
    onUpdateFolder(f.id, { name: "Untitled project" });
    setFold(stageId, true);
    select({ kind: "project", id: f.id });
    setRenamingFolder(f.id);
  };

  /** A new top-level folder: a new stage in the sidebar. */
  const newStage = () => {
    const f = onCreateFolder();
    onUpdateFolder(f.id, { name: "Untitled folder" });
    setRenamingFolder(f.id);
  };

  /** A folder inside a project (Old Drafts, One Pagers). */
  const newFolderIn = (parentId: string) => {
    const f = onCreateFolder(parentId);
    onUpdateFolder(f.id, { name: "Untitled folder" });
    setFold(f.id, true);
    setRenamingFolder(f.id);
  };

  // Deleting a folder deletes ONLY the folder. Whatever it held moves up one
  // level to its parent, through the existing handlers, so nothing a writer
  // wrote is ever destroyed and nothing falls out of the tree.
  const removeFolder = (target: Folder) => {
    const liveFolders = [...folderById.values()];
    const up =
      target.parentId && canMoveFolderTo(target.id, target.parentId, liveFolders)
        ? target.parentId
        : null;
    liveFolders
      .filter((sf) => sf.parentId === target.id)
      .forEach((sf) => onUpdateFolder(sf.id, { parentId: up }));
    [...projectById.values()]
      .filter((p) => p.folderId === target.id)
      .forEach((p) => onSetFolder(p.id, up));
    onDeleteFolder(target.id);
    setConfirmDeleteFolder(null);
  };

  // Bulk import behind the New menu; results land as a toast.
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const runImport = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setImporting(true);
    try {
      const { imported, failed } = await onImportScreenplays(Array.from(fileList));
      if (!mounted.current) return;
      showToast(
        `Imported ${imported} script${imported === 1 ? "" : "s"}` +
          (failed.length ? `, ${failed.length} could not be read.` : ".")
      );
    } catch {
      if (mounted.current) showToast("Import failed.", { variant: "danger" });
    } finally {
      if (mounted.current) {
        setImporting(false);
        if (importInputRef.current) importInputRef.current.value = "";
      }
    }
  };

  const runSync = async () => {
    try {
      const ok = await onSyncNow();
      if (mounted.current) showToast(ok ? "Synced." : "Sync did not finish. Check your connection.");
    } catch {
      if (mounted.current) {
        showToast("Sync did not finish. Check your connection.", { variant: "danger" });
      }
    }
  };

  /* ---- Dragging ---- */

  const folderName = (id: string | null) => (id ? folderById.get(id)?.name ?? "that folder" : "Not in a folder");

  const commitDrop = (source: HomeDragSource, drop: HomeDrop) => {
    if (source.kind === "item") {
      const project = projectById.get(source.id);
      if (!project) return;
      const current = project.folderId ?? null;
      // A whole stack travels together; a version picked out of a fanned-out
      // stack travels alone.
      const carried = (source.members ?? [source.id]).filter((id) => projectById.has(id));
      if (drop.kind === "stack") {
        stackOnto(carried, drop.targetId);
        return;
      }
      if (drop.kind === "into" && carried.length > 1) {
        const movers = carried.filter(
          (id) =>
            (projectById.get(id)?.folderId ?? null) !== drop.folderId &&
            canMoveProjectTo(id, drop.folderId, projects, folders)
        );
        if (movers.length === 0) return;
        movers.forEach((id) => onSetFolder(id, drop.folderId));
        showToast(`Moved ${movers.length} versions of "${project.title}" to ${folderName(drop.folderId)}.`);
        return;
      }
      if (drop.kind === "into") {
        if (current === drop.folderId) return;
        if (!canMoveProjectTo(source.id, drop.folderId, projects, folders)) return;
        onSetFolder(source.id, drop.folderId);
        showToast(`Moved "${project.title}" to ${folderName(drop.folderId)}.`);
        return;
      }
      if (drop.kind === "grid") {
        const target = drop.container === "unfiled" ? null : drop.container;
        if (!carried.every((id) => canMoveProjectTo(id, target, projects, folders))) return;
        const order = itemsIn(drop.container).map((p) => p.id);
        const keyOf = (id: string) => groupKeyOf(projectById.get(id) ?? { id });
        if (source.fromTray) {
          // Drawn out of a fanned-out stack onto the desk: it becomes a
          // document on its own, right where it was let go.
          applyPlan(planUnstack(source.id, allDocs));
          if (current !== target) onSetFolder(source.id, target);
          onReorder(insertAtGroupSlot(order, keyOf, [source.id], drop.slot));
          setTrayKey(null);
          showToast(`Took "${project.title}" out of its stack.`);
          return;
        }
        const home = carried.every((id) => (projectById.get(id)?.folderId ?? null) === target);
        if (home) {
          const next = reorderGroups(order, keyOf, groupKeyOf(project), drop.slot);
          if (next) onReorder(next);
          return;
        }
        // Arriving from another folder: file it (or the whole stack) here, then place it.
        carried.forEach((id) => onSetFolder(id, target));
        onReorder(insertAtGroupSlot(order, keyOf, carried, drop.slot));
        showToast(
          carried.length > 1
            ? `Moved ${carried.length} versions of "${project.title}" to ${folderName(target)}.`
            : `Moved "${project.title}" to ${folderName(target)}.`
        );
        return;
      }
      if (drop.kind === "list") {
        const target = drop.container === "unfiled" ? null : drop.container;
        if (!canMoveProjectTo(source.id, target, projects, folders)) return;
        const ids = itemsIn(drop.container).map((p) => p.id);
        if (current === target) {
          const next = reorderIdsAtSlot(ids, source.id, drop.slot);
          if (next) onReorder(next);
        } else {
          // Arriving from another folder: file it here, then place it.
          onSetFolder(source.id, target);
          ids.splice(Math.max(0, Math.min(drop.slot, ids.length)), 0, source.id);
          onReorder(ids);
          showToast(`Moved "${project.title}" to ${folderName(target)}.`);
        }
      }
      return;
    }
    if (source.kind === "project" && drop.kind === "projects") {
      const stage = sectionById.get(drop.stageId);
      if (!stage) return;
      const plan = planFolderCardDrop(
        source.id,
        {
          kind: "gap",
          parentId: drop.stageId,
          siblingIds: stage.cards.map((card) => card.folder.id),
          slot: drop.slot,
        },
        folders
      );
      if (!plan) return;
      if (plan.parentId !== undefined) {
        onUpdateFolder(source.id, { parentId: plan.parentId });
        setFold(drop.stageId, true);
      }
      if (plan.orderedIds) onReorderFolders(plan.orderedIds);
      return;
    }
    if (source.kind === "stage" && drop.kind === "stages") {
      const next = reorderIdsAtSlot(
        sections.map((s) => s.folder.id),
        source.id,
        drop.slot
      );
      if (next) onReorderFolders(next);
    }
  };

  const busy = () =>
    menu !== null ||
    renamingFolder !== null ||
    renamingItem !== null ||
    colorTarget !== null ||
    confirmDelete !== null ||
    confirmDeleteFolder !== null ||
    moveTarget !== null ||
    kindTarget !== null ||
    stackTarget !== null ||
    showCodeImport;

  const drag = useHomeDrag({
    sideRef,
    mainRef,
    canStart: () => !busy(),
    onDrop: commitDrop,
    onSpring: (key) => setFold(key, true),
  });

  /* ---- Menus ---- */

  const openMenu = (e: React.MouseEvent, m: { kind: "overflow" | "account" | "new" }) => {
    e.stopPropagation();
    setMenu({ ...m, anchor: e.currentTarget.getBoundingClientRect() });
  };

  const overflowItems: MenuItem[] = [
    { label: desk ? "Show as a list" : "Show as covers", onSelect: () => setLayout(desk ? "list" : "covers") },
    { label: "Use system theme", onSelect: () => onPrefsChange({ theme: "system" }) },
    {
      label: importing ? "Importing" : "Import files",
      onSelect: () => importInputRef.current?.click(),
      disabled: importing,
    },
  ];

  const accountItems: MenuItem[] = user
    ? [
        { label: user.email ?? "Signed in", onSelect: () => {}, disabled: true },
        { label: "Sync now", onSelect: () => void runSync() },
        { label: "Import a code", onSelect: () => setShowCodeImport(true) },
        { kind: "divider" },
        { label: "Sign out", onSelect: onSignOut },
      ]
    : [{ label: "Sign in", onSelect: onSignIn }];

  /** New things land where the writer is looking. */
  const newItems = (): MenuItem[] => {
    const importRow: MenuItem = {
      label: importing ? "Importing" : "Import files",
      onSelect: () => importInputRef.current?.click(),
      disabled: importing,
    };
    // One row per kind, each with its own color, so the menu reads like the desk.
    const kindRows = (folderId?: string): MenuItem[] =>
      (
        [
          ["script", "New script"],
          ["onepager", "New one-pager"],
          ["treatment", "New treatment"],
          ["outline", "New outline"],
          ["characters", "New characters doc"],
          ["document", "New document"],
          ["board", "New board"],
        ] as [DocKind, string][]
      )
        .filter(([kind]) => onSetOrg || kind === "script" || kind === "document" || kind === "board")
        .map(([kind, label]) => ({
          label,
          swatch: KIND_COLOR[kind],
          onSelect: () => createKind(kind, folderId),
        }));
    if (view.kind === "project" && cardById.has(view.id)) {
      const id = view.id;
      return [...kindRows(id), { kind: "divider" }, { label: "New folder here", onSelect: () => newFolderIn(id) }, importRow];
    }
    if (view.kind === "stage" && sectionById.has(view.id)) {
      const id = view.id;
      return [
        { label: "New project", onSelect: () => newProjectIn(id) },
        { kind: "divider" },
        ...kindRows(id),
        { kind: "divider" },
        { label: "New folder", onSelect: newStage },
        importRow,
      ];
    }
    return [...kindRows(), { kind: "divider" }, { label: "New folder", onSelect: newStage }, importRow];
  };

  /** Everything you can do to a folder, by the level it sits at. */
  const folderItems = (f: Folder): MenuItem[] => {
    if (isStage(f.id)) {
      return [
        { label: "New project in here", onSelect: () => newProjectIn(f.id) },
        { label: "Rename", onSelect: () => setRenamingFolder(f.id) },
        { label: "Move to", onSelect: () => setMoveTarget({ kind: "folder", folder: f }) },
        { kind: "divider" },
        { label: "Delete folder", danger: true, onSelect: () => setConfirmDeleteFolder(f) },
      ];
    }
    return [
      { label: "New script here", onSelect: () => createAndOpen("screenplay", "Untitled screenplay", f.id) },
      { label: "New document here", onSelect: () => createAndOpen("plain", "", f.id) },
      { label: "New board here", onSelect: () => createAndOpen("board", "", f.id) },
      { label: "New folder here", onSelect: () => newFolderIn(f.id) },
      { kind: "divider" },
      { label: "Rename", onSelect: () => setRenamingFolder(f.id) },
      { label: "Color", onSelect: () => setColorTarget(f.id) },
      { label: "Move to", onSelect: () => setMoveTarget({ kind: "folder", folder: f }) },
      { kind: "divider" },
      { label: "Delete folder", danger: true, onSelect: () => setConfirmDeleteFolder(f) },
    ];
  };

  /** File a copy beside the original, without opening it. Breakdown tags live
   *  outside the text, so they are carried over separately. */
  const duplicate = async (p: ProjectMeta) => {
    try {
      const body = await loadBodyForCopy(p);
      if (!body) {
        throw new Error("Could not load that document to copy it. Check your connection and try again.");
      }
      const copy = onCreate(p.type, copyTitle(p.title, projects.map((x) => x.title)), {
        content: body.content,
        titlePage: body.titlePage,
        folderId: p.folderId ?? null,
        status: p.status,
      });
      const tags = loadBreakdown(p.id);
      if (tags.length) saveBreakdown(copy.id, tags);
      showToast(`Made a copy: ${copy.title}`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not duplicate that.", { variant: "danger" });
    }
  };

  /* ---- The desk: kinds and version stacks ---- */

  const applyPlan = (plan: OrgPatch[]) => {
    if (!onSetOrg) return;
    for (const step of plan) onSetOrg(step.id, step.fields);
  };

  /** Stack documents as versions of `targetId`: they move in beside it and join its stack. */
  const stackOnto = (ids: string[], targetId: string) => {
    const target = projectById.get(targetId);
    if (!target || !onSetOrg) return;
    const plan = planStack(ids, targetId, allDocs, nowIso(), freshId);
    if (plan.length === 0) return;
    const home = target.folderId ?? null;
    const moving = ids.filter((id) => id !== targetId && projectById.has(id));
    for (const id of moving) {
      const doc = projectById.get(id)!;
      if ((doc.folderId ?? null) !== home && canMoveProjectTo(id, home, projects, folders)) {
        onSetFolder(id, home);
      }
    }
    applyPlan(plan);
    // The stack stays where the cover it was dropped on sat: the arrivals go
    // in right behind the target, so the stack's first member does not move.
    const order = itemsIn(home ?? "unfiled")
      .map((p) => p.id)
      .filter((id) => !moving.includes(id));
    const at = order.indexOf(targetId);
    if (at >= 0) {
      order.splice(at + 1, 0, ...moving);
      onReorder(order);
    }
    const first = projectById.get(moving[0]);
    showToast(
      moving.length > 1
        ? `Stacked ${moving.length} versions with "${target.title}".`
        : `"${first?.title ?? "That"}" is now a version of "${target.title}".`
    );
  };

  const unstack = (p: ProjectMeta) => {
    const plan = planUnstack(p.id, allDocs);
    if (plan.length === 0) return;
    applyPlan(plan);
    showToast(`Took "${p.title}" out of its stack.`);
  };

  const makeCurrent = (p: ProjectMeta) => {
    const plan = planMakeCurrent(p.id, allDocs, nowIso());
    if (plan.length === 0) return;
    applyPlan(plan);
    showToast(`"${p.title}" is now the current version.`);
  };

  /** Save a draft: a frozen copy of it as it is now, kept in its stack, behind it. */
  const saveDraft = async (p: ProjectMeta) => {
    try {
      const body = await loadBodyForCopy(p);
      if (!body) {
        throw new Error("Could not load that document to save a draft of it. Check your connection and try again.");
      }
      const plan = onSetOrg ? planDraftStack(p, allDocs, nowIso(), freshId) : null;
      const copy = onCreate(p.type, draftTitle(p.title, projects.map((x) => x.title)), {
        content: body.content,
        titlePage: body.titlePage,
        folderId: p.folderId ?? null,
        status: p.status,
        ...(p.kind ? { kind: p.kind } : {}),
        ...(plan ? { stackId: plan.stackId } : {}),
      });
      if (plan?.originalPatch) onSetOrg?.(plan.originalPatch.id, plan.originalPatch.fields);
      const tags = loadBreakdown(p.id);
      if (tags.length) saveBreakdown(copy.id, tags);
      showToast(
        plan ? `Saved a draft: ${copy.title}. It is in the stack, behind "${p.title}".` : `Saved a draft: ${copy.title}.`
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not save a draft of that.", { variant: "danger" });
    }
  };

  /* Suggestions: drafts sitting side by side that look like versions of one thing. */
  const suggestionsIn = (lists: ProjectMeta[][]): StackSuggestion[] =>
    onSetOrg
      ? lists.flatMap((items) => suggestStacks(items, kindFor)).filter((s) => !dismissed.includes(s.key))
      : [];
  const dismissSuggestions = (keys: string[]) => {
    setDismissed((prev) => {
      const next = [...new Set([...prev, ...keys])].slice(-200);
      lsSet(DISMISSED_KEY, JSON.stringify(next));
      return next;
    });
  };
  const acceptSuggestions = (list: StackSuggestion[]) => {
    for (const s of list) applyPlan(planStackAll(s.ids, allDocs, nowIso(), freshId));
    const n = list.reduce((sum, s) => sum + s.ids.length, 0);
    showToast(
      list.length > 1
        ? `Stacked ${n} drafts into ${list.length} stacks.`
        : `Stacked ${n} drafts of "${list[0].label}".`
    );
  };

  /** Others to stack a document with: one per stack, its own folder and kind first. */
  const stackCandidates = (doc: ProjectMeta): ProjectMeta[] => {
    const own = groupKeyOf(doc);
    const seen = new Set<string>([own]);
    const heads: ProjectMeta[] = [];
    for (const d of allDocs) {
      const key = groupKeyOf(d);
      if (seen.has(key)) continue;
      seen.add(key);
      heads.push(d.stackId ? stackOf(d)[0] : d);
    }
    const kind = kindFor(doc);
    const root = versionRoot(doc.title);
    const rank = (d: ProjectMeta) =>
      (versionRoot(d.title) === root && root ? 0 : 4) +
      ((d.folderId ?? null) === (doc.folderId ?? null) ? 0 : 2) +
      (kindFor(d) === kind ? 0 : 1);
    return heads.sort((a, b) => rank(a) - rank(b) || b.updatedAt.localeCompare(a.updatedAt));
  };

  const itemItems = (p: ProjectMeta): MenuItem[] => {
    const versions = stackOf(p);
    const inStack = versions.length > 1;
    const org: MenuItem[] = !onSetOrg
      ? []
      : inStack
        ? [
            ...(versions[0].id !== p.id
              ? [{ label: "Make this the current version", onSelect: () => makeCurrent(p) } as MenuItem]
              : []),
            { label: "Take out of its stack", onSelect: () => unstack(p) },
          ]
        : [{ label: "Stack as a version of…", onSelect: () => setStackTarget(p.id) }];
    return [
      { label: "Open", onSelect: () => onOpen(p.id) },
      { label: "Rename", onSelect: () => setRenamingItem(p.id) },
      ...(p.type === "plain" && onSetOrg
        ? [{ label: "What is this?", hint: KIND_LABEL[kindFor(p)], onSelect: () => setKindTarget(p.id) } as MenuItem]
        : []),
      { kind: "divider" },
      { label: "Save a draft", onSelect: () => void saveDraft(p) },
      { label: "Duplicate", onSelect: () => void duplicate(p) },
      ...org,
      { label: "Move to", onSelect: () => setMoveTarget({ kind: "item", meta: p }) },
      { kind: "divider" },
      { label: "Delete", danger: true, onSelect: () => setConfirmDelete(p) },
    ];
  };

  /* ---- Search: one flat list across everything ---- */

  const q = query.trim().toLowerCase();
  type Hit = { key: string; folder: Folder; where: string } | { key: string; meta: ProjectMeta };
  const hits = useMemo<Hit[]>(() => {
    if (!q) return [];
    const out: Hit[] = [];
    for (const f of folderById.values()) {
      if (!f.name.toLowerCase().includes(q)) continue;
      const parent = f.parentId ? folderById.get(f.parentId)?.name ?? "" : "";
      out.push({ key: "f:" + f.id, folder: f, where: parent });
    }
    for (const p of projectById.values()) {
      if (p.title.toLowerCase().includes(q)) out.push({ key: "p:" + p.id, meta: p });
    }
    return out;
  }, [q, folderById, projectById]);

  /** A folder hit shows that folder: its project, or the project it sits in. */
  const openFolderHit = (f: Folder) => {
    if (sectionById.has(f.id)) return select({ kind: "stage", id: f.id });
    if (cardById.has(f.id)) return select({ kind: "project", id: f.id });
    // A folder inside a project: open the project with the path to it unfolded.
    let cursor: Folder | undefined = f;
    const seen = new Set<string>();
    while (cursor && !cardById.has(cursor.id) && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      setFold(cursor.id, true);
      cursor = cursor.parentId ? folderById.get(cursor.parentId) : undefined;
    }
    if (cursor && cardById.has(cursor.id)) select({ kind: "project", id: cursor.id });
  };

  /* ---- Pieces of the main pane ---- */

  const row = (p: ProjectMeta, showWhere = false) => {
    const where = showWhere ? place.get(p.id) : undefined;
    return (
      <HomeRow
        key={p.id}
        project={p}
        where={showWhere ? (where?.label ?? "Not in a folder") : undefined}
        whereColor={where?.color}
        lifted={drag.source?.kind === "item" && drag.source.id === p.id}
        renaming={renamingItem === p.id}
        menuOpen={menu?.kind === "item" && menu.id === p.id}
        onOpen={() => onOpen(p.id)}
        onMenu={(anchor) => setMenu({ kind: "item", id: p.id, anchor })}
        onPointerDown={(e, el) => drag.start(e, { kind: "item", id: p.id }, el)}
        onRenameCommit={(title) => onRename(p.id, title)}
        onRenameDone={() => setRenamingItem(null)}
      />
    );
  };

  const folderKebab = (f: Folder, extra = "") => (
    <button
      type="button"
      className={"lib-icon-btn lib-kebab" + extra}
      aria-label={`Actions for ${f.name}`}
      aria-haspopup="menu"
      aria-expanded={menu?.kind === "folder" && menu.id === f.id}
      onClick={(e) => {
        e.stopPropagation();
        setMenu({ kind: "folder", id: f.id, anchor: e.currentTarget.getBoundingClientRect() });
      }}
    >
      <DotsIcon />
    </button>
  );

  const titleOf = (f: Folder, className: string) =>
    renamingFolder === f.id ? (
      <NameInput
        initial={f.name}
        className={"lib-rename " + className + "-rename"}
        ariaLabel="Folder name"
        onCommit={(name) => {
          if (name) onUpdateFolder(f.id, { name });
        }}
        onDone={() => setRenamingFolder(null)}
      />
    ) : (
      <h1 className={className} onDoubleClick={() => setRenamingFolder(f.id)} title="Double-click to rename">
        {f.name}
      </h1>
    );

  const jotLine = (
    <div className="lib-jot">
      <input
        type="text"
        value={jot}
        placeholder="Jot an idea and press Enter"
        aria-label="Jot an idea"
        maxLength={MAX_LIBRARY_NAME_LENGTH}
        onChange={(e) => setJot(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") jotIdea();
        }}
      />
    </div>
  );

  const renderRecent = () => {
    const leadPlace = lead ? place.get(lead.id) : undefined;
    const leadMeta = lead
      ? [
          lead.type === "screenplay" && lead.pageCount != null
            ? `${lead.pageCount} ${lead.pageCount === 1 ? "page" : "pages"}`
            : null,
          lead.type === "screenplay" && lead.status !== "not_started" ? STATUS_LABEL[lead.status] : null,
          `edited ${relativeTime(lead.updatedAt)}`,
        ].filter(Boolean)
      : [];
    return (
      <>
        {lead && (
          <section className="lib-continue" aria-label="Continue">
            <div className="lib-eyebrow">
              {leadPlace && (
                <>
                  <span className="lib-dot" style={{ background: leadPlace.color }} aria-hidden="true" />
                  <span>{leadPlace.label}</span>
                  <span className="lib-eyebrow-sep" aria-hidden="true">
                    ·
                  </span>
                </>
              )}
              <span>Now writing</span>
            </div>
            <button type="button" className="lib-continue-card" onClick={() => onOpen(lead.id)}>
              <span className="lib-continue-title">{lead.title || "Untitled"}</span>
              <span className="lib-continue-meta">{leadMeta.join(" · ")}</span>
              {leadLine && <span className="lib-continue-line">{leadLine}</span>}
              <span className="lib-continue-go">
                {lead.type === "screenplay" ? "Continue writing" : "Open"}
              </span>
            </button>
          </section>
        )}
        <section className="lib-section">
          <h2 className="lib-h2">Recently edited</h2>
          {recents.length > 0 ? (
            <div className="lib-panel">{recents.map((p) => row(p, true))}</div>
          ) : (
            <p className="lib-empty">Everything you write shows up here.</p>
          )}
        </section>
        {jotLine}
      </>
    );
  };

  const renderStage = (section: Section) => {
    const f = section.folder;
    const held = section.cards.reduce((n, c) => n + c.total, 0) + section.loose.length;
    return (
      <>
        <header className="lib-head">
          <div className="lib-title-row">
            {titleOf(f, "lib-title")}
            <div className="lib-head-actions">
              <button type="button" className="ui-btn" onClick={() => newProjectIn(f.id)}>
                New project
              </button>
              {folderKebab(f)}
            </div>
          </div>
          <div className="lib-meta">
            {section.cards.length} {section.cards.length === 1 ? "project" : "projects"} · {held}{" "}
            {held === 1 ? "item" : "items"}
          </div>
        </header>
        <div className="lib-cards">
          {section.cards.map((card) => (
            <button
              key={card.folder.id}
              type="button"
              className="lib-card"
              style={{ ["--fc" as string]: card.folder.color }}
              onClick={() => select({ kind: "project", id: card.folder.id })}
            >
              <span className="lib-card-name">
                <span className="lib-dot" style={{ background: card.folder.color }} aria-hidden="true" />
                {card.folder.name}
              </span>
              <span className="lib-card-latest">{card.current?.title ?? "Nothing in it yet"}</span>
              <span className="lib-card-meta">
                {card.total} {card.total === 1 ? "item" : "items"} · {relativeTime(card.lastTouched)}
              </span>
            </button>
          ))}
          <button type="button" className="lib-card lib-card-new" onClick={() => newProjectIn(f.id)}>
            New project
          </button>
        </div>
        {section.loose.length > 0 && (
          <section className="lib-section">
            <h2 className="lib-h2">In {f.name} itself</h2>
            <div className="lib-panel">
              <div className="lib-list" data-list={f.id}>
                {section.loose.map((p) => row(p))}
              </div>
            </div>
          </section>
        )}
      </>
    );
  };

  const renderProject = (card: Card) => {
    const f = card.folder;
    const stage = stageOfCard.get(f.id);
    // Folders inside the project, in tree order; a child shows only while
    // every folder above it is open.
    const openBranches: boolean[] = [];
    const shelfRows = card.shelves
      .map((shelf, index) => {
        const visible = shelf.depth === 1 ? true : (openBranches[shelf.depth - 1] ?? false);
        const open = isOpenFolder(shelf.folder.id, false);
        openBranches[shelf.depth] = visible && open;
        const hasChildren =
          index + 1 < card.shelves.length && card.shelves[index + 1].depth > shelf.depth;
        return { shelf, visible, open, hasChildren };
      })
      .filter((r) => r.visible);
    const empty = card.items.length === 0 && card.shelves.length === 0;
    return (
      <>
        <header className="lib-head">
          {stage && (
            <button
              type="button"
              className="lib-crumb"
              onClick={() => select({ kind: "stage", id: stage.folder.id })}
            >
              {stage.folder.name}
            </button>
          )}
          <div className="lib-title-row">
            <span className="lib-dot lib-dot-lg" style={{ background: f.color }} aria-hidden="true" />
            {titleOf(f, "lib-title")}
            <div className="lib-head-actions">
              <button
                type="button"
                className="ui-btn lib-head-new"
                aria-haspopup="menu"
                aria-expanded={menu?.kind === "new"}
                onClick={(e) => openMenu(e, { kind: "new" })}
              >
                New
                <ChevronDown />
              </button>
              {folderKebab(f)}
            </div>
          </div>
          <div className="lib-meta">
            {card.total} {card.total === 1 ? "item" : "items"} · edited {relativeTime(card.lastTouched)}
          </div>
        </header>
        <div className="lib-panel">
          <div className="lib-list" data-list={f.id}>
            {card.items.map((p) => row(p))}
          </div>
          {empty && (
            <div className="lib-empty-panel">
              <p>Nothing in {f.name} yet.</p>
              <div className="lib-empty-actions">
                <button type="button" className="ui-btn" onClick={() => createAndOpen("screenplay", "Untitled screenplay", f.id)}>
                  New script
                </button>
                <button type="button" className="ui-btn" onClick={() => createAndOpen("plain", "", f.id)}>
                  New document
                </button>
                <button type="button" className="ui-btn" onClick={() => createAndOpen("board", "", f.id)}>
                  New board
                </button>
              </div>
            </div>
          )}
          {shelfRows.map(({ shelf, open, hasChildren }) => {
            const s = shelf.folder;
            return (
              <div
                key={s.id}
                className="lib-group"
                style={{ ["--depth" as string]: shelf.depth - 1 }}
              >
                <div
                  className={"lib-group-head" + (drag.dropKey === s.id ? " is-drop" : "")}
                  data-drop-into={s.id}
                  data-spring={open ? undefined : s.id}
                >
                  <button
                    type="button"
                    className={"lib-caret" + (open ? " is-open" : "")}
                    aria-expanded={open}
                    aria-label={open ? `Hide what is inside ${s.name}` : `Show what is inside ${s.name}`}
                    onClick={() => toggleFold(s.id, false)}
                    disabled={!hasChildren && shelf.items.length === 0}
                  >
                    <ChevronDown />
                  </button>
                  <span className="lib-group-icon" aria-hidden="true">
                    <FolderGlyph />
                  </span>
                  {renamingFolder === s.id ? (
                    <NameInput
                      initial={s.name}
                      className="lib-rename"
                      ariaLabel="Folder name"
                      onCommit={(name) => {
                        if (name) onUpdateFolder(s.id, { name });
                      }}
                      onDone={() => setRenamingFolder(null)}
                    />
                  ) : (
                    <button
                      type="button"
                      className="lib-group-name shelf-name"
                      onClick={() => toggleFold(s.id, false)}
                    >
                      {s.name}
                    </button>
                  )}
                  <span className="lib-count">{shelf.items.length || ""}</span>
                  {folderKebab(s)}
                </div>
                {open && (
                  <div className="lib-list" data-list={s.id}>
                    {shelf.items.map((p) => row(p))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </>
    );
  };

  const renderUnfiled = () => (
    <>
      <header className="lib-head">
        <div className="lib-title-row">
          <h1 className="lib-title">Not in a folder</h1>
        </div>
        <div className="lib-meta">
          {unfiled.length} {unfiled.length === 1 ? "item" : "items"}
        </div>
      </header>
      <div className="lib-panel">
        <div className="lib-list" data-list="unfiled">
          {unfiled.map((p) => row(p))}
        </div>
        {unfiled.length === 0 && (
          <p className="lib-empty-panel">Everything is filed. Jot an idea below to start a loose one.</p>
        )}
      </div>
      {jotLine}
    </>
  );

  const folderHitRow = (hit: { key: string; folder: Folder; where: string }) => (
    <div
      key={hit.key}
      className="lib-row lib-row-folder"
      role="button"
      tabIndex={0}
      onClick={() => openFolderHit(hit.folder)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openFolderHit(hit.folder);
        }
      }}
    >
      <span className="lib-row-icon" aria-hidden="true" style={{ color: hit.folder.color }}>
        <FolderGlyph />
      </span>
      <span className="lib-row-title">{hit.folder.name}</span>
      {hit.where && <span className="lib-row-where">{hit.where}</span>}
      <span className="lib-row-meta">Folder</span>
    </div>
  );

  const renderSearch = () =>
    hits.length > 0 ? (
      <section className="lib-section">
        <h2 className="lib-h2">
          {hits.length} {hits.length === 1 ? "match" : "matches"}
        </h2>
        <div className="lib-panel">
          {hits.map((hit) => ("meta" in hit ? row(hit.meta, true) : folderHitRow(hit)))}
        </div>
      </section>
    ) : (
      <p className="lib-empty">Nothing matches that search.</p>
    );

  /* ---- The desk: the same views, as covers ---- */

  const trayDomId = (key: string) => "dk-tray-" + key.replace(/[^A-Za-z0-9_-]/g, "_");
  const isLifted = (id: string) =>
    drag.source?.kind === "item" && (drag.source.id === id || !!drag.source.members?.includes(id));

  /**
   * One cover on the desk. `members` is its stack as this view shows it,
   * current first; `scope` names the view, so a stack fans out in one place.
   */
  const tile = (doc: ProjectMeta, members: ProjectMeta[], scope: string, opts: { where?: boolean } = {}) => {
    const group = groupKeyOf(doc);
    const key = `${scope}|${group}`;
    const where = opts.where ? place.get(doc.id) : undefined;
    const stacked = members.length > 1;
    return (
      <DeskTile
        key={doc.id}
        doc={doc}
        kind={kindFor(doc)}
        seed={seedFor(doc)}
        group={group}
        versions={members.length}
        where={opts.where ? { label: where?.label ?? "Not in a folder", color: where?.color } : undefined}
        spine={where?.color}
        lifted={isLifted(doc.id)}
        stackTarget={drag.dropKey === "stack:" + doc.id}
        stackable={!!onSetOrg}
        renaming={renamingItem === doc.id}
        menuOpen={menu?.kind === "item" && menu.id === doc.id}
        trayOpen={trayKey === key}
        trayId={trayDomId(key)}
        onOpen={() => onOpen(doc.id)}
        onMenu={(anchor) => setMenu({ kind: "item", id: doc.id, anchor })}
        onPointerDown={(e, el) =>
          drag.start(
            e,
            stacked
              ? { kind: "item", id: doc.id, members: members.map((m) => m.id), group }
              : { kind: "item", id: doc.id, group },
            el
          )
        }
        onToggleTray={stacked ? () => setTrayKey((k) => (k === key ? null : key)) : undefined}
        onRenameCommit={(title) => onRename(doc.id, title)}
        onRenameDone={() => setRenamingItem(null)}
      />
    );
  };

  /** A stack, fanned out: every version, current first, each one its own cover. */
  const trayFor = (members: ProjectMeta[], key: string) => {
    const head = members[0];
    return (
      <DeskTray
        key={"tray:" + key}
        id={trayDomId(key)}
        title={head.title || "Untitled"}
        color={coverColor(head)}
        count={members.length}
        onClose={() => setTrayKey(null)}
      >
        {members.map((m, i) => {
          const elsewhere = (m.folderId ?? null) !== (head.folderId ?? null);
          const where = elsewhere ? place.get(m.id) : undefined;
          return (
            <DeskTile
              key={m.id}
              doc={m}
              kind={kindFor(m)}
              seed={seedFor(m)}
              group={groupKeyOf(m)}
              current={i === 0}
              index={i}
              where={elsewhere ? { label: where?.label ?? "Not in a folder", color: where?.color } : undefined}
              lifted={isLifted(m.id)}
              stackTarget={false}
              stackable={false}
              renaming={renamingItem === m.id}
              menuOpen={menu?.kind === "item" && menu.id === m.id}
              onOpen={() => onOpen(m.id)}
              onMenu={(anchor) => setMenu({ kind: "item", id: m.id, anchor })}
              onPointerDown={(e, el) =>
                drag.start(e, { kind: "item", id: m.id, group: groupKeyOf(m), fromTray: true }, el)
              }
              onRenameCommit={(title) => onRename(m.id, title)}
              onRenameDone={() => setRenamingItem(null)}
            />
          );
        })}
      </DeskTray>
    );
  };

  /** One folder's covers, stacks grouped, in the writer's own order. */
  const deskGrid = (container: string, items: ProjectMeta[]) => {
    let groups: StackGroup<ProjectMeta>[] = groupStacks(items);
    if (kindFilter) groups = groups.filter((g) => kindFor(g.head) === kindFilter);
    if (groups.length === 0) return null;
    const keys = groups.map((g) => `${container}|${g.key}`);
    const openIndex = trayKey ? keys.indexOf(trayKey) : -1;
    return (
      <DeskGrid
        // Arranging is off while a filter hides some covers: a slot between
        // the visible ones does not say where it goes among the hidden ones.
        container={kindFilter ? undefined : container}
        openIndex={openIndex}
        tray={openIndex >= 0 ? trayFor(groups[openIndex].members, keys[openIndex]) : undefined}
      >
        {groups.map((g) => tile(g.head, g.members, container))}
      </DeskGrid>
    );
  };

  /** How many of each kind, most first ("4 one-pagers, 2 scripts"). */
  const kindCounts = (docs: ProjectMeta[]): [DocKind, number][] => {
    const counts = new Map<DocKind, number>();
    for (const d of docs) {
      const k = kindFor(d);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  };

  /** A project's hand of covers: the one to continue first, then the latest, one per stack. */
  const projectCovers = (card: Card): ProjectMeta[] => {
    const all = [...card.items, ...card.shelves.flatMap((s) => s.items)].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt)
    );
    const groups = groupStacks(all);
    const lead = card.current
      ? groups.find((g) => g.members.some((m) => m.id === card.current!.id))?.head
      : undefined;
    const heads = groups.map((g) => g.head).filter((h) => h !== lead);
    return (lead ? [lead, ...heads] : heads).slice(0, 4);
  };

  /** Every list of documents that sits together somewhere, for suggestions. */
  const everyContainer = (): ProjectMeta[][] => [
    unfiled,
    ...sections.flatMap((s) => [
      s.loose,
      ...s.cards.flatMap((c) => [c.items, ...c.shelves.map((sh) => sh.items)]),
    ]),
  ];

  const suggestionBanner = (list: StackSuggestion[]) => {
    if (list.length === 0) return null;
    const first = list[0];
    const docs = first.ids.map((id) => projectById.get(id)).filter((d): d is ProjectMeta => !!d);
    if (docs.length < 2) return null;
    return (
      <div className="dk-suggest" role="status">
        <span className="dk-suggest-fan" aria-hidden="true">
          {docs.slice(0, 3).map((d, i) => (
            <span key={d.id} className="dk-suggest-card" style={{ ["--i" as string]: i } as React.CSSProperties}>
              <Cover id={d.id} seed={seedFor(d)} title={d.title} kind={kindFor(d)} digest={d.digest} mini />
            </span>
          ))}
        </span>
        <span className="dk-suggest-text">
          <strong>
            {docs.length} drafts of &ldquo;{first.label}&rdquo;
          </strong>{" "}
          are sitting side by side. Stack them as versions, with the latest on top?
          {list.length > 1 && (
            <span className="dk-suggest-more">
              {" "}
              {list.length - 1} more {list.length === 2 ? "set looks" : "sets look"} like that.
            </span>
          )}
        </span>
        <span className="dk-suggest-actions">
          <button type="button" className="ui-btn ui-btn-solid" onClick={() => acceptSuggestions([first])}>
            Stack them
          </button>
          {list.length > 1 && (
            <button type="button" className="ui-btn" onClick={() => acceptSuggestions(list)}>
              Stack all {list.length}
            </button>
          )}
          <button type="button" className="ui-btn ui-btn-text" onClick={() => dismissSuggestions([first.key])}>
            Not now
          </button>
        </span>
      </div>
    );
  };

  /** What was touched lately, one cover per stack, the lead's own stack left out. */
  const recentPicks = (): ProjectMeta[] => {
    const seen = new Set<string>(lead ? [groupKeyOf(lead)] : []);
    const picks: ProjectMeta[] = [];
    for (const p of [...projectById.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
      const key = groupKeyOf(p);
      if (seen.has(key)) continue;
      seen.add(key);
      picks.push(p);
      if (picks.length >= RECENT_COUNT) break;
    }
    return picks;
  };

  const hero = (p: ProjectMeta) => {
    const where = place.get(p.id);
    const kind = kindFor(p);
    const versions = stackOf(p).length;
    const meta = [
      KIND_LABEL[kind],
      p.type === "screenplay" && p.pageCount != null
        ? `${p.pageCount} ${p.pageCount === 1 ? "page" : "pages"}`
        : null,
      p.type === "screenplay" && p.status !== "not_started" ? STATUS_LABEL[p.status] : null,
      versions > 1 ? `${versions} versions` : null,
      `edited ${relativeTime(p.updatedAt)}`,
    ].filter(Boolean);
    return (
      <section
        className="dk-hero"
        aria-label="Continue"
        style={{ ["--hero" as string]: coverColor(p) } as React.CSSProperties}
      >
        <button
          type="button"
          className="dk-hero-cover"
          onClick={() => onOpen(p.id)}
          aria-label={`Open ${p.title || "Untitled"}`}
        >
          <Cover
            id={p.id}
            seed={seedFor(p)}
            title={p.title}
            kind={kind}
            digest={p.digest}
            author={p.coverAuthor}
            pageCount={p.pageCount}
          />
        </button>
        <div className="dk-hero-text">
          <div className="lib-eyebrow">
            {where && (
              <>
                <span className="lib-dot" style={{ background: where.color }} aria-hidden="true" />
                <span>{where.label}</span>
                <span className="lib-eyebrow-sep" aria-hidden="true">
                  ·
                </span>
              </>
            )}
            <span>Now writing</span>
          </div>
          <h2 className="dk-hero-title">{p.title || "Untitled"}</h2>
          <div className="dk-hero-meta">{meta.join(" · ")}</div>
          {leadLine && <div className={"dk-hero-line" + (kind === "script" ? "" : " is-prose")}>{leadLine}</div>}
          <button type="button" className="ui-btn ui-btn-solid dk-hero-go" onClick={() => onOpen(p.id)}>
            {p.type === "screenplay" ? "Continue writing" : "Open"}
          </button>
        </div>
      </section>
    );
  };

  const renderRecentDesk = () => {
    const picks = recentPicks();
    const keys = picks.map((p) => `recent|${groupKeyOf(p)}`);
    const openIndex = trayKey ? keys.indexOf(trayKey) : -1;
    return (
      <>
        {suggestionBanner(suggestionsIn(everyContainer()))}
        {lead && hero(lead)}
        <section className="lib-section">
          <h2 className="dk-h2">Recently edited</h2>
          {picks.length > 0 ? (
            <DeskGrid
              openIndex={openIndex}
              tray={openIndex >= 0 ? trayFor(stackOf(picks[openIndex]), keys[openIndex]) : undefined}
            >
              {picks.map((p) => tile(p, stackOf(p), "recent", { where: true }))}
            </DeskGrid>
          ) : (
            <p className="lib-empty">Everything you write shows up here.</p>
          )}
        </section>
        {jotLine}
      </>
    );
  };

  const renderStageDesk = (section: Section) => {
    const f = section.folder;
    const held = section.cards.reduce((n, c) => n + c.total, 0) + section.loose.length;
    return (
      <>
        <header className="dk-head" style={{ ["--fc" as string]: f.color } as React.CSSProperties}>
          <div className="lib-title-row">
            {titleOf(f, "lib-title")}
            <div className="lib-head-actions">
              <button type="button" className="ui-btn" onClick={() => newProjectIn(f.id)}>
                New project
              </button>
              {folderKebab(f)}
            </div>
          </div>
          <div className="lib-meta">
            {section.cards.length} {section.cards.length === 1 ? "project" : "projects"} · {held}{" "}
            {held === 1 ? "item" : "items"}
          </div>
        </header>
        <div className="dk-projects">
          {section.cards.map((card) => (
            <ProjectTile
              key={card.folder.id}
              card={card}
              covers={projectCovers(card)}
              counts={kindCounts([...card.items, ...card.shelves.flatMap((s) => s.items)])}
              isDrop={drag.dropKey === card.folder.id}
              kindFor={kindFor}
              seedFor={seedFor}
              onOpen={() => select({ kind: "project", id: card.folder.id })}
            />
          ))}
          <button type="button" className="dk-project dk-project-new" onClick={() => newProjectIn(f.id)}>
            <span className="dk-project-plus" aria-hidden="true">
              +
            </span>
            New project
          </button>
        </div>
        {section.loose.length > 0 && (
          <section className="dk-section">
            <h2 className="dk-h2">In {f.name} itself</h2>
            {suggestionBanner(suggestionsIn([section.loose]))}
            {deskGrid(f.id, section.loose)}
          </section>
        )}
      </>
    );
  };

  const renderProjectDesk = (card: Card) => {
    const f = card.folder;
    const stage = stageOfCard.get(f.id);
    const openBranches: boolean[] = [];
    const shelfRows = card.shelves
      .map((shelf, index) => {
        const visible = shelf.depth === 1 ? true : (openBranches[shelf.depth - 1] ?? false);
        const open = isOpenFolder(shelf.folder.id, false);
        openBranches[shelf.depth] = visible && open;
        const hasChildren =
          index + 1 < card.shelves.length && card.shelves[index + 1].depth > shelf.depth;
        return { shelf, visible, open, hasChildren };
      })
      .filter((r) => r.visible);
    const everything = [...card.items, ...card.shelves.flatMap((s) => s.items)];
    const counts = kindCounts(everything);
    const empty = card.items.length === 0 && card.shelves.length === 0;
    return (
      <>
        <header className="dk-head" style={{ ["--fc" as string]: f.color } as React.CSSProperties}>
          {stage && (
            <button
              type="button"
              className="lib-crumb"
              onClick={() => select({ kind: "stage", id: stage.folder.id })}
            >
              {stage.folder.name}
            </button>
          )}
          <div className="lib-title-row">
            {titleOf(f, "lib-title")}
            <div className="lib-head-actions">
              <button
                type="button"
                className="ui-btn lib-head-new"
                aria-haspopup="menu"
                aria-expanded={menu?.kind === "new"}
                onClick={(e) => openMenu(e, { kind: "new" })}
              >
                New
                <ChevronDown />
              </button>
              {folderKebab(f)}
            </div>
          </div>
          <div className="lib-meta">
            {card.total} {card.total === 1 ? "item" : "items"} · edited {relativeTime(card.lastTouched)}
          </div>
          {counts.length > 1 && (
            <div className="dk-filters" role="group" aria-label="Show only">
              <button
                type="button"
                className="dk-chip"
                aria-pressed={kindFilter === null}
                onClick={() => setKindFilter(null)}
              >
                All <span className="dk-chip-count">{everything.length}</span>
              </button>
              {counts.map(([k, n]) => (
                <button
                  key={k}
                  type="button"
                  className="dk-chip"
                  data-kind={k}
                  aria-pressed={kindFilter === k}
                  onClick={() => {
                    setKindFilter(kindFilter === k ? null : k);
                    setTrayKey(null);
                  }}
                >
                  {capitalize(n === 1 ? KIND_ONE[k] : KIND_PLURAL[k])}{" "}
                  <span className="dk-chip-count">{n}</span>
                </button>
              ))}
            </div>
          )}
        </header>
        {suggestionBanner(suggestionsIn([card.items, ...card.shelves.map((s) => s.items)]))}
        {deskGrid(f.id, card.items)}
        {empty && (
          <div className="dk-empty" data-drop-into={f.id}>
            <p>Nothing in {f.name} yet. Start something, or carry it in from the side.</p>
            <div className="lib-empty-actions">
              {(["script", "onepager", "treatment", "board"] as DocKind[])
                .filter((k) => onSetOrg || k === "script" || k === "board")
                .map((k) => (
                  <button
                    key={k}
                    type="button"
                    className="ui-btn dk-start"
                    data-kind={k}
                    onClick={() => createKind(k, f.id)}
                  >
                    New {KIND_LABEL[k].toLowerCase()}
                  </button>
                ))}
            </div>
          </div>
        )}
        {shelfRows.map(({ shelf, open, hasChildren }) => {
          const s = shelf.folder;
          if (kindFilter && !hasChildren && !shelf.items.some((p) => kindFor(p) === kindFilter)) return null;
          const peek = open ? [] : groupStacks(shelf.items).slice(0, 3).map((g) => g.head);
          return (
            <section
              key={s.id}
              className="dk-shelf"
              style={{ ["--depth" as string]: shelf.depth - 1 } as React.CSSProperties}
            >
              <div
                className={"dk-section-head" + (drag.dropKey === s.id ? " is-drop" : "")}
                data-drop-into={s.id}
                data-spring={open ? undefined : s.id}
              >
                <button
                  type="button"
                  className={"lib-caret" + (open ? " is-open" : "")}
                  aria-expanded={open}
                  aria-label={open ? `Hide what is inside ${s.name}` : `Show what is inside ${s.name}`}
                  onClick={() => toggleFold(s.id, false)}
                  disabled={!hasChildren && shelf.items.length === 0}
                >
                  <ChevronDown />
                </button>
                <span className="lib-group-icon" aria-hidden="true" style={{ color: s.color }}>
                  <FolderGlyph />
                </span>
                {renamingFolder === s.id ? (
                  <NameInput
                    initial={s.name}
                    className="lib-rename"
                    ariaLabel="Folder name"
                    onCommit={(name) => {
                      if (name) onUpdateFolder(s.id, { name });
                    }}
                    onDone={() => setRenamingFolder(null)}
                  />
                ) : (
                  <button
                    type="button"
                    className="dk-section-name shelf-name"
                    onClick={() => toggleFold(s.id, false)}
                  >
                    {s.name}
                  </button>
                )}
                <span className="dk-section-count">{shelf.items.length || ""}</span>
                {peek.length > 0 && (
                  <span className="dk-peek" aria-hidden="true">
                    {peek.map((d) => (
                      <span key={d.id} className="dk-peek-card">
                        <Cover id={d.id} seed={seedFor(d)} title={d.title} kind={kindFor(d)} digest={d.digest} mini />
                      </span>
                    ))}
                  </span>
                )}
                {folderKebab(s)}
              </div>
              {open &&
                (shelf.items.length > 0
                  ? deskGrid(s.id, shelf.items)
                  : !hasChildren && <p className="dk-shelf-empty">Empty. Carry something here to file it.</p>)}
            </section>
          );
        })}
      </>
    );
  };

  const renderUnfiledDesk = () => (
    <>
      <header className="dk-head" style={{ ["--fc" as string]: "#8E8E93" } as React.CSSProperties}>
        <div className="lib-title-row">
          <h1 className="lib-title">Not in a folder</h1>
        </div>
        <div className="lib-meta">
          {unfiled.length} {unfiled.length === 1 ? "item" : "items"}
        </div>
      </header>
      {suggestionBanner(suggestionsIn([unfiled]))}
      {deskGrid("unfiled", unfiled) ?? (
        <p className="lib-empty">Everything is filed. Jot an idea below to start a loose one.</p>
      )}
      {jotLine}
    </>
  );

  const renderSearchDesk = () => {
    if (hits.length === 0) return <p className="lib-empty">Nothing matches that search.</p>;
    const folderHits = hits.filter((h): h is { key: string; folder: Folder; where: string } => "folder" in h);
    const docHits = hits.flatMap((h) => ("meta" in h ? [h.meta] : []));
    return (
      <section className="lib-section">
        <h2 className="dk-h2">
          {hits.length} {hits.length === 1 ? "match" : "matches"}
        </h2>
        {folderHits.length > 0 && <div className="lib-panel dk-search-folders">{folderHits.map(folderHitRow)}</div>}
        {docHits.length > 0 && <DeskGrid>{docHits.map((p) => tile(p, [p], "search", { where: true }))}</DeskGrid>}
      </section>
    );
  };

  const content = q
    ? desk
      ? renderSearchDesk()
      : renderSearch()
    : view.kind === "stage" && sectionById.has(view.id)
      ? (desk ? renderStageDesk : renderStage)(sectionById.get(view.id)!)
      : view.kind === "project" && cardById.has(view.id)
        ? (desk ? renderProjectDesk : renderProject)(cardById.get(view.id)!)
        : view.kind === "unfiled"
          ? desk
            ? renderUnfiledDesk()
            : renderUnfiled()
          : desk
            ? renderRecentDesk()
            : renderRecent();

  const menuFolder = menu?.kind === "folder" ? folderById.get(menu.id) ?? null : null;
  const menuItem = menu?.kind === "item" ? projectById.get(menu.id) ?? null : null;
  const colorFolder = colorTarget ? folderById.get(colorTarget) ?? null : null;
  const kindDoc = kindTarget ? projectById.get(kindTarget) ?? null : null;
  const stackDoc = stackTarget ? projectById.get(stackTarget) ?? null : null;

  return (
    <div className={"lib" + (desk ? " is-desk" : "") + (drag.source ? " is-carrying" : "")}>
      <header className="lib-top">
        <button
          type="button"
          className="tb-icon lib-top-menu"
          aria-label="Library"
          aria-expanded={sideOpen}
          onClick={() => setSideOpen((v) => !v)}
        >
          <MenuGlyph />
        </button>
        <div className="lib-brand" title="Last Ever Screenwriting Software">
          LESS
        </div>
        <label className="lib-search">
          <SearchGlyph />
          <input
            ref={searchRef}
            type="search"
            className="home-search"
            placeholder="Search"
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
          {!query && (
            <kbd className="kbd" aria-hidden="true">
              /
            </kbd>
          )}
        </label>
        <div className="toolbar-spacer" />
        <button
          type="button"
          className="tb-icon dk-layout-toggle"
          aria-label={desk ? "Show as a list" : "Show as covers"}
          title={desk ? "Show as a list" : "Show as covers"}
          onClick={() => setLayout(desk ? "list" : "covers")}
        >
          {desk ? <ListGlyph /> : <CoversGlyph />}
        </button>
        <ThemeToggle theme={prefs.theme} onChange={(theme) => onPrefsChange({ theme })} />
        <button
          type="button"
          className="tb-icon"
          aria-label="More"
          title="More"
          aria-haspopup="menu"
          aria-expanded={menu?.kind === "overflow"}
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
            aria-expanded={menu?.kind === "account"}
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
          className="ui-btn ui-btn-solid fh-new lib-new"
          aria-haspopup="menu"
          aria-expanded={menu?.kind === "new"}
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

      <div className="lib-body">
        <HomeSidebar
          sideRef={sideRef}
          open={sideOpen}
          sections={sections}
          unfiled={unfiled}
          view={q ? { kind: "recent" } : view}
          onSelect={select}
          isStageOpen={(id) => isOpenFolder(id, true)}
          onToggleStage={(id) => toggleFold(id, true)}
          renamingFolder={renamingFolder}
          onRenameFolder={(id, name) => onUpdateFolder(id, { name })}
          onRenameDone={() => setRenamingFolder(null)}
          dragSource={drag.source}
          dropKey={drag.dropKey}
          onStartDrag={drag.start}
          onNewProject={newProjectIn}
          onStageMenu={(id, anchor) => setMenu({ kind: "folder", id, anchor })}
          stageMenuFor={menu?.kind === "folder" ? menu.id : null}
          onNewFolder={newStage}
        />
        {sideOpen && (
          <div className="lib-scrim" onClick={() => setSideOpen(false)} aria-hidden="true" />
        )}
        <main ref={mainRef} className="lib-main">
          <div className="lib-main-inner">{content}</div>
        </main>
      </div>

      {drag.line && (
        <div
          className={"lib-drop-line" + (drag.line.height ? " is-upright" : "")}
          style={{
            left: drag.line.left,
            top: drag.line.top,
            width: drag.line.width,
            ...(drag.line.height ? { height: drag.line.height } : {}),
          }}
          aria-hidden="true"
        />
      )}

      {/* ---- Anchored menus ---- */}
      {menu?.kind === "overflow" && (
        <Menu anchor={menu.anchor} items={overflowItems} onClose={() => setMenu(null)} ariaLabel="More" />
      )}
      {menu?.kind === "account" && (
        <Menu anchor={menu.anchor} items={accountItems} onClose={() => setMenu(null)} ariaLabel="Account" />
      )}
      {menu?.kind === "new" && (
        <Menu anchor={menu.anchor} items={newItems()} onClose={() => setMenu(null)} ariaLabel="Create" />
      )}
      {menuFolder && menu?.kind === "folder" && (
        <Menu
          anchor={menu.anchor}
          items={folderItems(menuFolder)}
          onClose={() => setMenu(null)}
          ariaLabel="Folder actions"
        />
      )}
      {menuItem && menu?.kind === "item" && (
        <Menu
          anchor={menu.anchor}
          items={itemItems(menuItem)}
          onClose={() => setMenu(null)}
          ariaLabel={menuItem.type === "screenplay" ? "Script actions" : "Document actions"}
        />
      )}

      {colorFolder && (
        <FolderColorModal
          folder={colorFolder}
          onPick={(color, close) => {
            onUpdateFolder(colorFolder.id, { color });
            if (close) setColorTarget(null);
          }}
          onClose={() => setColorTarget(null)}
        />
      )}
      {showCodeImport && (
        <CodeImportModal onClose={() => setShowCodeImport(false)} onSyncNow={onSyncNow} />
      )}
      {confirmDelete && (
        <DeleteProjectModal
          project={confirmDelete}
          onDelete={() => {
            onDelete(confirmDelete.id);
            setConfirmDelete(null);
          }}
          onClose={() => setConfirmDelete(null)}
        />
      )}
      {moveTarget && (
        <MoveToModal
          target={moveTarget}
          folders={folders}
          onMove={(folderId) => {
            if (moveTarget.kind === "item") onSetFolder(moveTarget.meta.id, folderId);
            else onUpdateFolder(moveTarget.folder.id, { parentId: folderId });
          }}
          onClose={() => setMoveTarget(null)}
        />
      )}
      {kindDoc && onSetOrg && (
        <KindPickerModal
          doc={kindDoc}
          seed={seedFor(kindDoc)}
          kind={kindFor(kindDoc)}
          explicit={isProseKind(kindDoc.kind)}
          onPick={(k) => {
            onSetOrg(kindDoc.id, { kind: k });
            setKindTarget(null);
          }}
          onClose={() => setKindTarget(null)}
        />
      )}
      {stackDoc && onSetOrg && (
        <StackWithModal
          doc={stackDoc}
          candidates={stackCandidates(stackDoc)}
          kindFor={kindFor}
          seedFor={seedFor}
          whereOf={(d) => place.get(d.id)?.label ?? "Not in a folder"}
          onPick={(targetId) => {
            stackOnto([stackDoc.id], targetId);
            setStackTarget(null);
          }}
          onClose={() => setStackTarget(null)}
        />
      )}
      {confirmDeleteFolder && (
        <DeleteFolderModal
          folder={confirmDeleteFolder}
          parentName={
            confirmDeleteFolder.parentId
              ? folders.find((f) => f.id === confirmDeleteFolder.parentId)?.name ?? "the level above"
              : null
          }
          onConfirm={() => removeFolder(confirmDeleteFolder)}
          onClose={() => setConfirmDeleteFolder(null)}
        />
      )}
    </div>
  );
}
