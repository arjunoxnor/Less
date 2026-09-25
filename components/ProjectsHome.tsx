"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/core";
import type { CloudUser as User } from "@/lib/cloud/client";
import { lsGet, lsSet, type Prefs } from "@/lib/storage/localStore";
import {
  getLastOpenedId,
  loadProjectDoc,
  type ProjectMeta,
  type ProjectType,
} from "@/lib/storage/projects";
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
import { Menu, type MenuItem } from "./ui/Menu";
import { showToast } from "./ui/Toast";
import { DotsIcon, PersonIcon } from "./chrome/icons";
import { ThemeToggle } from "./chrome/ThemeToggle";
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
const RECENT_COUNT = 8;

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
    opts?: { content?: JSONContent; titlePage?: TitlePage | null; folderId?: string | null }
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
  // Starts on Recent to match the page as it was built; the view the writer
  // left is restored once the page is live (reading storage during the first
  // render would disagree with the prebuilt page).
  const [view, setViewState] = useState<HomeView>({ kind: "recent" });
  useEffect(() => {
    setViewState(readView());
  }, []);
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

  /* ---- Making things ---- */

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Make something (inside a folder, or loose) and open it. */
  const createAndOpen = (type: ProjectType, title: string, folderId?: string) => {
    try {
      const meta = onCreate(type, title, folderId ? { folderId } : undefined);
      onOpen(meta.id, { focusTitle: true });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not create that.", { variant: "danger" });
    }
  };

  // The jot: Enter turns the line into a loose document (title only) and
  // stays right here. The new line appearing in the list is the feedback.
  const jotIdea = () => {
    const title = jot.trim();
    if (!title) return;
    try {
      onCreate("plain", title);
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
      if (drop.kind === "into") {
        if (current === drop.folderId) return;
        if (!canMoveProjectTo(source.id, drop.folderId, projects, folders)) return;
        onSetFolder(source.id, drop.folderId);
        showToast(`Moved "${project.title}" to ${folderName(drop.folderId)}.`);
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
    if (view.kind === "project" && cardById.has(view.id)) {
      const id = view.id;
      return [
        { label: "New script", onSelect: () => createAndOpen("screenplay", "Untitled screenplay", id) },
        { label: "New document", onSelect: () => createAndOpen("plain", "", id) },
        { label: "New board", onSelect: () => createAndOpen("board", "", id) },
        { label: "New voice script", onSelect: () => createAndOpen("voice", "", id) },
        { kind: "divider" },
        { label: "New folder here", onSelect: () => newFolderIn(id) },
        importRow,
      ];
    }
    if (view.kind === "stage" && sectionById.has(view.id)) {
      const id = view.id;
      return [
        { label: "New project", onSelect: () => newProjectIn(id) },
        { kind: "divider" },
        { label: "New script", onSelect: () => createAndOpen("screenplay", "Untitled screenplay", id) },
        { label: "New document", onSelect: () => createAndOpen("plain", "", id) },
        { label: "New board", onSelect: () => createAndOpen("board", "", id) },
        { kind: "divider" },
        { label: "New folder", onSelect: newStage },
        importRow,
      ];
    }
    return [
      { label: "New script", onSelect: () => createAndOpen("screenplay", "Untitled screenplay") },
      { label: "New document", onSelect: () => createAndOpen("plain", "") },
      { label: "New board", onSelect: () => createAndOpen("board", "") },
      { label: "New voice script", onSelect: () => createAndOpen("voice", "") },
      { kind: "divider" },
      { label: "New folder", onSelect: newStage },
      importRow,
    ];
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

  const itemItems = (p: ProjectMeta): MenuItem[] => [
    { label: "Open", onSelect: () => onOpen(p.id) },
    { label: "Rename", onSelect: () => setRenamingItem(p.id) },
    { label: "Move to", onSelect: () => setMoveTarget({ kind: "item", meta: p }) },
    { kind: "divider" },
    { label: "Delete", danger: true, onSelect: () => setConfirmDelete(p) },
  ];

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

  const renderSearch = () =>
    hits.length > 0 ? (
      <section className="lib-section">
        <h2 className="lib-h2">
          {hits.length} {hits.length === 1 ? "match" : "matches"}
        </h2>
        <div className="lib-panel">
          {hits.map((hit) =>
            "meta" in hit ? (
              row(hit.meta, true)
            ) : (
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
            )
          )}
        </div>
      </section>
    ) : (
      <p className="lib-empty">Nothing matches that search.</p>
    );

  const content = q
    ? renderSearch()
    : view.kind === "stage" && sectionById.has(view.id)
      ? renderStage(sectionById.get(view.id)!)
      : view.kind === "project" && cardById.has(view.id)
        ? renderProject(cardById.get(view.id)!)
        : view.kind === "unfiled"
          ? renderUnfiled()
          : renderRecent();

  const menuFolder = menu?.kind === "folder" ? folderById.get(menu.id) ?? null : null;
  const menuItem = menu?.kind === "item" ? projectById.get(menu.id) ?? null : null;
  const colorFolder = colorTarget ? folderById.get(colorTarget) ?? null : null;

  return (
    <div className={"lib" + (drag.source ? " is-carrying" : "")}>
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
          className="lib-drop-line"
          style={{ left: drag.line.left, top: drag.line.top, width: drag.line.width }}
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
