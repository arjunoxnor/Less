import type { ProjectMeta } from "./projects";
import type { Folder } from "./folders";

/**
 * The library: a read-only reading of the existing data for the home screen.
 * Nothing here writes, and no stored shape changes. Folders stay folders and
 * projects stay projects, in localStorage and in sync.
 *
 * The one rule, and it is the whole model: A FOLDER IS A FOLDER. The writer's
 * own hierarchy is shown at the depth they built it, never flattened and never
 * reinterpreted.
 *
 *   depth 0  a top-level folder            -> a SECTION heading
 *   depth 1  a folder inside one of those  -> a CARD on the desk
 *   depth 2+ anything deeper               -> a SHELF inside that card
 *
 * Against a real library that reads:
 *
 *   InProgress                    <- section
 *     GodsOfOurAncestors          <- card
 *       (its own scripts)
 *       Old Drafts                <- shelf inside the card
 *     ChessMaster                 <- card
 *       old, One Pagers           <- shelves
 *
 * Projects sitting directly in a section, or in no folder at all, are never
 * dropped: they surface as that section's loose items, or in the unfiled band.
 *
 * Everything takes the project and folder lists as arguments (no storage
 * reads), so the selectors stay pure and unit-testable in node.
 */

/** A folder deeper than a card, listed inside its card with its own label. */
export interface Shelf {
  folder: Folder;
  /** Nesting below the card: 1 for a card's own child, 2 for its grandchild. */
  depth: number;
  items: ProjectMeta[];
}

/** A depth-1 folder: one object on the desk. */
export interface Card {
  folder: Folder;
  /** Projects filed directly in this folder, in the writer's order. */
  items: ProjectMeta[];
  /** Everything filed deeper, in tree order, each under its folder's name. */
  shelves: Shelf[];
  /** Every project in the card, however deep. */
  total: number;
  /** The newest screenplay in the card, or the newest project if none. */
  current: ProjectMeta | null;
  lastTouched: string;
}

/** A top-level folder: a heading with cards under it. */
export interface Section {
  folder: Folder;
  cards: Card[];
  /** Projects filed straight into the section, with no card of their own. */
  loose: ProjectMeta[];
  lastTouched: string;
}

export interface Library {
  sections: Section[];
  /** Projects in no folder at all. */
  unfiled: ProjectMeta[];
}

/** Whether a folder may be moved to a target without creating a cycle. */
export function canMoveFolderTo(
  sourceId: string,
  targetId: string | null,
  folders: Folder[]
): boolean {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  if (!byId.has(sourceId)) return false;
  if (targetId === null) return true;
  if (!byId.has(targetId)) return false;

  const seen = new Set<string>();
  let current: Folder | undefined = byId.get(targetId);
  while (current) {
    if (current.id === sourceId) return false;
    if (seen.has(current.id)) return false;
    seen.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return true;
}

/** Whether a live project may be dropped on a live folder or the unfiled band. */
export function canMoveProjectTo(
  projectId: string,
  targetId: string | null,
  projects: ProjectMeta[],
  folders: Folder[]
): boolean {
  if (!projects.some((project) => project.id === projectId)) return false;
  return targetId === null || folders.some((folder) => folder.id === targetId);
}

/** Drop fold entries for folders that no longer exist or invalid old values. */
export function pruneFolderFolds(
  folds: Record<string, unknown>,
  folders: Folder[]
): Record<string, boolean> {
  const known = new Set(folders.map((folder) => folder.id));
  return Object.fromEntries(
    Object.entries(folds).filter(
      (entry): entry is [string, boolean] =>
        known.has(entry[0]) && typeof entry[1] === "boolean"
    )
  );
}

/**
 * Reorder one id at a list slot. null means the drop was a no-op or invalid,
 * so callers do not stamp placement clocks for a row dropped on itself.
 */
export function reorderIdsAtSlot(
  ids: string[],
  sourceId: string,
  slot: number
): string[] | null {
  const from = ids.indexOf(sourceId);
  if (from < 0) return null;
  const bounded = Math.max(0, Math.min(slot, ids.length));
  const to = bounded > from ? bounded - 1 : bounded;
  if (to === from) return null;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, sourceId);
  return next;
}

