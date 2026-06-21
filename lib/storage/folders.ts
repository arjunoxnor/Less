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
export const FOLDER_COLORS: string[] = [
  "#7F77DD", // purple
  "#1D9E75", // teal
  "#D85A30", // coral
  "#D4537E", // pink
  "#378ADD", // blue
  "#BA7517", // amber
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
  if (patch.name !== undefined) next.name = patch.name.trim() || "Untitled folder";
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

/** Persist a new folder order from a list of ids (drag-to-reorder result). */
export function reorderFolders(orderedIds: string[]): void {
  const byId = new Map(readAll().map((f) => [f.id, f]));
  const next: Folder[] = [];
  orderedIds.forEach((id, idx) => {
    const f = byId.get(id);
    if (f) {
      next.push({ ...f, order: idx });
      byId.delete(id);
    }
  });
  // Any folder not named in the order keeps following, after the ordered ones.
  let tail = orderedIds.length;
  for (const f of byId.values()) next.push({ ...f, order: tail++ });
  writeAll(next);
}

export function toggleFolderCollapsed(id: string): void {
  const list = readAll();
  const i = list.findIndex((f) => f.id === id);
  if (i < 0) return;
  list[i] = { ...list[i], collapsed: !list[i].collapsed };
  writeAll(list);
}
