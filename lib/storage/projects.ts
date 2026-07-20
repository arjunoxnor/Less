import type { JSONContent } from "@tiptap/core";
import type { TitlePage } from "@/lib/export/titlePage";
import type { PageLock } from "@/lib/export/pageLock";
import type { BreakdownItem } from "@/lib/editor/breakdown";
import { lsGet, lsSet } from "./localStore";
import { broadcast } from "./broadcast";
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
  /** When the placement (folder/position) last changed. Synced separately from
   *  updatedAt so a content save can never out-rank a real folder move. */
  placedAt?: string;
  /** When the title last changed locally. Its own clock so an unrelated remote
   *  status/folder change can never make a stale cloud title out-rank a rename. */
  titleAt?: string;
  /** When the status last changed locally (own clock, same reason as titleAt). */
  statusAt?: string;
  /** The local body was evicted to free storage (the cloud copy is the truth).
   *  The editor host re-fetches it from the cloud before mounting. */
  bodyEvicted?: boolean;
  /** Cached page count from the editor's visual pagination, written on the
   *  debounced save so the dashboard can show "12 pp" without parsing bodies.
   *  Optional and additive (Superaudit 2, Part 5); local-only, no migration. */
  pageCount?: number;
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
const localVersKey = (id: string) => `less:project:${id}:localvers`;
const localVersAtKey = (id: string) => `less:project:${id}:localversAt`;

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
  broadcast({ type: "indexChanged" }); // let sibling tabs refresh the dashboard
}

function patchMeta(id: string, patch: Partial<ProjectMeta>): void {
  const list = readIndex();
  const i = list.findIndex((m) => m.id === id);
  if (i < 0) return;
  list[i] = { ...list[i], ...patch };
  writeIndex(list);
}

