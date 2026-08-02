import type { JSONContent } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from "y-prosemirror";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

const SHARED_FRAGMENT = "default";
const SHARED_META = "duet-meta";
const SHARE_KEY_PREFIX = "less:duet:share:";
const DISPLAY_NAME_KEY = "less:duet:displayName";
const DEFAULT_SERVER_URL = "wss://less-duet.less-screenwriting.workers.dev/room";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
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

export interface SeedGuard {
  checked: boolean;
}

export type SeedResult = "seeded" | "not-owner" | "room-not-empty" | "already-checked";

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
  destroy(): void;
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
  return record;
}

export function clearProjectShare(projectId: string): void {
  storageSet(SHARE_KEY_PREFIX + projectId, null);
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
 * The guard is consumed after the first synced check, whether or not it seeds.
 * A non-empty state vector also protects an intentionally cleared document:
 * its visible fragment is empty, but its Yjs history proves the room existed.
 */
export function seedSharedDocumentOnce({
  doc,
  schema,
  content,
  title,
  owner,
  guard,
}: {
  doc: Y.Doc;
  schema: Schema;
  content: JSONContent;
  title: string;
  owner: boolean;
  guard: SeedGuard;
}): SeedResult {
  if (guard.checked) return "already-checked";
  guard.checked = true;
  if (!owner) return "not-owner";

  const fragment = doc.getXmlFragment(SHARED_FRAGMENT);
  if (fragment.length > 0 || roomHasHistory(doc)) return "room-not-empty";

  doc.transact(() => {
    prosemirrorJSONToYXmlFragment(schema, content, fragment);
    const meta = doc.getMap<string>(SHARED_META);
    meta.set("initialized", "1");
    meta.set("title", title.trim() || "Untitled screenplay");
  }, "duet-initial-seed");
  return "seeded";
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
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(serverUrl(), token, doc, {
    params: ownerKey ? { owner: ownerKey } : {},
    connect: false,
    // A revoked link must not keep syncing through a same-browser broadcast
    // channel after the Worker has closed the room.
    disableBc: true,
  });
  provider.awareness.setLocalStateField("user", user);

  const guard: SeedGuard = { checked: false };
  let pendingSeed: PendingSeed | null = null;
  let connectionStarted = false;
  let synced = provider.synced;
  let currentUser = user;
  let ready = false;
  const readyListeners = new Set<(value: boolean) => void>();
  let status: DuetConnectionStatus =
    typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "reconnecting";
  const statusListeners = new Set<(value: DuetConnectionStatus) => void>();

  const setStatus = (next: DuetConnectionStatus) => {
    if (status === next) return;
    status = next;
    for (const listener of statusListeners) listener(status);
  };

  const trySeed = () => {
    if (!synced || !pendingSeed) return;
    const seed = pendingSeed;
    pendingSeed = null;
    const result = seedSharedDocumentOnce({
      doc,
      schema: seed.schema,
      content: seed.content,
      title: seed.title,
      owner,
      guard,
    });
    const meta = doc.getMap<string>(SHARED_META);
    if (owner && result !== "seeded" && !meta.get("title")) {
      meta.set("title", seed.title.trim() || "Untitled screenplay");
    }
    ready = true;
    for (const listener of readyListeners) listener(true);
  };

  const onSync = (value: boolean) => {
    synced = value;
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
      if (guard.checked) return;
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
