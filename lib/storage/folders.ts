import { lsGet, lsSet } from "./localStore";
import type { ProjectStatus } from "./projects";

/**
 * Folders: the organizing layer over projects. A folder collects all the
 * materials for one creative project (a screenplay plus its notes, research,
 * etc.), and carries a color and a development stage. Folders are device-local
 * for now (the documents themselves still sync to the cloud); the folder
 * arrangement is view organization, not the work itself, so it lives in
 * localStorage and can gain cross-device sync later.
 */

export type Stage = "idea" | "in_progress" | "completed";

export const STAGE_LABEL: Record<Stage, string> = {
  idea: "Idea",
  in_progress: "In progress",
  completed: "Completed",
};

/** Natural progression order, used for the stage picker. */
export const STAGE_ORDER: Stage[] = ["idea", "in_progress", "completed"];

/** A folder stage maps to the same three buckets the document status uses. */
export function stageOfStatus(s: ProjectStatus): Stage {
  return s === "done" ? "completed" : s === "writing" ? "in_progress" : "idea";
}

/** Folder accent colors, deliberately distinct from the stage chip colors. */
// A curated palette ordered around the colour wheel so the swatches read as a
// gentle spectrum. The original seven hexes are kept (folders created before the
// palette grew still match a swatch). A custom picker in the UI covers anything
// beyond these.
export const FOLDER_COLORS: string[] = [
  "#E0533B", // red
  "#D85A30", // coral
  "#E08A2E", // orange
  "#BA7517", // amber
  "#C9A227", // gold
  "#6FA63C", // lime
  "#3FA663", // green
  "#1D9E75", // teal
  "#2BA8A0", // cyan
  "#378ADD", // blue
  "#4F6BD6", // indigo
  "#7F77DD", // purple
  "#9B5FD0", // violet
  "#C45FB8", // magenta
  "#D4537E", // pink
  "#5F5E5A", // gray
];

export interface Folder {
  id: string;
  name: string;
  color: string;
  stage: Stage;
  /** Parent folder id for nesting; undefined = top level. */
  parentId?: string;
  /** Manual order in the list (drag to reorder). */
  order: number;
  /** Device-local fold state for the expander. */
  collapsed?: boolean;
  createdAt: string;
  updatedAt: string;
}

const FOLDERS_KEY = "less:folders";

function nowIso(): string {
  return new Date().toISOString();
}