/** Public metadata patch (used by reconcile to adopt a newer cloud title/status). */
export function patchProjectMeta(id: string, patch: Partial<ProjectMeta>): void {
  patchMeta(id, patch);
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
/* --- Local version history --------------------------------------------------
   A small on-device snapshot ring per project, so a writer who never signs in
   still has a rollback safety net (cloud snapshots require an account). Ring is
   bounded by count AND total bytes so it cannot eat the storage quota. */

export interface LocalVersion {
  at: string; // ISO timestamp; doubles as the id
  content: JSONContent;
  titlePage?: TitlePage | null;
  label?: string;
}

const LOCAL_VERS_MAX = 8; // snapshots kept per project
const LOCAL_VERS_BYTES = 1_200_000; // ~1.2MB serialized budget per project
const LOCAL_VERS_THROTTLE_MS = 3 * 60 * 1000; // one automatic snapshot per 3 min

export function listLocalVersions(id: string): LocalVersion[] {
  const raw = lsGet(localVersKey(id));
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as LocalVersion[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/**
 * Add a snapshot to the project's local ring. Automatic snapshots (no `force`)
 * are throttled and deduped against the newest entry; pre-destructive snapshots
 * (restore/import, `force: true`) always land. Oldest entries are dropped to
 * stay inside the count/byte budget; on a quota failure the ring keeps dropping
 * and retrying so a full disk degrades to fewer snapshots, not a crash.
 */
export function addLocalVersion(
  id: string,
  content: JSONContent,
  titlePage?: TitlePage | null,
  label?: string,
  opts?: { force?: boolean }
): void {
  const now = Date.now();
  if (!opts?.force) {
    const last = Number(lsGet(localVersAtKey(id)) || "0");
    if (now - last < LOCAL_VERS_THROTTLE_MS) return;
  }
  const entry: LocalVersion = {
    at: new Date(now).toISOString(),
    content,
    titlePage: titlePage ?? null,
    ...(label ? { label } : {}),
  };
  const serializedDoc = JSON.stringify(content);
  let ring = listLocalVersions(id);
  // Dedupe: skip an automatic snapshot identical to the newest one.
  if (!opts?.force && ring[0] && JSON.stringify(ring[0].content) === serializedDoc) {
    lsSet(localVersAtKey(id), String(now));
    return;
  }
  ring = [entry, ...ring].slice(0, LOCAL_VERS_MAX);
  // Enforce the byte budget (keep at least the newest entry).
  let payload = JSON.stringify(ring);
  while (ring.length > 1 && payload.length > LOCAL_VERS_BYTES) {
    ring = ring.slice(0, ring.length - 1);
    payload = JSON.stringify(ring);
  }
  // Quota-resilient write: drop oldest and retry until it fits or one remains.
  while (!lsSet(localVersKey(id), payload) && ring.length > 1) {
    ring = ring.slice(0, ring.length - 1);
    payload = JSON.stringify(ring);
  }
  lsSet(localVersAtKey(id), String(now));
}

export function clearLocalVersions(id: string): void {
  lsSet(localVersKey(id), null);
  lsSet(localVersAtKey(id), null);
}

/* --- Storage eviction --------------------------------------------------------
   Under storage pressure, free the LARGE local artifacts (doc body + snapshot
   ring) of projects whose truth is safely in the cloud. Local-first means a
   local copy is sacred unless ALL of these hold: it has a cloud row, it has no
   unsynced edits, it has actually synced at least once, and it is not the
   project currently open. Metadata, title page, page locks, and breakdown tags
   are kept (small, and the latter two exist only locally). The evicted body is
   re-fetched from the cloud before the editor mounts (see EditorHost). */

export function evictSyncedBodies(opts?: { exceptId?: string | null; max?: number }): number {
  const except = opts?.exceptId ?? getLastOpenedId();
  const max = opts?.max ?? 5;
  const candidates = readIndex()
    .filter(
      (m) =>
        m.cloudCreated &&
        !m.bodyEvicted &&
        m.id !== except &&
        lsGet(dirtyKey(m.id)) !== "1" && // no unsynced edits
        !!lsGet(lastSavedKey(m.id)) && // synced at least once
        !!lsGet(docKey(m.id)) // has a body to free
    )
    // Least-recently-edited first: the writer is least likely to miss these.
    .sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : 1))
    .slice(0, max);
  for (const m of candidates) {
    lsSet(docKey(m.id), null);
    clearLocalVersions(m.id);
    // Clearing lastSavedAt makes the open-time reconcile treat the cloud copy
    // as newer (belt and suspenders behind the bodyEvicted fetch path).
    lsSet(lastSavedKey(m.id), null);
    patchMeta(m.id, { bodyEvicted: true });
  }
  return candidates.length;
}

/** Called after the cloud body is re-fetched on open: store it and clear the flag. */
export function restoreEvictedBody(
  id: string,
  content: JSONContent,
  titlePage: TitlePage | null,
  cloudUpdatedAt: string
): boolean {
  const ok = lsSet(docKey(id), JSON.stringify(content));
  if (!ok) return false;
  saveProjectTitlePage(id, titlePage);
  lsSet(lastSavedKey(id), cloudUpdatedAt);
  patchMeta(id, { bodyEvicted: false });
  return true;
}

export function saveProjectDoc(id: string, content: JSONContent): boolean {
  const ok = lsSet(docKey(id), JSON.stringify(content));
  // If the body did not persist (storage full/disabled), do NOT bump updatedAt
  // or re-derive the title: that would advance the index past content we failed
  // to save and could push a stale/empty doc up on the next sync.
  if (!ok) return false;
  broadcast({ type: "docSaved", id }); // sibling tabs can adopt the newer body
  // On-device rollback safety net (throttled inside; ~1 snapshot per 3 min).
  addLocalVersion(id, content, loadProjectTitlePage(id));
  const meta = getProjectMeta(id);
  if (meta) {
    const patch: Partial<ProjectMeta> = { updatedAt: nowIso() };
    // Auto-name only plain docs (Google-Docs style), and only while the writer
    // has not set a title. A screenplay's title is always explicit; deriving it
    // from the first line (a scene heading) would clobber the real title.
    if (!meta.titleManual && meta.type === "plain") {
      const derived = deriveTitleFor(meta.type, content);
      patch.title = derived;
      // A changed auto-title is a genuine local title change, so mark it dirty
      // and advance the title clock. The content save no longer carries the
      // title, so this is how a plain-doc rename-by-typing reaches the cloud
      // (via the title-only endpoint on the next push).
      if (derived !== meta.title) {
        patch.titleAt = nowIso();
        setTitleDirty(id, true);
      }
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
    folderId?: string | null;
    status?: ProjectStatus;
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
    status: opts?.status ?? "not_started",
    createdAt: ts,
    updatedAt: ts,
    cloudCreated: false,
    titleManual: Boolean(opts?.title?.trim()),
    ...(opts?.pageTarget ? { pageTarget: opts.pageTarget } : {}),
    // Created already filed (bulk import): carry the folder + a placement clock
    // so the very first cloud insert is filed, not loose-then-patched.
    ...(opts?.folderId ? { folderId: opts.folderId, placedAt: ts } : {}),
  };
  const bodyOk = lsSet(docKey(id), JSON.stringify(content));
  // If real content was provided (an import) and the body did not persist
  // (storage full), fail loudly instead of committing a named-but-blank project
  // to the index. The caller's try/catch surfaces it as a failed import.
  if (!bodyOk && opts?.content) {
    throw new Error("Storage is full, so this document could not be saved on this device.");
  }
  if (opts?.titlePage) saveProjectTitlePage(id, opts.titlePage);
  const list = readIndex();
  list.unshift(meta);
  writeIndex(list);
  return { ...meta, content, titlePage: opts?.titlePage ?? null };
}

export function renameProject(id: string, title: string): void {
  const ts = nowIso();
  patchMeta(id, { title: title.trim() || "Untitled", titleManual: true, updatedAt: ts, titleAt: ts });
  setTitleDirty(id, true);
}

export function setStatus(id: string, status: ProjectStatus): void {
  // Do NOT bump updatedAt here (it would let a stale local title/placement
  // out-rank a newer cloud one). Stamp the dedicated status clock instead, and
  // mark status-dirty so reconcile pushes it.
  patchMeta(id, { status, statusAt: nowIso() });
  setStatusDirty(id, true);
}

/**
 * File a project into a folder, or null to move it to the loose top level.
 * Bumps updatedAt so placement changes participate in last-write-wins sync.
 */
export function setProjectFolder(id: string, folderId: string | null): void {
  const ts = nowIso();
  patchMeta(id, { folderId: folderId ?? undefined, updatedAt: ts, placedAt: ts });
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
  placedAt?: string
): void {
  patchMeta(id, {
    folderId: folderId ?? undefined,
    order: position ?? undefined,
    ...(placedAt ? { placedAt } : {}),
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
      list[i] = { ...list[i], order: o, updatedAt: ts, placedAt: ts };
      changed = true;
    }
  }
  if (changed) writeIndex(list);
}

// (Removed dead `unfileFolder`: folder deletion reparents each child via
// setProjectFolder in ProjectsHome.removeFolder, which already bumps the
// placement clock. The standalone helper had no call sites.)

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
  lsSet(tpDirtyKey(id), null);
  lsSet(statusDirtyKey(id), null);
  lsSet(titleDirtyKey(id), null);
  lsSet(lastSavedKey(id), null);
  clearLocalVersions(id);
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

// Title-page-specific dirty flag, separate from the content dirty flag and
// persisted so it survives a reload. It lets the reconcile distinguish "the
// local title page is a pending edit that must be pushed" from "the local title
// page is just stale and must not clobber a newer cloud one".
const tpDirtyKey = (id: string) => `less:project:${id}:tpDirty`;
export const isTitlePageDirty = (id: string) => lsGet(tpDirtyKey(id)) === "1";
export const setTitlePageDirty = (id: string, dirty: boolean) =>
  lsSet(tpDirtyKey(id), dirty ? "1" : null);

// Status-specific dirty flag (persisted), set when the user changes a project's
// status. Reconcile pushes a status-dirty project's status WITHOUT advancing the
// shared updatedAt clock, so a status change never clobbers a title or placement.
const statusDirtyKey = (id: string) => `less:project:${id}:statusDirty`;
export const isStatusDirty = (id: string) => lsGet(statusDirtyKey(id)) === "1";
export const setStatusDirty = (id: string, dirty: boolean) =>
  lsSet(statusDirtyKey(id), dirty ? "1" : null);

// Title-specific dirty flag (persisted), set on a local rename so reconcile can
// push the new title up even from a dashboard rename made offline/signed out
// (which has no open editor and so no body-sync push), without using the shared
// updatedAt clock (which would let a stale title clobber a newer cloud one).
const titleDirtyKey = (id: string) => `less:project:${id}:titleDirty`;
export const isTitleDirty = (id: string) => lsGet(titleDirtyKey(id)) === "1";
export const setTitleDirty = (id: string, dirty: boolean) =>
  lsSet(titleDirtyKey(id), dirty ? "1" : null);

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
    lsSet(tpDirtyKey(m.id), null);
    lsSet(statusDirtyKey(m.id), null);
    lsSet(titleDirtyKey(m.id), null);
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
      lsSet(tpDirtyKey(m.id), null);
      lsSet(statusDirtyKey(m.id), null);
      lsSet(titleDirtyKey(m.id), null);
      lsSet(lastSavedKey(m.id), null);
      clearLocalVersions(m.id);
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
