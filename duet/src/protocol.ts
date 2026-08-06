import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_QUERY_AWARENESS = 3;
export const MESSAGE_SEED = 4;
export const SNAPSHOT_KEY = "document";
export const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;
export const MAX_AWARENESS_MESSAGE_BYTES = 16 * 1024;

export interface SnapshotStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
}

export interface ProtocolOptions {
  allowSeed?: boolean;
  awarenessClientId?: number;
}

export interface ProtocolResult {
  reply?: Uint8Array;
  followUp?: Uint8Array;
  relay?: Uint8Array;
  documentChanged: boolean;
  awareness?: AwarenessEntry;
  seedAccepted?: boolean;
}

export interface AwarenessEntry {
  clientId: number;
  clock: number;
  present: boolean;
}

function asBytes(message: ArrayBuffer | Uint8Array): Uint8Array {
  return message instanceof Uint8Array ? message : new Uint8Array(message);
}

function assertFinished(decoder: decoding.Decoder): void {
  if (decoding.hasContent(decoder)) throw new Error("Trailing protocol data");
}

function validateUpdate(update: Uint8Array): void {
  const validationDoc = new Y.Doc();
  try {
    Y.applyUpdate(validationDoc, update);
  } finally {
    validationDoc.destroy();
  }
}

function applyUpdate(doc: Y.Doc, update: Uint8Array): boolean {
  let changed = false;
  const onUpdate = () => {
    changed = true;
  };
  doc.on("update", onUpdate);
  try {
    Y.applyUpdate(doc, update);
  } finally {
    doc.off("update", onUpdate);
  }
  return changed;
}

export function roomHasHistory(doc: Y.Doc): boolean {
  return Y.decodeStateVector(Y.encodeStateVector(doc)).size > 0;
}

function encodeSeedResponse(accepted: boolean, doc: Y.Doc): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SEED);
  encoding.writeVarUint(encoder, accepted ? 1 : 0);
  encoding.writeVarUint8Array(encoder, encodeSnapshot(doc));
  return encoding.toUint8Array(encoder);
}

/**
 * Apply one validated y-websocket frame to the room document. The caller must
 * serialize calls and persist a changed document before sending any result.
 */
export function handleProtocolMessage(
  doc: Y.Doc,
  message: ArrayBuffer | Uint8Array,
  options: ProtocolOptions = {}
): ProtocolResult {
  const bytes = asBytes(message);
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_MESSAGE_BYTES) {
    throw new Error("Protocol frame size is invalid");
  }

  const decoder = decoding.createDecoder(bytes);
  const messageType = decoding.readVarUint(decoder);

  if (messageType === MESSAGE_SYNC) {
    const syncType = decoding.readVarUint(decoder);
    if (syncType === syncProtocol.messageYjsSyncStep1) {
      const stateVector = decoding.readVarUint8Array(decoder);
      assertFinished(decoder);
      Y.decodeStateVector(stateVector);

      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeSyncStep2(encoder, doc, stateVector);
      return {
        reply: encoding.toUint8Array(encoder),
        // The server's step 1 asks for updates made while this client was
        // offline. A step 2 reply by itself only syncs server to client.
        followUp: encodeSyncStep1(doc),
        documentChanged: false,
      };
    }

    if (
      syncType !== syncProtocol.messageYjsSyncStep2 &&
      syncType !== syncProtocol.messageYjsUpdate
    ) {
      throw new Error("Unsupported Yjs sync message type");
    }
    const update = decoding.readVarUint8Array(decoder);
    assertFinished(decoder);
    validateUpdate(update);
    const documentChanged = applyUpdate(doc, update);
    return {
      relay: documentChanged ? bytes : undefined,
      documentChanged,
    };
  }

  if (messageType === MESSAGE_AWARENESS) {
    if (bytes.byteLength > MAX_AWARENESS_MESSAGE_BYTES) {
      throw new Error("Awareness frame is too large");
    }
    const update = decoding.readVarUint8Array(decoder);
    assertFinished(decoder);
    const awareness = decodeAwarenessEntry(update);
    if (
      options.awarenessClientId !== undefined &&
      awareness.clientId !== options.awarenessClientId
    ) {
      throw new Error("Awareness client identity does not match the socket");
    }
    return {
      relay: bytes,
      documentChanged: false,
      awareness,
    };
  }

  if (messageType === MESSAGE_QUERY_AWARENESS) {
    assertFinished(decoder);
    return { relay: bytes, documentChanged: false };
  }

  if (messageType === MESSAGE_SEED) {
    if (!options.allowSeed) throw new Error("Only an owner may seed a room");
    const update = decoding.readVarUint8Array(decoder);
    assertFinished(decoder);
    validateUpdate(update);

    if (roomHasHistory(doc)) {
      return {
        reply: encodeSeedResponse(false, doc),
        documentChanged: false,
        seedAccepted: false,
      };
    }

    const documentChanged = applyUpdate(doc, update);
    if (!documentChanged || !roomHasHistory(doc)) {
      throw new Error("A seed must create Yjs history");
    }
    return {
      reply: encodeSeedResponse(true, doc),
      relay: encodeSyncUpdate(update),
      documentChanged: true,
      seedAccepted: true,
    };
  }

  throw new Error(`Unsupported y-websocket message type: ${messageType}`);
}

