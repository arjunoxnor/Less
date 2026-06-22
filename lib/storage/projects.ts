import type { JSONContent } from "@tiptap/core";
import type { TitlePage } from "@/lib/export/titlePage";
import type { PageLock } from "@/lib/export/pageLock";
import type { BreakdownItem } from "@/lib/editor/breakdown";
import { lsGet, lsSet } from "./localStore";
import { deriveTitle, isMeaningfulDoc } from "@/lib/editor/docUtils";
import { deriveTitleFor } from "@/lib/editor/plainDocUtils";

/**
 * Multi-project, local-first storage. Replaces the single-document scheme: a
 * small INDEX of project metadata plus per-project content keys. The dashboard
 * renders from the index without parsing every document; bodies load lazily.
 *
 * A project's local id IS its cloud id (scripts.id), so an offline-created
 * project uploads as a deterministic insert with no remapping.
 */

export type ProjectType = "screenplay" | "plain";
export type ProjectStatus = "not_started" | "writing" | "done";

/** Lightweight index entry: what the dashboard renders. */
export interface ProjectMeta {
  id: string;
  title: string;
  type: ProjectType;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  /** Whether a matching cloud row has been created for this project yet. */
  cloudCreated: boolean;
  /** True once the user names/renames it, so autosave stops auto-deriving the title. */
  titleManual?: boolean;
  /** Optional goal page count, shown in the status bar (local-only). */
  pageTarget?: number;
  /** Which folder this project is filed under (local-only); undefined = loose. */
  folderId?: string;
  /** Manual position within its container (local-only); unset sorts by recency. */
  order?: number;
}

/** A full project: metadata plus its body. */
export interface Project extends ProjectMeta {
  content: JSONContent;
  titlePage?: TitlePage | null;
}

/** A new screenplay starts on a single empty scene-heading line. */
export const EMPTY_SCREENPLAY: JSONContent = {
  type: "doc",
  content: [{ type: "screenplayLine", attrs: { element: "scene_heading" } }],
};

/** A new plain document starts on a single empty paragraph. */
export const EMPTY_PLAIN_DOC: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

const INDEX_KEY = "less:projects:index";
const LAST_OPENED_KEY = "less:lastOpenedId";
const TOMBSTONE_KEY = "less:projects:tombstones";

const docKey = (id: string) => `less:project:${id}:doc`;
const tpKey = (id: string) => `less:project:${id}:titlePage`;
const lockKey = (id: string) => `less:project:${id}:pageLock`;
const breakdownKey = (id: string) => `less:project:${id}:breakdown`;
const dirtyKey = (id: string) => `less:project:${id}:dirty`;
const lastSavedKey = (id: string) => `less:project:${id}:lastSavedAt`;

// Legacy single-document keys, read once during migration.
const LEGACY_DOC = "less:script:current";
const LEGACY_TP = "less:titlePage";
const LEGACY_ACTIVE = "less:activeScriptId";
const LEGACY_LASTSAVED = "less:lastSavedAt";
const LEGACY_DIRTY = "less:dirty";

function nowIso(): string {
  return new Date().toISOString();
}

