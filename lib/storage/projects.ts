import type { JSONContent } from "@tiptap/core";
import type { TitlePage } from "@/lib/export/titlePage";
import type { PageLock } from "@/lib/export/pageLock";
import type { BreakdownItem } from "@/lib/editor/breakdown";
import { lsGet, lsKeys, lsSet } from "./localStore";
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

/** "voice" is a plain document the writer dictates into and hands to the
    structuring worker. It shares the plain editor and schema; the separate type
    exists so the worker can only ever touch these rows and never a real script. */
export type ProjectType = "screenplay" | "plain" | "voice";
export type ProjectStatus = "not_started" | "writing" | "done";

/**
 * Voice notes ARE plain documents: same schema, same editor, same title
 * derivation. The separate type exists only so the structuring worker can scope
 * exactly which rows it is allowed to touch. Every behavioural check should ask
 * this, never compare to "plain" directly, or a voice note quietly starts being
 * treated as a screenplay.
 */
export function usesPlainSchema(type: ProjectType): boolean {
  return type === "plain" || type === "voice";
}

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
  /** A first cloud insert is in flight; sign-out must wait for its result. */
  cloudCreatePending?: boolean;
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
const INDEX_PENDING_KEY = `${INDEX_KEY}:pending`;
const INDEX_BACKUP_KEY = `${INDEX_KEY}:backup`;
const LAST_OPENED_KEY = "less:lastOpenedId";
const OPENED_IDS_KEY = "less:projects:openedIds";
/** How many recently-opened projects eviction refuses to touch. Enough for the
 *  editor tabs a writer can realistically have open at once; see
 *  setLastOpenedId for why this list must stay bounded. */
const RECENTLY_OPENED_MAX = 4;
const TOMBSTONE_KEY = "less:projects:tombstones";
const TOMBSTONE_PENDING_KEY = `${TOMBSTONE_KEY}:pending`;
const TOMBSTONE_BACKUP_KEY = `${TOMBSTONE_KEY}:backup`;
const DELETED_COPIES_KEY = "less:projects:deletedCopies";

const docKey = (id: string) => `less:project:${id}:doc`;
const docPendingKey = (id: string) => `${docKey(id)}:pending`;
const docBackupKey = (id: string) => `${docKey(id)}:backup`;
const tpKey = (id: string) => `less:project:${id}:titlePage`;
const tpPendingKey = (id: string) => `${tpKey(id)}:pending`;
const tpBackupKey = (id: string) => `${tpKey(id)}:backup`;
const tpClearedKey = (id: string) => `${tpKey(id)}:cleared`;
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

type StoredDoc = { content: JSONContent; raw: string };

const observedBodies = new Map<string, string>();
const redirectedProjects = new Map<string, string>();

function parseDoc(raw: string | null): StoredDoc | null {
  if (!raw) return null;
  try {
    const content = JSON.parse(raw) as JSONContent;
    return content && typeof content === "object" && !Array.isArray(content)
      ? { content, raw }
      : null;
  } catch {
    return null;
  }
}

/** Prefer a complete pending write, then the primary, then the last backup. */
function readStoredDoc(id: string): StoredDoc | null {
  for (const key of [docPendingKey(id), docKey(id), docBackupKey(id)]) {
    const parsed = parseDoc(lsGet(key));
    if (parsed) return parsed;
  }
  // If all body copies were damaged, a bounded local snapshot is still a
  // usable recovery source. Do not write it back during a read; the next save
  // goes through the recoverable transaction below.
  const versions = lsGet(localVersKey(id));
  if (versions) {
    try {
      const entries = JSON.parse(versions) as Array<{ content?: JSONContent }>;
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          if (entry?.content && typeof entry.content === "object") {
            return { content: entry.content, raw: JSON.stringify(entry.content) };
          }
        }
      }
    } catch {
      /* keep looking: the caller will block an unsafe empty-document open */
    }
  }
  return null;
}

/**
 * Is there plausibly a readable body for this project, WITHOUT parsing it?
 * A full JSON.parse of every body is what made readIndex cost ~17ms per
 * autosave; this checks only that some copy exists and is not truncated
 * (a cut-short value loses its closing brace), which is all the index needs.
 */