/**
 * The writer's own order, and nothing else: a manual position when one is set,
 * otherwise oldest first. Deliberately NOT by updatedAt. Filing something into
 * a folder stamps that project's clock, so a recency order made whatever you
 * just touched leap to the top of the page, which is disorienting when you are
 * only tidying up. Things stay where you put them.
 */
function byPlace(a: ProjectMeta, b: ProjectMeta): number {
  const oa = a.order ?? Number.MAX_SAFE_INTEGER;
  const ob = b.order ?? Number.MAX_SAFE_INTEGER;
  if (oa !== ob) return oa - ob;
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

function newer(a: string, b: string): string {
  return a > b ? a : b;
}

/**
 * Children of each folder id (null for top level), each list in the writer's
 * own order. A parentId pointing at a folder that does not exist is treated as
 * top-level, and a parent cycle is broken by ignoring the link, so every folder
 * always appears exactly once and nothing can vanish from the screen.
 */
function childIndex(folders: Folder[]): Map<string | null, Folder[]> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  /** True when walking up from this folder actually reaches a top level. */
  const rootsCleanly = (f: Folder): boolean => {
    const seen = new Set<string>([f.id]);
    let cur = f;
    while (cur.parentId && byId.has(cur.parentId)) {
      if (seen.has(cur.parentId)) return false; // a loop: never reaches a root
      seen.add(cur.parentId);
      cur = byId.get(cur.parentId)!;
    }
    return true;
  };
  const kids = new Map<string | null, Folder[]>();
  for (const f of folders) {
    // Corrupt data must never swallow a folder: anything whose chain loops is
    // hoisted to the top instead of hiding inside its own cycle. Hoisting every
    // member also leaves the remaining tree genuinely acyclic, so the walks
    // below terminate.
    const key = f.parentId && byId.has(f.parentId) && rootsCleanly(f) ? f.parentId : null;
    const list = kids.get(key);
    if (list) list.push(f);
    else kids.set(key, [f]);
  }
  for (const list of kids.values()) {
    list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }
  return kids;
}

/** Every folder and its visible path for keyboard-accessible move controls. */
export function listFolderMoveTargets(
  folders: Folder[]
): { folder: Folder; path: string }[] {
  const kids = childIndex(folders);
  const out: { folder: Folder; path: string }[] = [];
  const seen = new Set<string>();
  const walk = (parentId: string | null, path: string) => {
    for (const folder of kids.get(parentId) ?? []) {
      if (seen.has(folder.id)) continue;
      seen.add(folder.id);
      out.push({ folder, path });
      walk(folder.id, path ? `${path} / ${folder.name}` : folder.name);
    }
  };
  walk(null, "");
  return out;
}

function projectIndex(projects: ProjectMeta[], folders: Folder[]) {
  const known = new Set(folders.map((f) => f.id));
  const inFolder = new Map<string, ProjectMeta[]>();
  const unfiled: ProjectMeta[] = [];
  for (const p of projects) {
    if (!p.folderId || !known.has(p.folderId)) {
      unfiled.push(p);
      continue;
    }
    const list = inFolder.get(p.folderId);
    if (list) list.push(p);
    else inFolder.set(p.folderId, [p]);
  }
  for (const list of inFolder.values()) list.sort(byPlace);
  unfiled.sort(byPlace);
  return { inFolder, unfiled };
}

/** Depth-first walk below a card, so shelves read in the writer's own order. */
function collectShelves(
  folder: Folder,
  depth: number,
  kids: Map<string | null, Folder[]>,
  inFolder: Map<string, ProjectMeta[]>,
  out: Shelf[]
) {
  for (const child of kids.get(folder.id) ?? []) {
    out.push({ folder: child, depth, items: inFolder.get(child.id) ?? [] });
    collectShelves(child, depth + 1, kids, inFolder, out);
  }
}