function readIndex(): ProjectMeta[] {
  const raw = lsGet(INDEX_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as ProjectMeta[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeIndex(list: ProjectMeta[]): void {
  lsSet(INDEX_KEY, JSON.stringify(list));
}

function patchMeta(id: string, patch: Partial<ProjectMeta>): void {
  const list = readIndex();
  const i = list.findIndex((m) => m.id === id);
  if (i < 0) return;
  list[i] = { ...list[i], ...patch };
  writeIndex(list);
}

/* --- Reads --------------------------------------------------------------- */

/** All project metadata, newest-updated first. */
export function listProjects(): ProjectMeta[] {
  return readIndex()
    .slice()
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

export function getProjectMeta(id: string): ProjectMeta | null {
  return readIndex().find((m) => m.id === id) ?? null;
}

export function loadProjectDoc(id: string): JSONContent | null {
  const raw = lsGet(docKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as JSONContent;
  } catch {
    return null;
  }
}

export function loadProjectTitlePage(id: string): TitlePage | null {
  const raw = lsGet(tpKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TitlePage;
  } catch {
    return null;
  }
}

export function loadProject(id: string): Project | null {
  const meta = getProjectMeta(id);
  if (!meta) return null;
  const content =
    loadProjectDoc(id) ?? (meta.type === "plain" ? EMPTY_PLAIN_DOC : EMPTY_SCREENPLAY);
  const titlePage = meta.type === "screenplay" ? loadProjectTitlePage(id) : null;
  return { ...meta, content, titlePage };
}

/* --- Writes -------------------------------------------------------------- */

/**
 * Save a project's document, refreshing its index updatedAt and derived title.
 * Returns true only if the document write actually persisted; false means local
 * storage is full or disabled, so the caller can warn the user rather than show
 * a false "Saved".
 */
export function saveProjectDoc(id: string, content: JSONContent): boolean {
  const ok = lsSet(docKey(id), JSON.stringify(content));
  const meta = getProjectMeta(id);
  if (meta) {
    const patch: Partial<ProjectMeta> = { updatedAt: nowIso() };
    // Auto-name only plain docs (Google-Docs style), and only while the writer
    // has not set a title. A screenplay's title is always explicit; deriving it
    // from the first line (a scene heading) would clobber the real title.
    if (!meta.titleManual && meta.type === "plain") {
      patch.title = deriveTitleFor(meta.type, content);
    }
    patchMeta(id, patch);
  }
  return ok;
}

export function saveProjectTitlePage(id: string, tp: TitlePage | null): void {
  if (tp === null) lsSet(tpKey(id), null);
  else lsSet(tpKey(id), JSON.stringify(tp));
}

/* --- Page lock (local-only; production page-number freeze + A-pages) ------ */

export function loadPageLock(id: string): PageLock | null {
  const raw = lsGet(lockKey(id));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PageLock;
    return parsed && Array.isArray(parsed.anchors) ? parsed : null;
  } catch {
    return null;
  }
}

export function savePageLock(id: string, lock: PageLock | null): void {
  if (lock === null) lsSet(lockKey(id), null);
  else lsSet(lockKey(id), JSON.stringify(lock));
}

/* --- Breakdown tags (local-only; production element catalog) -------------- */

export function loadBreakdown(id: string): BreakdownItem[] {
  const raw = lsGet(breakdownKey(id));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as BreakdownItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveBreakdown(id: string, items: BreakdownItem[]): void {
  if (!items.length) lsSet(breakdownKey(id), null);
  else lsSet(breakdownKey(id), JSON.stringify(items));
}

/** Create a new local project (instant, offline-safe). */
export function createProject(
  type: ProjectType,
  opts?: {
    title?: string;
    content?: JSONContent;
    titlePage?: TitlePage | null;
    pageTarget?: number;
  }
): Project {
  const id = crypto.randomUUID();
  const content =
    opts?.content ?? (type === "plain" ? EMPTY_PLAIN_DOC : EMPTY_SCREENPLAY);
  const ts = nowIso();
  const meta: ProjectMeta = {
    id,
    title: opts?.title?.trim() || "Untitled",
    type,
    status: "not_started",
    createdAt: ts,
    updatedAt: ts,
    cloudCreated: false,
    titleManual: Boolean(opts?.title?.trim()),
    ...(opts?.pageTarget ? { pageTarget: opts.pageTarget } : {}),
  };
  lsSet(docKey(id), JSON.stringify(content));
  if (opts?.titlePage) saveProjectTitlePage(id, opts.titlePage);
  const list = readIndex();
  list.unshift(meta);
  writeIndex(list);
  return { ...meta, content, titlePage: opts?.titlePage ?? null };
}

export function renameProject(id: string, title: string): void {
  patchMeta(id, { title: title.trim() || "Untitled", titleManual: true, updatedAt: nowIso() });
}

export function setStatus(id: string, status: ProjectStatus): void {
  patchMeta(id, { status });
}

/**
 * File a project into a folder, or null to move it to the loose top level.
 * Bumps updatedAt so placement changes participate in last-write-wins sync.
 */
export function setProjectFolder(id: string, folderId: string | null): void {
  patchMeta(id, { folderId: folderId ?? undefined, updatedAt: nowIso() });
}

/**
 * Apply a folder placement pulled from the cloud (folder + manual position).
 * Pass the cloud row's updatedAt so the local timestamp aligns and the value
 * does not immediately bounce back on the next reconcile.
 */
export function setProjectPlacement(
  id: string,
  folderId: string | null,
  position: number | null,
  updatedAt?: string
): void {
  patchMeta(id, {
    folderId: folderId ?? undefined,
    order: position ?? undefined,
    ...(updatedAt ? { updatedAt } : {}),
  });
}

/** Persist a manual order (local-only) for a set of project ids in a container. */
export function reorderProjects(orderedIds: string[]): void {
  const list = readIndex();
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
  if (changed) writeIndex(list);
}

/** Move every project out of a folder (used when a folder is deleted). */
export function unfileFolder(folderId: string): void {
  const list = readIndex();
  let changed = false;
  for (let i = 0; i < list.length; i++) {
    if (list[i].folderId === folderId) {
      list[i] = { ...list[i], folderId: undefined };
      changed = true;
    }
  }
  if (changed) writeIndex(list);
}

export function markCloudCreated(id: string, value = true): void {
  patchMeta(id, { cloudCreated: value });
}

export function deleteProject(id: string): void {
  writeIndex(readIndex().filter((m) => m.id !== id));
  lsSet(docKey(id), null);
  lsSet(tpKey(id), null);
  lsSet(lockKey(id), null);
  lsSet(breakdownKey(id), null);
  lsSet(dirtyKey(id), null);
  lsSet(lastSavedKey(id), null);
  if (getLastOpenedId() === id) setLastOpenedId(null);
}

/** Add a cloud-only project to the local index (lazy body, loaded on open). */
export function upsertCloudMeta(meta: ProjectMeta): void {
  const list = readIndex();
  const i = list.findIndex((m) => m.id === meta.id);
  // A title pulled from the cloud is an explicit title (it was set on some
  // device), so mark it manual; the local doc-save auto-namer must not rewrite
  // it from the document's first line.
  const incoming = { ...meta, titleManual: true };
  if (i < 0) list.unshift(incoming);
  else list[i] = { ...list[i], ...incoming };
  writeIndex(list);
}

/* --- Last-opened + per-project bookkeeping ------------------------------- */

export function getLastOpenedId(): string | null {
  return lsGet(LAST_OPENED_KEY);
}
export function setLastOpenedId(id: string | null): void {
  lsSet(LAST_OPENED_KEY, id);
}

export const isDirty = (id: string) => lsGet(dirtyKey(id)) === "1";
export const setDirty = (id: string, dirty: boolean) =>
  lsSet(dirtyKey(id), dirty ? "1" : "0");
export const getLastSavedAt = (id: string) => lsGet(lastSavedKey(id));
export const setLastSavedAt = (id: string, iso: string | null) =>
  lsSet(lastSavedKey(id), iso);

/* --- Tombstones (offline cloud deletes, flushed on reconnect) ------------ */

function readTombstones(): string[] {
  const raw = lsGet(TOMBSTONE_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as string[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
export function markDeletedTombstone(id: string): void {
  const t = readTombstones();
  if (!t.includes(id)) lsSet(TOMBSTONE_KEY, JSON.stringify([...t, id]));
}
export function listTombstones(): string[] {
  return readTombstones();
}
export function clearTombstone(id: string): void {
  lsSet(TOMBSTONE_KEY, JSON.stringify(readTombstones().filter((x) => x !== id)));
}

/* --- Sign-out resets ----------------------------------------------------- */

/** Wipe every per-project sync bookkeeping key and the last-opened pointer. */
export function clearAllBookkeeping(): void {
  for (const m of readIndex()) {
    lsSet(dirtyKey(m.id), null);
    lsSet(lastSavedKey(m.id), null);
  }
  setLastOpenedId(null);
}

/**
 * On sign-out, drop cloud-derived projects (and their keys) so a shared browser
 * does not leak the prior user's cloud work, while keeping anonymous local work.
 */
export function dropCloudProjects(): void {
  const keep: ProjectMeta[] = [];
  for (const m of readIndex()) {
    if (m.cloudCreated) {
      lsSet(docKey(m.id), null);
      lsSet(tpKey(m.id), null);
      lsSet(lockKey(m.id), null);
      lsSet(breakdownKey(m.id), null);
      lsSet(dirtyKey(m.id), null);
      lsSet(lastSavedKey(m.id), null);
    } else {
      keep.push(m);
    }
  }
  writeIndex(keep);
}

/* --- One-time migration of the legacy single document -------------------- */

/**
 * Turn the pre-Phase-7 single document into the first project. Idempotent: once
 * the index exists this returns immediately. Reuses the legacy activeScriptId as
 * the project id so a migrated project re-binds to its existing cloud row rather
 * than duplicating it. Legacy keys are left in place this release for rollback.
 */
export function migrateLegacyDoc(): void {
  if (lsGet(INDEX_KEY) !== null) return; // already initialized

  let index: ProjectMeta[] = [];
  const legacyRaw = lsGet(LEGACY_DOC);
  if (legacyRaw) {
    let doc: JSONContent | null = null;
    try {
      doc = JSON.parse(legacyRaw) as JSONContent;
    } catch {
      doc = null;
    }
    if (doc) {
      const legacyActive = lsGet(LEGACY_ACTIVE);
      const id = legacyActive || crypto.randomUUID();
      const ts = nowIso();
      const meta: ProjectMeta = {
        id,
        title: deriveTitle(doc),
        type: "screenplay",
        status: isMeaningfulDoc(doc) ? "writing" : "not_started",
        createdAt: ts,
        updatedAt: ts,
        cloudCreated: Boolean(legacyActive),
      };
      lsSet(docKey(id), JSON.stringify(doc));
      const legacyTp = lsGet(LEGACY_TP);
      if (legacyTp) lsSet(tpKey(id), legacyTp);
      const legacyLastSaved = lsGet(LEGACY_LASTSAVED);
      if (legacyLastSaved) lsSet(lastSavedKey(id), legacyLastSaved);
      const legacyDirty = lsGet(LEGACY_DIRTY);
      if (legacyDirty) lsSet(dirtyKey(id), legacyDirty);
      index = [meta];
      setLastOpenedId(id);
    }
  }
  writeIndex(index); // existence of INDEX_KEY is the idempotency guard
}