function hasStoredBody(id: string): boolean {
  for (const key of [docPendingKey(id), docKey(id), docBackupKey(id)]) {
    const raw = lsGet(key);
    if (raw && looksLikeJsonObject(raw)) return true;
  }
  // The bounded local history ring is the last recovery source (see
  // readStoredDoc), so a project that still has one is not bodyless.
  return Boolean(lsGet(localVersKey(id)));
}

/** First and last non-space characters only: O(1) on a 200 KiB body. */
function looksLikeJsonObject(raw: string): boolean {
  let start = 0;
  while (start < raw.length && raw.charCodeAt(start) <= 32) start++;
  let end = raw.length - 1;
  while (end > start && raw.charCodeAt(end) <= 32) end--;
  return raw.charCodeAt(start) === 123 /* { */ && raw.charCodeAt(end) === 125 /* } */;
}

function validTime(value: unknown, fallback: string): string {
  return typeof value === "string" && Number.isFinite(new Date(value).getTime())
    ? value
    : fallback;
}

function inferType(content: JSONContent | undefined): ProjectType {
  return content?.content?.some((node) => node.type === "screenplayLine")
    ? "screenplay"
    : "plain";
}

function sanitizeMeta(value: unknown): ProjectMeta | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Partial<ProjectMeta>;
  const id = raw.id;
  if (typeof id !== "string" || !id.trim()) return null;
  // LAZY. readIndex runs three times per autosave, so reading and parsing every
  // indexed body here cost ~17ms of synchronous main-thread work per save at ten
  // projects, and broke this file's own invariant that the dashboard renders
  // from the index without parsing every document. A body is read only for a row
  // whose metadata is actually missing or invalid, which is the rare repair case.
  let storedCache: StoredDoc | null | undefined;
  const stored = (): StoredDoc | null =>
    storedCache === undefined ? (storedCache = readStoredDoc(id)) : storedCache;
  const type =
    raw.type === "plain" || raw.type === "screenplay" || raw.type === "voice"
      ? raw.type
      : inferType(stored()?.content);
  const ts = nowIso();
  const createdAt = validTime(raw.createdAt, validTime(raw.updatedAt, ts));
  const updatedAt = validTime(raw.updatedAt, createdAt);
  let status: ProjectStatus;
  if (raw.status === "not_started" || raw.status === "writing" || raw.status === "done") {
    status = raw.status;
  } else {
    const body = stored();
    status = body && isMeaningfulForRecovery(type, body.content) ? "writing" : "not_started";
  }
  let title: string;
  if (typeof raw.title === "string" && raw.title.trim()) {
    title = raw.title;
  } else {
    const body = stored();
    title = body ? deriveTitleFor(type, body.content).trim() || "Untitled" : "Untitled";
  }
  return {
    ...raw,
    id,
    title,
    type,
    status,
    createdAt,
    updatedAt,
    cloudCreated: raw.cloudCreated === true,
    // An indexed project with no recoverable local body must never mount an
    // empty editor and later push that blank document. EditorHost already has
    // a guarded cloud-hydration path for this flag. The presence test is the
    // cheap one: existence plus an untruncated shape, no parse.
    ...(hasStoredBody(id) ? {} : { bodyEvicted: true }),
  };
}

function isMeaningfulForRecovery(type: ProjectType, content: JSONContent): boolean {
  return type === "screenplay" ? isMeaningfulDoc(content) : Boolean(deriveTitleFor(type, content));
}

function parseIndex(raw: string | null): ProjectMeta[] | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const out: ProjectMeta[] = [];
    const seen = new Set<string>();
    for (const value of parsed) {
      const meta = sanitizeMeta(value);
      if (!meta || seen.has(meta.id)) continue;
      seen.add(meta.id);
      out.push(meta);
    }
    return out;
  } catch {
    return null;
  }
}

