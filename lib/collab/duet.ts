import type { JSONContent } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from "y-prosemirror";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

const SHARED_FRAGMENT = "default";
const SHARED_META = "duet-meta";
const SHARE_KEY_PREFIX = "less:duet:share:";
const SHARE_CHANGE_EVENT = "less:duet-share-change";
const DOCUMENT_CACHE_PREFIX = "less:duet:yjs:";
const DISPLAY_NAME_KEY = "less:duet:displayName";
const DEFAULT_SERVER_URL = "wss://less-duet.less-screenwriting.workers.dev/room";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MESSAGE_AWARENESS = 1;
const MESSAGE_QUERY_AWARENESS = 3;
const MESSAGE_SEED = 4;
const COLORS = ["#2563eb", "#dc2626", "#7c3aed", "#059669", "#d97706", "#db2777"];

export type DuetConnectionStatus = "connected" | "reconnecting" | "offline";

export interface DuetUser {
  name: string;
  color: string;
}

export interface DuetParticipant extends DuetUser {
  clientId: number;
  local: boolean;
}

export interface DuetShareRecord {
  token: string;
  ownerKey: string;
}

export interface DuetSession {
  doc: Y.Doc;
  provider: WebsocketProvider;
  token: string;
  owner: boolean;
  ownerKey?: string;
  user: DuetUser;
  seedWhenSynced(schema: Schema, content: JSONContent, title: string): void;
  getContent(): JSONContent;
  getTitle(): string | null;
  setTitle(title: string): void;
  setUser(user: DuetUser): void;
  subscribeDocument(listener: () => void): () => void;
  subscribeTitle(listener: (title: string | null) => void): () => void;
  subscribePresence(listener: (participants: DuetParticipant[]) => void): () => void;
  subscribeStatus(listener: (status: DuetConnectionStatus) => void): () => void;
  subscribeReady(listener: (ready: boolean) => void): () => void;
  localBackupFailed(): boolean;
  destroy(): void;
}

export function duetAllowsLocalCloudSync(
  session: Pick<DuetSession, "setTitle"> | null,
  pending = false
): boolean {
  return session === null && !pending;
}

export function duetCloudSyncProjectId(projectId: string, pending: boolean): string {
  return pending ? `duet-pending:${projectId}` : projectId;
}

export function renameSharedOrLocalTitle(
  session: Pick<DuetSession, "setTitle"> | null,
  renameLocal: (title: string) => void,
  title: string
): void {
  if (session) session.setTitle(title);
  else renameLocal(title);
}

interface PendingSeed {
  schema: Schema;
  content: JSONContent;
  title: string;
}

function storageGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string | null): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const standard = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = standard + "=".repeat((4 - (standard.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function documentCachePrefix(token: string): string {
  return `${DOCUMENT_CACHE_PREFIX}${token}:`;
}

export function restoreDuetDocumentCache(token: string, doc: Y.Doc): void {
  if (typeof window === "undefined") return;
  const prefix = documentCachePrefix(token);
  const snapshots: string[] = [];
  try {
    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const snapshot = window.localStorage.getItem(key);
      if (snapshot) snapshots.push(snapshot);
    }
  } catch {
    return;
  }
  for (const snapshot of snapshots) {
    try {
      Y.applyUpdate(doc, fromBase64Url(snapshot), "duet-local-restore");
    } catch {
      // One corrupt cache entry must not hide other recoverable local updates.
    }
  }
}

export function persistDuetDocumentCache(
  token: string,
  sessionId: string,
  doc: Y.Doc
): boolean {
  if (!roomHasHistory(doc)) return true;
  return storageSet(
    `${documentCachePrefix(token)}${sessionId}`,
    base64Url(Y.encodeStateAsUpdate(doc))
  );
}

function persistDuetDocumentUpdate(
  token: string,
  sessionId: string,
  update: Uint8Array
): boolean {
  const key = `${documentCachePrefix(token)}${sessionId}`;
  const existing = storageGet(key);
  let merged = update;
  if (existing) {
    try {
      merged = Y.mergeUpdates([fromBase64Url(existing), update]);
    } catch {
      // Replacing a corrupt entry with this valid update preserves new work.
    }
  }
  return storageSet(key, base64Url(merged));
}

export function clearDuetDocumentCache(token: string): void {
  if (typeof window === "undefined") return;
  const prefix = documentCachePrefix(token);
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) window.localStorage.removeItem(key);
  } catch {
    // The final project JSON remains the owner's recovery copy if cleanup fails.
  }
}

