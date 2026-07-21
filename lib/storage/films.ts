import type { ProjectMeta, ProjectStatus } from "./projects";
import type { Folder } from "./folders";

/**
 * Films: the read-only reinterpretation layer over the existing data (the
 * films-home build, Altitude 0). Nothing here writes anything, and no stored
 * shape changes: folders stay folders and projects stay projects in
 * localStorage and in sync. These selectors just answer the question the new
 * home asks: "what films am I making, and what loose ideas do I have?"
 *
 * The rules, from the spec:
 *  - A FILM is a top-level folder. Its contents are every project whose
 *    effective folder chain roots at it, so nested folders flatten into the
 *    film in the view (the data keeps its nesting untouched).
 *  - A loose screenplay (no folder) is an IMPLICIT film: one line on the
 *    home with no folder behind it in the data.
 *  - Loose plain documents are IDEAS.
 *  - Orphan-safe: a folderId or parentId pointing at a folder that does not
 *    exist is treated as "no folder", so nothing ever vanishes from view.
 *
 * Everything takes the project and folder lists as arguments (no storage
 * reads), so the selectors are pure and unit-testable in node.
 */

/** The color a film wears when no folder exists to carry one (implicit films). */
export const IMPLICIT_FILM_COLOR = "var(--muted)";

export interface Film {
  /** "folder" films are backed by a top-level folder; "implicit" ones are a
   *  single loose screenplay wearing a film's clothes. */
  kind: "folder" | "implicit";
  /** The folder id for folder films; the screenplay's project id otherwise. */
  id: string;
  name: string;
  color: string;
  /** The current draft's status; a film with no script yet reads not_started. */
  status: ProjectStatus;
  /** The most recently updated screenplay in the film, or null (no script yet). */
  currentDraft: ProjectMeta | null;
  /** The other screenplays, newest first. */
  earlierDrafts: ProjectMeta[];
  /** The film's plain documents, newest first. */
  documents: ProjectMeta[];
  /** ISO time of the most recent touch across the film's contents; an empty
   *  folder falls back to the folder's own updatedAt. Orders the home. */
  lastTouched: string;
}

/** Newest first by updatedAt (ISO strings compare correctly as strings). */
function byRecency(a: ProjectMeta, b: ProjectMeta): number {
  return a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0;
}

/**
 * Map every folder id to the id of the top-level folder its parent chain roots
 * at. Orphan parents (pointing at a missing folder) make a folder top-level,
 * and a corrupt parent cycle makes each of its members top-level, so every
 * folder always roots somewhere visible.
 */
function rootIndex(folders: Folder[]): Map<string, string> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const roots = new Map<string, string>();
  for (const f of folders) {
    const seen = new Set<string>();
    let cur = f;
    while (cur.parentId && byId.has(cur.parentId) && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = byId.get(cur.parentId)!;
    }
    // Landed on a genuine top level, or bailed out of a cycle: either way,
    // treat where we stopped as this folder's root.
    roots.set(f.id, cur.id);
  }
  return roots;
}

/** The top-level folder a project effectively belongs to, or null (loose). */
function rootFolderIdOf(
  p: ProjectMeta,
  folderById: Map<string, Folder>,
  roots: Map<string, string>
): string | null {
  if (!p.folderId || !folderById.has(p.folderId)) return null;
  return roots.get(p.folderId) ?? null;
}

/** Assemble one film from a folder and the projects that root at it. */
function buildFolderFilm(folder: Folder, contents: ProjectMeta[]): Film {
  const drafts = contents.filter((p) => p.type === "screenplay").sort(byRecency);
  const documents = contents.filter((p) => p.type === "plain").sort(byRecency);
  const currentDraft = drafts[0] ?? null;
  // The film was last touched when any of its contents were; a folder with
  // nothing in it yet falls back to its own clock so it still sorts sanely.
  let lastTouched = contents.length ? contents[0].updatedAt : folder.updatedAt;
  for (const p of contents) {
    if (p.updatedAt > lastTouched) lastTouched = p.updatedAt;
  }
  return {
    kind: "folder",
    id: folder.id,
    name: folder.name || "Untitled film",
    color: folder.color,
    status: currentDraft?.status ?? "not_started",
    currentDraft,
    earlierDrafts: drafts.slice(1),
    documents,
    lastTouched,
  };
}

/** A loose screenplay dressed as a film: itself the current draft, no folder. */
function buildImplicitFilm(p: ProjectMeta): Film {
  return {
    kind: "implicit",
    id: p.id,
    name: p.title,
    color: IMPLICIT_FILM_COLOR,
    status: p.status,
    currentDraft: p,
    earlierDrafts: [],
    documents: [],
    lastTouched: p.updatedAt,
  };
}

/**
 * Every film in the library, most recently touched first. The first entry is
 * the LEAD: the one the home renders big. Top-level folders each become a
 * film (even empty ones: a film without a script yet), and every loose
 * screenplay becomes an implicit film.
 */
export function listFilms(projects: ProjectMeta[], folders: Folder[]): Film[] {
  const folderById = new Map(folders.map((f) => [f.id, f]));
  const roots = rootIndex(folders);

  // Bucket every project under its root folder (or the loose bucket).
  const byRoot = new Map<string, ProjectMeta[]>();
  const loose: ProjectMeta[] = [];
  for (const p of projects) {
    const rootId = rootFolderIdOf(p, folderById, roots);
    if (rootId === null) {
      loose.push(p);
    } else {
      const list = byRoot.get(rootId);
      if (list) list.push(p);
      else byRoot.set(rootId, [p]);
    }
  }

  const films: Film[] = [];
  for (const f of folders) {
    if (roots.get(f.id) !== f.id) continue; // nested: flattens into its root
    films.push(buildFolderFilm(f, byRoot.get(f.id) ?? []));
  }
  for (const p of loose) {
    if (p.type === "screenplay") films.push(buildImplicitFilm(p));
  }
  return films.sort((a, b) =>
    a.lastTouched < b.lastTouched ? 1 : a.lastTouched > b.lastTouched ? -1 : 0
  );
}

/** Loose plain documents, newest first: the IDEAS band. Filed documents
 *  belong to their film and never appear here. */
export function listIdeas(projects: ProjectMeta[], folders: Folder[]): ProjectMeta[] {
  const folderById = new Map(folders.map((f) => [f.id, f]));
  return projects
    .filter((p) => p.type === "plain" && (!p.folderId || !folderById.has(p.folderId)))
    .sort(byRecency);
}

/** The film for one top-level folder, or null when the id is unknown or the
 *  folder is nested (nested folders are not films; their root is). Drives the
 *  project page and its unknown-folder guard. */
export function filmForFolder(
  folderId: string,
  projects: ProjectMeta[],
  folders: Folder[]
): Film | null {
  const roots = rootIndex(folders);
  if (roots.get(folderId) !== folderId) return null;
  return listFilms(projects, folders).find((f) => f.id === folderId) ?? null;
}

/** The film a given project belongs to, or null for a loose plain document
 *  (an idea belongs to no film). Drives the editor's Docs panel. */
export function filmForProject(
  projectId: string,
  projects: ProjectMeta[],
  folders: Folder[]
): Film | null {
  const p = projects.find((m) => m.id === projectId);
  if (!p) return null;
  const folderById = new Map(folders.map((f) => [f.id, f]));
  const rootId = rootFolderIdOf(p, folderById, rootIndex(folders));
  if (rootId === null) {
    return p.type === "screenplay" ? buildImplicitFilm(p) : null;
  }
  return filmForFolder(rootId, projects, folders);
}