function rawTombstones(): Set<string> {
  for (const key of [TOMBSTONE_PENDING_KEY, TOMBSTONE_KEY, TOMBSTONE_BACKUP_KEY]) {
    const raw = lsGet(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return new Set(parsed.filter((id): id is string => typeof id === "string"));
      }
    } catch {
      /* try the next recovery copy */
    }
  }
  return new Set();
}

function recoverOrphanBodies(list: ProjectMeta[]): ProjectMeta[] {
  const known = new Set(list.map((meta) => meta.id));
  const tombed = rawTombstones();
  const bodyIds = new Set<string>();
  for (const key of lsKeys()) {
    const match = /^less:project:(.+):doc(?::(?:pending|backup))?$/.exec(key);
    if (match) bodyIds.add(match[1]);
  }
  const recovered = [...list];
  for (const id of bodyIds) {
    if (known.has(id) || tombed.has(id)) continue;
    const stored = readStoredDoc(id);
    if (!stored) continue;
    const type = inferType(stored.content);
    const ts = nowIso();
    recovered.unshift({
      id,
      title: `${deriveTitleFor(type, stored.content).trim() || "Untitled"} (Recovered)`,
      type,
      status: isMeaningfulForRecovery(type, stored.content) ? "writing" : "not_started",
      createdAt: ts,
      updatedAt: ts,
      cloudCreated: false,
      titleManual: true,
    });
    known.add(id);
  }
  return recovered;
}

function readIndex(): ProjectMeta[] {
  for (const key of [INDEX_PENDING_KEY, INDEX_KEY, INDEX_BACKUP_KEY]) {
    const parsed = parseIndex(lsGet(key));
    if (parsed !== null) return recoverOrphanBodies(parsed);
  }
  // A corrupt/missing index is not an empty library. Rebuild its view from the
  // independently stored bodies; a later mutation persists this recovered list.
  return recoverOrphanBodies([]);
}

function storedExactly(key: string, payload: string): boolean {
  return lsGet(key) === payload;
}

/**
 * Commit the index through a durable pending copy. A quota failure on the main
 * key leaves the complete pending index authoritative, rather than orphaning a
 * body or replacing the library with an empty array.
 */
function writeIndex(list: ProjectMeta[]): boolean {
  const payload = JSON.stringify(list);
  if (!lsSet(INDEX_PENDING_KEY, payload) || !storedExactly(INDEX_PENDING_KEY, payload)) {
    return false;
  }
  const mainOk = lsSet(INDEX_KEY, payload) && storedExactly(INDEX_KEY, payload);
  if (mainOk) {
    lsSet(INDEX_BACKUP_KEY, payload);
  }
  broadcast({ type: "indexChanged" }); // let sibling tabs refresh the dashboard
  return true; // pending is a complete durable commit even if the main write failed
}

function patchMeta(id: string, patch: Partial<ProjectMeta>): boolean {
  const list = readIndex();
  const i = list.findIndex((m) => m.id === id);
  if (i < 0) return false;
  list[i] = { ...list[i], ...patch };
  return writeIndex(list);
}

/** Public metadata patch (used by reconcile to adopt a newer cloud title/status). */
export function patchProjectMeta(id: string, patch: Partial<ProjectMeta>): boolean {
  return patchMeta(id, patch);
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
  const localId = redirectedProjects.get(id) ?? id;
  const stored = readStoredDoc(localId);
  if (!stored) return null;
  observedBodies.set(localId, stored.raw);
  if (localId !== id) observedBodies.set(id, stored.raw);
  return stored.content;
}

export function loadProjectTitlePage(id: string): TitlePage | null {
  const localId = redirectedProjects.get(id) ?? id;
  const pending = lsGet(tpPendingKey(localId));
  const candidates = pending
    ? [pending]
    : lsGet(tpClearedKey(localId)) === "1"
      ? []
      : [lsGet(tpKey(localId)), lsGet(tpBackupKey(localId))];
  for (const raw of candidates) {
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as TitlePage;
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      /* try the next recoverable copy */
    }
  }
  return null;
}