export function generateShareToken(): string {
  return base64Url(randomBytes(32));
}

export function getProjectShare(projectId: string): DuetShareRecord | null {
  const raw = storageGet(SHARE_KEY_PREFIX + projectId);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DuetShareRecord>;
    if (!TOKEN_PATTERN.test(parsed.token ?? "") || !TOKEN_PATTERN.test(parsed.ownerKey ?? "")) {
      return null;
    }
    return { token: parsed.token!, ownerKey: parsed.ownerKey! };
  } catch {
    return null;
  }
}

export function createProjectShare(projectId: string): DuetShareRecord {
  const existing = getProjectShare(projectId);
  if (existing) return existing;
  const record = { token: generateShareToken(), ownerKey: generateShareToken() };
  if (!storageSet(SHARE_KEY_PREFIX + projectId, JSON.stringify(record))) {
    throw new Error("This browser could not save the sharing link. Free some storage and try again.");
  }
  window.dispatchEvent(new CustomEvent(SHARE_CHANGE_EVENT, { detail: projectId }));
  return record;
}

export function clearProjectShare(projectId: string): void {
  if (!storageSet(SHARE_KEY_PREFIX + projectId, null)) {
    throw new Error(
      "The link was stopped, but this browser could not clear its sharing record. Free some storage and try again."
    );
  }
  window.dispatchEvent(new CustomEvent(SHARE_CHANGE_EVENT, { detail: projectId }));
}

export function subscribeProjectShare(
  projectId: string,
  listener: (record: DuetShareRecord | null) => void
): () => void {
  if (typeof window === "undefined") return () => {};
  const key = SHARE_KEY_PREFIX + projectId;
  const notify = () => listener(getProjectShare(projectId));
  const onStorage = (event: StorageEvent) => {
    if (event.key === key) notify();
  };
  const onLocalChange = (event: Event) => {
    if ((event as CustomEvent<unknown>).detail === projectId) notify();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(SHARE_CHANGE_EVENT, onLocalChange);
  notify();
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(SHARE_CHANGE_EVENT, onLocalChange);
  };
}

export function loadDuetDisplayName(): string | null {
  const value = storageGet(DISPLAY_NAME_KEY)?.trim();
  return value ? value.slice(0, 50) : null;
}

export function saveDuetDisplayName(name: string): void {
  const value = name.trim().slice(0, 50);
  storageSet(DISPLAY_NAME_KEY, value || null);
}

export function makeGuestName(): string {
  return `Guest ${base64Url(randomBytes(3)).slice(0, 4)}`;
}

export function colorForName(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index++) {
    hash = (hash * 31 + name.charCodeAt(index)) | 0;
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

export function shareLink(token: string): string {
  return `https://less.oxnorhub.com/#/duet/${token}`;
}

function roomHasHistory(doc: Y.Doc): boolean {
  return Y.decodeStateVector(Y.encodeStateVector(doc)).size > 0;
}

/**
 * Build a seed as an update from an isolated document. The live client does not
 * apply it until the Worker has atomically accepted it for an empty room.
 */
export function createSeedUpdate({
  schema,
  content,
  title,
}: {
  schema: Schema;
  content: JSONContent;
  title: string;
}): Uint8Array {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment(SHARED_FRAGMENT);
  doc.transact(() => {
    prosemirrorJSONToYXmlFragment(schema, content, fragment);
    const meta = doc.getMap<string>(SHARED_META);
    meta.set("initialized", "1");
    meta.set("title", title.trim() || "Untitled screenplay");
  }, "duet-initial-seed");
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
}

function encodeSeedRequest(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SEED);
  encoding.writeVarUint8Array(encoder, update);
  return encoding.toUint8Array(encoder);
}