export function encodeSyncUpdate(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

export function encodeSyncStep1(doc: Y.Doc): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
}

export function queryAwarenessMessage(): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_QUERY_AWARENESS);
  return encoding.toUint8Array(encoder);
}

export function decodeAwarenessEntry(update: Uint8Array): AwarenessEntry {
  const decoder = decoding.createDecoder(update);
  const count = decoding.readVarUint(decoder);
  if (count !== 1) throw new Error("Each socket may update one awareness client");

  const clientId = decoding.readVarUint(decoder);
  const clock = decoding.readVarUint(decoder);
  const state = JSON.parse(decoding.readVarString(decoder)) as unknown;
  assertFinished(decoder);
  if (state !== null && (typeof state !== "object" || Array.isArray(state))) {
    throw new Error("Awareness state must be an object or null");
  }
  return { clientId, clock, present: state !== null };
}

export function awarenessRemovalMessage(entry?: AwarenessEntry): Uint8Array | null {
  if (!entry?.present) return null;

  const update = encoding.createEncoder();
  encoding.writeVarUint(update, 1);
  encoding.writeVarUint(update, entry.clientId);
  encoding.writeVarUint(update, entry.clock);
  encoding.writeVarString(update, "null");

  const message = encoding.createEncoder();
  encoding.writeVarUint(message, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(message, encoding.toUint8Array(update));
  return encoding.toUint8Array(message);
}

export function encodeSnapshot(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}

export function restoreSnapshot(snapshot?: ArrayBuffer | Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  if (snapshot) Y.applyUpdate(doc, asBytes(snapshot));
  return doc;
}

export async function loadDocument(storage: SnapshotStorage): Promise<Y.Doc> {
  const snapshot = await storage.get<ArrayBuffer | Uint8Array>(SNAPSHOT_KEY);
  return restoreSnapshot(snapshot);
}

export async function saveDocument(storage: SnapshotStorage, doc: Y.Doc): Promise<void> {
  const snapshot = encodeSnapshot(doc);
  await storage.put(SNAPSHOT_KEY, snapshot.slice().buffer as ArrayBuffer);
}

/**
 * One queue owns document mutation and persistence. This prevents an older,
 * delayed storage write from finishing after a newer snapshot.
 */
export class PersistedDocument {
  private readonly storage: SnapshotStorage;
  private docPromise: Promise<Y.Doc> | null = null;
  private tail: Promise<void> = Promise.resolve();

  constructor(storage: SnapshotStorage) {
    this.storage = storage;
  }

  private getDocument(): Promise<Y.Doc> {
    if (!this.docPromise) this.docPromise = loadDocument(this.storage);
    return this.docPromise;
  }

  run<T>(work: (doc: Y.Doc) => Promise<T> | T): Promise<T> {
    const result = this.tail.then(async () => work(await this.getDocument()));
    this.tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  persist(doc: Y.Doc): Promise<void> {
    return saveDocument(this.storage, doc);
  }

  reset(): void {
    this.docPromise = null;
  }
}