export function loadProject(id: string): Project | null {
  const meta = getProjectMeta(id);
  if (!meta) return null;
  const content =
    loadProjectDoc(id) ??
    (usesPlainSchema(meta.type) ? EMPTY_PLAIN_DOC : EMPTY_SCREENPLAY);
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
): boolean {
  const now = Date.now();
  if (!opts?.force) {
    const last = Number(lsGet(localVersAtKey(id)) || "0");
    if (now - last < LOCAL_VERS_THROTTLE_MS) return true;
  }
  const existing = listLocalVersions(id);
  // Multiple forced actions can happen in one millisecond. Keep their ids
  // distinct so History never renders one restore target as another.
  const newestAt = existing[0] ? new Date(existing[0].at).getTime() : 0;
  const entryTime = opts?.force && newestAt >= now ? newestAt + 1 : now;
  const entry: LocalVersion = {
    at: new Date(entryTime).toISOString(),
    content,
    titlePage: titlePage ?? null,
    ...(label ? { label } : {}),
  };
  const serializedDoc = JSON.stringify(content);
  let ring = existing;
  // Dedupe: skip an automatic snapshot identical to the newest one.
  if (!opts?.force && ring[0] && JSON.stringify(ring[0].content) === serializedDoc) {
    lsSet(localVersAtKey(id), String(now));
    return true;
  }
  ring = [entry, ...ring].slice(0, LOCAL_VERS_MAX);
  // Enforce the byte budget (keep at least the newest entry).
  let payload = JSON.stringify(ring);
  while (ring.length > 1 && payload.length > LOCAL_VERS_BYTES) {
    ring = ring.slice(0, ring.length - 1);
    payload = JSON.stringify(ring);
  }
  // Quota-resilient write: drop oldest and retry until it fits or one remains.
  let saved = lsSet(localVersKey(id), payload);
  while (!saved && ring.length > 1) {
    ring = ring.slice(0, ring.length - 1);
    payload = JSON.stringify(ring);
    saved = lsSet(localVersKey(id), payload);
  }
  if (saved) lsSet(localVersAtKey(id), String(now));
  return saved;
}

export function clearLocalVersions(id: string): void {
  lsSet(localVersKey(id), null);
  lsSet(localVersAtKey(id), null);
}

function writeProjectBody(id: string, payload: string): { ok: boolean; previous: StoredDoc | null } {
  const previous = readStoredDoc(id);
  if (previous?.raw === payload) return { ok: true, previous };

  // Preserve the currently readable body before attempting to replace it. If
  // there is not enough space for that safety copy, leave the primary alone and
  // report a failed save; replacing the only durable copy is never acceptable.
  if (
    previous &&
    (!lsSet(docBackupKey(id), previous.raw) || !storedExactly(docBackupKey(id), previous.raw))
  ) {
    return { ok: false, previous };
  }
  if (!lsSet(docPendingKey(id), payload) || !storedExactly(docPendingKey(id), payload)) {
    return { ok: false, previous };
  }
  const mainOk = lsSet(docKey(id), payload) && storedExactly(docKey(id), payload);
  // A complete pending value is itself durable, so it is kept when the primary
  // write throws or is silently truncated; loadProjectDoc always prefers it.
  // Once the primary IS verifiably complete the mirror is pure duplication, and
  // keeping it forever tripled every body in storage (body + pending + backup).
  // A 110-page feature is ~189 KiB, so ten of them went from ~1.85M chars to
  // ~5.54M and blew the ~5M quota, after which every autosave failed. Steady
  // state is therefore the body plus one previous-body backup.
  if (mainOk) lsSet(docPendingKey(id), null);
  return { ok: true, previous };
}

function uniqueProjectId(): string {
  const used = new Set(readIndex().map((meta) => meta.id));
  for (let attempt = 0; attempt < 100; attempt++) {
    const id = crypto.randomUUID();
    if (!used.has(id) && !readStoredDoc(id)) return id;
  }
  // A hostile/broken randomUUID implementation must not make us overwrite an
  // existing body. The fallback remains unique within this storage namespace.
  let suffix = 0;
  let id = `recovered-${Date.now()}-${suffix}`;
  while (used.has(id) || readStoredDoc(id)) id = `recovered-${Date.now()}-${++suffix}`;
  return id;
}