function buildCard(
  folder: Folder,
  kids: Map<string | null, Folder[]>,
  inFolder: Map<string, ProjectMeta[]>
): Card {
  const items = inFolder.get(folder.id) ?? [];
  const shelves: Shelf[] = [];
  collectShelves(folder, 1, kids, inFolder, shelves);

  const all = [...items, ...shelves.flatMap((s) => s.items)];
  // "Current" is about which draft to continue, so it IS the newest script.
  // It decides no positions, so nothing on the page moves when it changes.
  const newestFirst = (a: ProjectMeta, b: ProjectMeta) =>
    a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0;
  const scripts = all.filter((p) => p.type === "screenplay").sort(newestFirst);
  const current = scripts[0] ?? [...all].sort(newestFirst)[0] ?? null;

  let lastTouched = folder.updatedAt;
  for (const p of all) lastTouched = newer(lastTouched, p.updatedAt);

  return { folder, items, shelves, total: all.length, current, lastTouched };
}

/**
 * The whole home in one pass, every list in the writer's own order. Nothing
 * here is sorted by a clock, so tidying up never rearranges the page.
 */
export function listLibrary(projects: ProjectMeta[], folders: Folder[]): Library {
  const kids = childIndex(folders);
  const { inFolder, unfiled } = projectIndex(projects, folders);

  const sections: Section[] = [];
  for (const top of kids.get(null) ?? []) {
    const cards = (kids.get(top.id) ?? []).map((f) => buildCard(f, kids, inFolder));
    const loose = inFolder.get(top.id) ?? [];

    let lastTouched = top.updatedAt;
    for (const c of cards) lastTouched = newer(lastTouched, c.lastTouched);
    for (const p of loose) lastTouched = newer(lastTouched, p.updatedAt);

    // No clock sort here either: childIndex already has these in the writer's
    // own folder order, and that is the order the page keeps.
    sections.push({ folder: top, cards, loose, lastTouched });
  }

  return { sections, unfiled };
}

/** What one folder holds, at any depth: drives its own page. */
export interface FolderView {
  folder: Folder;
  /** Ancestors, outermost first, for the breadcrumb. */
  trail: Folder[];
  items: ProjectMeta[];
  shelves: Shelf[];
  total: number;
  current: ProjectMeta | null;
  lastTouched: string;
  /** True when this folder is a card (depth 1) or deeper. */
  depth: number;
}

export function folderView(
  folderId: string,
  projects: ProjectMeta[],
  folders: Folder[]
): FolderView | null {
  const folder = folders.find((f) => f.id === folderId);
  if (!folder) return null;
  const kids = childIndex(folders);
  const { inFolder } = projectIndex(projects, folders);
  const card = buildCard(folder, kids, inFolder);

  // Walk up for the breadcrumb, cycle-safe.
  const byId = new Map(folders.map((f) => [f.id, f]));
  const trail: Folder[] = [];
  const seen = new Set<string>([folder.id]);
  let cur = folder;
  while (cur.parentId && byId.has(cur.parentId) && !seen.has(cur.parentId)) {
    seen.add(cur.parentId);
    cur = byId.get(cur.parentId)!;
    trail.unshift(cur);
  }

  return {
    folder,
    trail,
    items: card.items,
    shelves: card.shelves,
    total: card.total,
    current: card.current,
    lastTouched: card.lastTouched,
    depth: trail.length,
  };
}

/**
 * The card a project belongs to: its depth-1 ancestor, or its own folder when
 * that folder is a section or shallower. Drives the editor's Docs panel and
 * the "back to where I came from" label. Null for an unfiled project.
 */
export function cardForProject(
  projectId: string,
  projects: ProjectMeta[],
  folders: Folder[]
): Card | null {
  const p = projects.find((m) => m.id === projectId);
  if (!p || !p.folderId) return null;
  const byId = new Map(folders.map((f) => [f.id, f]));
  let folder = byId.get(p.folderId);
  if (!folder) return null;

  // Climb to the depth-1 folder: the object this project lives on.
  const chain: Folder[] = [folder];
  const seen = new Set<string>([folder.id]);
  while (folder.parentId && byId.has(folder.parentId) && !seen.has(folder.parentId)) {
    seen.add(folder.parentId);
    folder = byId.get(folder.parentId)!;
    chain.unshift(folder);
  }
  // chain[0] is the section; chain[1] is the card. A project filed straight
  // into a section has no card of its own, so the section stands in.
  const cardFolder = chain[1] ?? chain[0];

  const kids = childIndex(folders);
  const { inFolder } = projectIndex(projects, folders);
  return buildCard(cardFolder, kids, inFolder);
}