function readAll(): Folder[] {
  const raw = lsGet(FOLDERS_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as Folder[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeAll(list: Folder[]): void {
  lsSet(FOLDERS_KEY, JSON.stringify(list));
}

/** All folders, in manual order. */
export function listFolders(): Folder[] {
  return readAll()
    .slice()
    .sort((a, b) => a.order - b.order || (a.createdAt < b.createdAt ? -1 : 1));
}

export function createFolder(name?: string, parentId?: string): Folder {
  const list = readAll();
  const siblings = list.filter((f) => (f.parentId ?? null) === (parentId ?? null));
  const ts = nowIso();
  const folder: Folder = {
    id: crypto.randomUUID(),
    name: name?.trim() || "New folder",
    color: FOLDER_COLORS[list.length % FOLDER_COLORS.length],
    stage: "in_progress",
    parentId: parentId ?? undefined,
    order: siblings.length ? Math.max(...siblings.map((f) => f.order)) + 1 : 0,
    createdAt: ts,
    updatedAt: ts,
  };
  writeAll([...list, folder]);
  return folder;
}

export function updateFolder(
  id: string,
  patch: Partial<Pick<Folder, "name" | "color" | "stage" | "collapsed">> & {
    /** string nests under that folder; null moves to the top level. */
    parentId?: string | null;
  }
): void {
  const list = readAll();
  const i = list.findIndex((f) => f.id === id);
  if (i < 0) return;
  const next: Folder = { ...list[i] };
  // Store the name as typed so spaces (including a just-typed trailing space)
  // survive; the UI normalizes/trims when editing finishes.
  if (patch.name !== undefined) next.name = patch.name;
  if (patch.color !== undefined) next.color = patch.color;
  if (patch.stage !== undefined) next.stage = patch.stage;
  if (patch.collapsed !== undefined) next.collapsed = patch.collapsed;
  if (patch.parentId !== undefined) {
    if (patch.parentId === null) delete next.parentId;
    else next.parentId = patch.parentId;
  }
  next.updatedAt = nowIso();
  list[i] = next;
  writeAll(list);
}

export function deleteFolder(id: string): void {
  writeAll(readAll().filter((f) => f.id !== id));
}

/**
 * Set the order of just the named folders (one container's siblings) from a
 * drag-to-reorder result, bumping updatedAt so the change wins on sync. Folders
 * not named here (other containers) are left untouched.
 */
export function reorderFolders(orderedIds: string[]): void {
  const list = readAll();
  const pos = new Map(orderedIds.map((id, i) => [id, i]));
  const ts = nowIso();
  let changed = false;
  for (let i = 0; i < list.length; i++) {
    const o = pos.get(list[i].id);
    if (o !== undefined && list[i].order !== o) {
      list[i] = { ...list[i], order: o, updatedAt: ts };
      changed = true;
    }
  }
  if (changed) writeAll(list);
}

export function toggleFolderCollapsed(id: string): void {
  const list = readAll();
  const i = list.findIndex((f) => f.id === id);
  if (i < 0) return;
  // Folders are collapsed by default (undefined or true); expanded is exactly
  // collapsed === false. Toggle between those two so a fresh folder opens.
  const expanded = list[i].collapsed === false;
  list[i] = { ...list[i], collapsed: expanded };
  writeAll(list);
}

export function getFolder(id: string): Folder | null {
  return readAll().find((f) => f.id === id) ?? null;
}

/** A folder row coming from the cloud, ready to merge into local storage. */
export interface CloudFolderShape {
  id: string;
  name: string;
  color: string;
  stage: Stage;
  parent_id: string | null;
  position: number;
  updated_at: string;
}

/**
 * Merge a folder from the cloud into local storage (used on sign-in pull). The
 * device-local `collapsed` state and a sensible createdAt are preserved.
 */
export function upsertLocalFolder(cf: CloudFolderShape): void {
  const list = readAll();
  const i = list.findIndex((f) => f.id === cf.id);
  const next: Folder = {
    id: cf.id,
    name: cf.name,
    color: cf.color,
    stage: cf.stage,
    // Never let a folder be its own parent (defensive against a corrupt row).
    parentId: cf.parent_id && cf.parent_id !== cf.id ? cf.parent_id : undefined,
    order: cf.position,
    collapsed: i >= 0 ? list[i].collapsed : undefined,
    createdAt: i >= 0 ? list[i].createdAt : cf.updated_at,
    updatedAt: cf.updated_at,
  };
  if (i >= 0) list[i] = next;
  else list.push(next);
  writeAll(list);
}

/** Remove a folder locally without any of the reparenting the UI does. */
export function removeLocalFolder(id: string): void {
  writeAll(readAll().filter((f) => f.id !== id));
}

/* --- Delete tombstones (so a delete converges across devices) ------------- */

export interface FolderTombstone {
  id: string;
  at: string;
}

const FOLDER_TOMB_KEY = "less:folders:tombstones";

export function listFolderTombstones(): FolderTombstone[] {
  const raw = lsGet(FOLDER_TOMB_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as FolderTombstone[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function markFolderTombstone(id: string, at: string): void {
  const list = listFolderTombstones().filter((t) => t.id !== id);
  list.push({ id, at });
  lsSet(FOLDER_TOMB_KEY, JSON.stringify(list));
}

export function clearFolderTombstone(id: string): void {
  const next = listFolderTombstones().filter((t) => t.id !== id);
  lsSet(FOLDER_TOMB_KEY, next.length ? JSON.stringify(next) : null);
}

/**
 * Wipe all local folders + tombstones. Used on sign-out so the next account on a
 * shared browser does not inherit (and re-upload) the previous user's folders.
 */
export function clearLocalFolders(): void {
  lsSet(FOLDERS_KEY, null);
  lsSet(FOLDER_TOMB_KEY, null);
}