function saveConflictCopy(sourceId: string, content: JSONContent): boolean {
  const source = getProjectMeta(sourceId);
  const id = uniqueProjectId();
  const payload = JSON.stringify(content);
  if (!writeProjectBody(id, payload).ok) return false;
  const sourceTitlePage = loadProjectTitlePage(sourceId);
  if (sourceTitlePage) saveProjectTitlePage(id, sourceTitlePage);
  const type = source?.type ?? inferType(content);
  const ts = nowIso();
  const meta: ProjectMeta = {
    id,
    title: `${source?.title || deriveTitleFor(type, content).trim() || "Untitled"} (Recovered conflict)`,
    type,
    status: source?.status ?? (isMeaningfulForRecovery(type, content) ? "writing" : "not_started"),
    createdAt: ts,
    updatedAt: ts,
    cloudCreated: false,
    titleManual: true,
  };
  const list = readIndex();
  const recoveredIndex = list.findIndex((entry) => entry.id === id);
  if (recoveredIndex >= 0) list[recoveredIndex] = meta;
  else list.unshift(meta);
  // Even if the index is completely unwritable, the independently keyed body
  // remains discoverable by readIndex's orphan recovery on the next load.
  writeIndex(list);
  redirectedProjects.set(sourceId, id);
  observedBodies.set(sourceId, payload);
  observedBodies.set(id, payload);
  broadcast({ type: "docSaved", id });
  return true;
}

/** The local fork receiving this tab's edits after a cross-tab conflict. */
export function localProjectIdFor(id: string): string {
  return redirectedProjects.get(id) ?? id;
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
  // Recently opened projects are protected because a sibling tab may still be
  // editing one. A corrupt record is treated as "nothing extra to protect"
  // rather than as a reason to evict nothing: this is the only valve that
  // relieves a full disk, and disabling it strands every later autosave. The
  // project this call is for stays protected either way, and eviction only ever
  // touches a body that is clean, cloud-created and already synced.
  const protectedIds = new Set<string>(readRecentlyOpenedIds());
  if (except) protectedIds.add(except);
  const candidates = readIndex()
    .filter(
      (m) =>
        m.cloudCreated &&
        !m.bodyEvicted &&
        !protectedIds.has(m.id) &&
        lsGet(dirtyKey(m.id)) !== "1" && // no unsynced edits
        !!lsGet(lastSavedKey(m.id)) && // synced at least once
        hasStoredBody(m.id) // has a body to free
    )
    // Least-recently-edited first: the writer is least likely to miss these.
    .sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : 1))
    .slice(0, max);
  for (const m of candidates) {
    // Mark first. If the index cannot durably record that the body must be
    // fetched, keep every body copy and skip this candidate.
    if (!patchMeta(m.id, { bodyEvicted: true })) continue;
    lsSet(docKey(m.id), null);
    lsSet(docPendingKey(m.id), null);
    lsSet(docBackupKey(m.id), null);
    // Version history is deliberately retained: an older draft may exist only
    // there even though the current body is confirmed in the cloud.
    // Clearing lastSavedAt makes the open-time reconcile treat the cloud copy
    // as newer (belt and suspenders behind the bodyEvicted fetch path).
    lsSet(lastSavedKey(m.id), null);
  }
  return candidates.filter((m) => getProjectMeta(m.id)?.bodyEvicted).length;
}

/** Called after the cloud body is re-fetched on open: store it and clear the flag. */
export function restoreEvictedBody(
  id: string,
  content: JSONContent,
  titlePage: TitlePage | null,
  cloudUpdatedAt: string
): boolean {
  const ok = writeProjectBody(id, JSON.stringify(content)).ok;
  if (!ok || !saveProjectTitlePage(id, titlePage)) return false;
  if (!lsSet(lastSavedKey(id), cloudUpdatedAt)) return false;
  return patchMeta(id, { bodyEvicted: false });
}