function serverUrl(): string {
  const configured = process.env.NEXT_PUBLIC_DUET_URL?.trim();
  return (configured || DEFAULT_SERVER_URL).replace(/\/+$/, "");
}

function httpServerUrl(): string {
  return serverUrl().replace(/^wss:/, "https:").replace(/^ws:/, "http:");
}

function safePresence(provider: WebsocketProvider, localClientId: number): DuetParticipant[] {
  const participants: DuetParticipant[] = [];
  for (const [clientId, state] of provider.awareness.getStates()) {
    const raw = state?.user as Partial<DuetUser> | undefined;
    if (!raw || typeof raw.name !== "string" || typeof raw.color !== "string") continue;
    const name = raw.name.trim().slice(0, 50);
    const color = /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : colorForName(name);
    if (name) participants.push({ clientId, name, color, local: clientId === localClientId });
  }
  return participants.sort((a, b) => Number(b.local) - Number(a.local) || a.name.localeCompare(b.name));
}

export function createDuetSession({
  projectId: _projectId,
  token,
  owner,
  ownerKey,
  user,
}: {
  projectId: string;
  token: string;
  owner: boolean;
  ownerKey?: string;
  user: DuetUser;
}): DuetSession {
  if (!TOKEN_PATTERN.test(token)) throw new Error("The sharing token is invalid.");
  if (owner && (!ownerKey || !TOKEN_PATTERN.test(ownerKey))) {
    throw new Error("The owner credential is invalid.");
  }
  const sessionId = base64Url(randomBytes(16));
  const doc = new Y.Doc();
  restoreDuetDocumentCache(token, doc);
  let backupFailed = false;
  const persistLocalDocument = (update: Uint8Array) => {
    backupFailed = !persistDuetDocumentUpdate(token, sessionId, update);
  };
  doc.on("update", persistLocalDocument);
  backupFailed = !persistDuetDocumentCache(token, sessionId, doc);
  const provider = new WebsocketProvider(serverUrl(), token, doc, {
    params: {
      ...(ownerKey ? { owner: ownerKey } : {}),
      client: String(doc.clientID),
      session: sessionId,
    },
    connect: false,
    // A revoked link must not keep syncing through a same-browser broadcast
    // channel after the Worker has closed the room.
    disableBc: true,
  });
  provider.awareness.setLocalStateField("user", user);

  let pendingSeed: PendingSeed | null = null;
  let seedInFlight = false;
  let connectionStarted = false;
  let synced = provider.synced;
  let currentUser = user;
  let ready = false;
  const readyListeners = new Set<(value: boolean) => void>();
  let status: DuetConnectionStatus =
    typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "reconnecting";
  const statusListeners = new Set<(value: DuetConnectionStatus) => void>();

  // A standard awareness query includes every remote state the peer knows.
  // Duet binds one awareness client id to each socket, so answer with local
  // presence only and let the Worker fan out one bounded state per peer.
  provider.messageHandlers[MESSAGE_QUERY_AWARENESS] = (
    encoder,
    _decoder,
    target
  ) => {
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(target.awareness, [target.doc.clientID])
    );
  };

  let onSeedResponse: (snapshot: Uint8Array) => void = () => {};
  provider.messageHandlers[MESSAGE_SEED] = (
    _encoder,
    decoder,
    _target,
    _emitSynced,
    _messageType
  ) => {
    const accepted = decoding.readVarUint(decoder);
    if (accepted !== 0 && accepted !== 1) throw new Error("Invalid seed response");
    const snapshot = decoding.readVarUint8Array(decoder);
    if (decoding.hasContent(decoder)) throw new Error("Invalid seed response");
    onSeedResponse(snapshot);
  };

  const setStatus = (next: DuetConnectionStatus) => {
    if (status === next) return;
    status = next;
    for (const listener of statusListeners) listener(status);
  };

  const markReady = () => {
    if (ready) return;
    ready = true;
    for (const listener of readyListeners) listener(true);
  };

  const trySeed = () => {
    if (!synced || !pendingSeed || ready) return;
    if (!owner || roomHasHistory(doc)) {
      pendingSeed = null;
      markReady();
      return;
    }
    if (seedInFlight) return;
    const ws = provider.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const seed = pendingSeed;
    seedInFlight = true;
    ws.send(
      encodeSeedRequest(
        createSeedUpdate({
          schema: seed.schema,
          content: seed.content,
          title: seed.title,
        })
      )
    );
  };

  onSeedResponse = (snapshot) => {
    seedInFlight = false;
    Y.applyUpdate(doc, snapshot, provider);
    pendingSeed = null;
    markReady();
  };

  const onSync = (value: boolean) => {
    synced = value;
    if (!value) seedInFlight = false;
    if (value) trySeed();
  };
  const onProviderStatus = ({ status: next }: { status: string }) => {
    if (next === "connected") setStatus("connected");
    else setStatus(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "reconnecting");
  };
  const onConnectionError = () => {
    setStatus(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "reconnecting");
  };
  const onOnline = () => setStatus(provider.wsconnected ? "connected" : "reconnecting");
  const onOffline = () => setStatus("offline");

  provider.on("sync", onSync);
  provider.on("status", onProviderStatus);
  provider.on("connection-error", onConnectionError);
  if (typeof window !== "undefined") {
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
  }

  return {
    doc,
    provider,
    token,
    owner,
    ownerKey,
    get user() {
      return currentUser;
    },
    seedWhenSynced(schema, content, title) {
      if (ready) return;
      pendingSeed = { schema, content, title };
      if (!connectionStarted) {
        connectionStarted = true;
        provider.connect();
      }
      trySeed();
    },
    getContent() {
      return yXmlFragmentToProsemirrorJSON(doc.getXmlFragment(SHARED_FRAGMENT)) as JSONContent;
    },
    getTitle() {
      return doc.getMap<string>(SHARED_META).get("title") ?? null;
    },
    setTitle(title) {
      const clean = title.trim();
      if (clean) doc.getMap<string>(SHARED_META).set("title", clean.slice(0, 200));
    },
    setUser(nextUser) {
      currentUser = nextUser;
      provider.awareness.setLocalStateField("user", nextUser);
    },
    subscribeDocument(listener) {
      doc.on("update", listener);
      return () => doc.off("update", listener);
    },
    subscribeTitle(listener) {
      const meta = doc.getMap<string>(SHARED_META);
      const notify = () => listener(meta.get("title") ?? null);
      meta.observe(notify);
      notify();
      return () => meta.unobserve(notify);
    },
    subscribePresence(listener) {
      const notify = () => listener(safePresence(provider, doc.clientID));
      provider.awareness.on("change", notify);
      notify();
      return () => provider.awareness.off("change", notify);
    },
    subscribeStatus(listener) {
      statusListeners.add(listener);
      listener(status);
      return () => statusListeners.delete(listener);
    },
    subscribeReady(listener) {
      readyListeners.add(listener);
      listener(ready);
      return () => readyListeners.delete(listener);
    },
    localBackupFailed() {
      return backupFailed;
    },
    destroy() {
      provider.off("sync", onSync);
      provider.off("status", onProviderStatus);
      provider.off("connection-error", onConnectionError);
      if (typeof window !== "undefined") {
        window.removeEventListener("online", onOnline);
        window.removeEventListener("offline", onOffline);
      }
      provider.awareness.setLocalState(null);
      provider.destroy();
      doc.off("update", persistLocalDocument);
      doc.destroy();
    },
  };
}

export async function revokeDuetRoom(
  record: DuetShareRecord,
  session?: DuetSession
): Promise<void> {
  const response = await fetch(`${httpServerUrl()}/${record.token}/revoke`, {
    method: "POST",
    headers: { "x-duet-owner": record.ownerKey },
  });
  if (!response.ok) {
    throw new Error(
      response.status === 403
        ? "This device no longer has permission to stop that sharing link."
        : "The sharing link could not be stopped. Check your connection and try again."
    );
  }
  const snapshot = new Uint8Array(await response.arrayBuffer());
  if (session && snapshot.length > 0) {
    Y.applyUpdate(session.doc, snapshot, "duet-revoke-final-snapshot");
  }
}