export function saveProjectDoc(id: string, content: JSONContent): boolean {
  const localId = redirectedProjects.get(id) ?? id;
  const payload = JSON.stringify(content);
  const meta = getProjectMeta(localId);
  if (!meta) return saveConflictCopy(id, content);

  const current = readStoredDoc(localId);
  const observed = observedBodies.get(localId) ?? (localId !== id ? observedBodies.get(id) : undefined);
  if (observed !== undefined && current && current.raw !== observed && current.raw !== payload) {
    // This tab began from an older body. Do not choose a winner and overwrite
    // the sibling tab; continue this tab's work in a visible recovered project.
    return saveConflictCopy(id, content);
  }

  const result = writeProjectBody(localId, payload);
  const ok = result.ok;
  // If the body did not persist (storage full/disabled), do NOT bump updatedAt
  // or re-derive the title: that would advance the index past content we failed
  // to save and could push a stale/empty doc up on the next sync.
  if (!ok) return false;
  observedBodies.set(localId, payload);
  if (localId !== id) observedBodies.set(id, payload);
  broadcast({ type: "docSaved", id: localId }); // sibling tabs can adopt the newer body
  // The prior primary, not the just-written primary, belongs in History. The
  // backup key remains an independent copy if the bounded ring cannot grow.
  if (result.previous && result.previous.raw !== payload) {
    addLocalVersion(localId, result.previous.content, loadProjectTitlePage(localId));
  }
  const liveMeta = getProjectMeta(localId);
  if (liveMeta) {
    const patch: Partial<ProjectMeta> = { updatedAt: nowIso() };
    // A body exists locally again, so the guarded cloud-hydration path must not
    // run on the next open and overwrite it with an older cloud copy. (Reachable
    // when eviction freed a body a tab still had open in memory.)
    if (liveMeta.bodyEvicted) patch.bodyEvicted = false;
    // Auto-name only plain docs (Google-Docs style), and only while the writer
    // has not set a title. A screenplay's title is always explicit; deriving it
    // from the first line (a scene heading) would clobber the real title.
    if (!liveMeta.titleManual && usesPlainSchema(liveMeta.type)) {
      const derived = deriveTitleFor(liveMeta.type, content);
      patch.title = derived;
      // A changed auto-title is a genuine local title change, so mark it dirty
      // and advance the title clock. The content save no longer carries the
      // title, so this is how a plain-doc rename-by-typing reaches the cloud
      // (via the title-only endpoint on the next push).
      if (derived !== liveMeta.title) {
        patch.titleAt = nowIso();
      }
    }
    if (!patchMeta(localId, patch)) return false;
    if (patch.titleAt) setTitleDirty(localId, true);
  }
  return ok;
}

export function saveProjectTitlePage(id: string, tp: TitlePage | null): boolean {
  const localId = redirectedProjects.get(id) ?? id;
  const current = loadProjectTitlePage(localId);
  const currentRaw = current ? JSON.stringify(current) : null;
  if (currentRaw && (!lsSet(tpBackupKey(localId), currentRaw) || !storedExactly(tpBackupKey(localId), currentRaw))) {
    return false;
  }
  if (tp === null) {
    if (!lsSet(tpClearedKey(localId), "1") || lsGet(tpClearedKey(localId)) !== "1") return false;
    if (!lsSet(tpPendingKey(localId), null) || lsGet(tpPendingKey(localId)) !== null) return false;
    lsSet(tpKey(localId), null);
  } else {
    const payload = JSON.stringify(tp);
    if (!lsSet(tpPendingKey(localId), payload) || !storedExactly(tpPendingKey(localId), payload)) {
      return false;
    }
    const mainOk = lsSet(tpKey(localId), payload) && storedExactly(tpKey(localId), payload);
    if (!mainOk) {
      broadcast({ type: "titlePageSaved", id: localId });
      return true; // the complete pending title page is authoritative
    }
    // Clear the "cleared" marker BEFORE dropping the mirror: loadProjectTitlePage
    // consults the marker only when no pending copy exists, so the other order
    // would briefly read a saved title page as deliberately cleared.
    lsSet(tpClearedKey(localId), null);
    // Same reasoning as writeProjectBody: with a verified primary the mirror is
    // duplication, and title pages were being stored three times over.
    lsSet(tpPendingKey(localId), null);
  }
  broadcast({ type: "titlePageSaved", id: localId });
  return true;
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
  const id = uniqueProjectId();
  const content =
    opts?.content ?? (usesPlainSchema(type) ? EMPTY_PLAIN_DOC : EMPTY_SCREENPLAY);
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
  const bodyOk = writeProjectBody(id, JSON.stringify(content)).ok;
  // A blank new document still has to survive reload. Private mode used to
  // return a convincing project object while persisting neither body nor index.
  if (!bodyOk) {
    throw new Error("Storage is full, so this document could not be saved on this device.");
  }
  if (opts?.titlePage && !saveProjectTitlePage(id, opts.titlePage)) {
    throw new Error("Storage is full, so this document's title page could not be saved.");
  }
  const list = readIndex();
  const recovered = list.findIndex((entry) => entry.id === id);
  if (recovered >= 0) list[recovered] = meta;
  else list.unshift(meta);
  if (!writeIndex(list)) {
    throw new Error("Storage is full, so this document could not be added to the library.");
  }
  observedBodies.set(id, JSON.stringify(content));
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

export function deleteProject(id: string): boolean {
  // Queue the cloud tombstone first so a delete still reaches the server if this
  // tab closes mid-way. It is BEST EFFORT: deletion is never blocked by it.
  // A writer who deletes a project is often doing it to free a full disk, so a
  // failed bookkeeping write must not silently do nothing. (An earlier version
  // also wrote a full "deleted copies" archive that nothing ever read, up to
  // 5,000,000 chars, and aborted the delete when that write failed. Deleting
  // then could not free space, and one corrupt value bricked deletion. The
  // archive is gone; version history and the cloud row remain the recovery
  // paths.)
  let tombstoned = markDeletedTombstone(id);
  if (!writeIndex(readIndex().filter((m) => m.id !== id))) {
    if (tombstoned) clearTombstone(id);
    return false; // the project is still listed, so leave its body alone too
  }
  // Best-effort cleanup of the dead archive key: a briefly-shipped build could
  // have left megabytes here, and nothing reads it.
  lsSet(DELETED_COPIES_KEY, null);
  lsSet(docKey(id), null);
  lsSet(docPendingKey(id), null);
  lsSet(docBackupKey(id), null);
  lsSet(tpKey(id), null);
  lsSet(tpPendingKey(id), null);
  lsSet(tpBackupKey(id), null);
  lsSet(tpClearedKey(id), null);
  lsSet(lockKey(id), null);
  lsSet(breakdownKey(id), null);
  lsSet(dirtyKey(id), null);
  lsSet(tpDirtyKey(id), null);
  lsSet(statusDirtyKey(id), null);
  lsSet(titleDirtyKey(id), null);
  lsSet(lastSavedKey(id), null);
  clearLocalVersions(id);
  // Removing the body freed space, so a tombstone that could not be written a
  // moment ago (full disk) usually fits now. Without it a cloud row could
  // resurrect this project on the next reconcile.
  if (!tombstoned) markDeletedTombstone(id);
  // Do not let a deleted project keep occupying an eviction-protection slot.
  const stillOpen = readRecentlyOpenedIds().filter((entry) => entry !== id);
  lsSet(OPENED_IDS_KEY, stillOpen.length ? JSON.stringify(stillOpen) : null);
  if (getLastOpenedId() === id) setLastOpenedId(null);
  observedBodies.delete(id);
  return true;
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
/** The bounded "recently opened" set, oldest first. Corrupt input reads empty. */
function readRecentlyOpenedIds(): string[] {
  const raw = lsGet(OPENED_IDS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

export function setLastOpenedId(id: string | null): void {
  if (id) {
    // A set rather than a single shared "active id": two tabs can be editing
    // different projects, and overwriting one id with the other made quota
    // eviction delete the first tab's live body.
    //
    // It is bounded to the RECENTLY opened projects. Append-only, it grew to
    // cover every project that ever had a local body, which is exactly the set
    // eviction draws from: the quota relief valve could then never free
    // anything, so a full disk stayed full and every autosave failed. Keeping
    // the last few covers the tabs a writer can plausibly have open while
    // leaving older projects reclaimable. A corrupt record self-repairs here.
    let opened = readRecentlyOpenedIds().filter((entry) => entry !== id);
    opened.push(id); // most recent last
    if (opened.length > RECENTLY_OPENED_MAX) {
      opened = opened.slice(opened.length - RECENTLY_OPENED_MAX);
    }
    lsSet(OPENED_IDS_KEY, JSON.stringify(opened));
  }
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

/** True when signing out would discard cloud-backed work not yet confirmed. */
export function hasPendingCloudWork(): boolean {
  return readIndex().some(
    (m) =>
      m.cloudCreatePending ||
      (m.cloudCreated &&
        (isDirty(m.id) ||
          isTitlePageDirty(m.id) ||
          isStatusDirty(m.id) ||
          isTitleDirty(m.id)))
  );
}

/* --- Tombstones (offline cloud deletes, flushed on reconnect) ------------ */

function readTombstones(): string[] {
  return [...rawTombstones()];
}
function writeTombstones(ids: string[]): boolean {
  const payload = JSON.stringify([...new Set(ids)]);
  if (!lsSet(TOMBSTONE_PENDING_KEY, payload) || !storedExactly(TOMBSTONE_PENDING_KEY, payload)) {
    return false;
  }
  const mainOk = lsSet(TOMBSTONE_KEY, payload) && storedExactly(TOMBSTONE_KEY, payload);
  if (mainOk) {
    lsSet(TOMBSTONE_BACKUP_KEY, payload);
  }
  return true;
}
export function markDeletedTombstone(id: string): boolean {
  const t = readTombstones();
  return t.includes(id) ? true : writeTombstones([...t, id]);
}
export function listTombstones(): string[] {
  return readTombstones();
}
export function clearTombstone(id: string): boolean {
  return writeTombstones(readTombstones().filter((x) => x !== id));
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
      lsSet(docPendingKey(m.id), null);
      lsSet(docBackupKey(m.id), null);
      lsSet(tpKey(m.id), null);
      lsSet(tpPendingKey(m.id), null);
      lsSet(tpBackupKey(m.id), null);
      lsSet(tpClearedKey(m.id), null);
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
  // Any complete index generation (including a pending quota-recovery commit)
  // is the idempotency guard. A corrupt main value alone is not: in that case
  // the legacy original must still be offered for recovery.
  if (
    [INDEX_PENDING_KEY, INDEX_KEY, INDEX_BACKUP_KEY].some(
      (key) => parseIndex(lsGet(key)) !== null
    )
  ) return;

  let index: ProjectMeta[] = readIndex();
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
      // With no cloud id, derive a stable local id from the untouched legacy
      // payload. If an index write fails, the next startup targets the same body
      // instead of creating another orphan with a fresh random UUID.
      const id = legacyActive || `legacy-${stableLegacyHash(legacyRaw)}`;
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
      if (!writeProjectBody(id, JSON.stringify(doc)).ok) return;
      const legacyTp = lsGet(LEGACY_TP);
      if (legacyTp) {
        try {
          if (!saveProjectTitlePage(id, JSON.parse(legacyTp) as TitlePage)) return;
        } catch {
          // Preserve the original legacy key; never mark a malformed/truncated
          // migration complete by writing an index that points at lost metadata.
          return;
        }
      }
      const legacyLastSaved = lsGet(LEGACY_LASTSAVED);
      if (legacyLastSaved) lsSet(lastSavedKey(id), legacyLastSaved);
      const legacyDirty = lsGet(LEGACY_DIRTY);
      if (legacyDirty) lsSet(dirtyKey(id), legacyDirty);
      const existing = index.findIndex((entry) => entry.id === id);
      if (existing >= 0) index[existing] = meta;
      else index.unshift(meta);
      if (writeIndex(index)) setLastOpenedId(id);
      return;
    }
  }
  writeIndex(index); // a valid empty index is also an idempotency guard
}

function stableLegacyHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
