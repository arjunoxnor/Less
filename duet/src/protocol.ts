import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_QUERY_AWARENESS = 3;
export const SNAPSHOT_KEY = "document";

export interface SnapshotStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
}

export interface ProtocolResult {
  reply?: Uint8Array;
  followUp?: Uint8Array;
  relay?: Uint8Array;
  documentChanged: boolean;
  awareness?: AwarenessEntry[];
}

export interface AwarenessEntry {
  clientId: number;
  clock: number;
  present: boolean;
}

function asBytes(message: ArrayBuffer | Uint8Array): Uint8Array {
  return message instanceof Uint8Array ? message : new Uint8Array(message);
}

/**
 * Apply one y-websocket frame to the room document. Keeping this independent
 * from Durable Object state lets protocol behavior be tested without a Worker.
 */
export function handleProtocolMessage(
  doc: Y.Doc,
  message: ArrayBuffer | Uint8Array
): ProtocolResult {
  const bytes = asBytes(message);
  const decoder = decoding.createDecoder(bytes);
  const messageType = decoding.readVarUint(decoder);

  if (messageType === MESSAGE_SYNC) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    const syncType = syncProtocol.readSyncMessage(decoder, encoder, doc, null);
    const reply = encoding.length(encoder) > 1 ? encoding.toUint8Array(encoder) : undefined;
    const documentChanged =
      syncType === syncProtocol.messageYjsSyncStep2 ||
      syncType === syncProtocol.messageYjsUpdate;
    return {
      reply,
      // Step 2 brings the client up to date. The server's step 1 then asks for
      // updates the client made while offline, so reconnection merges both ways.
      followUp:
        syncType === syncProtocol.messageYjsSyncStep1 ? encodeSyncStep1(doc) : undefined,
      relay: documentChanged ? bytes : undefined,
      documentChanged,
    };
  }

  if (messageType === MESSAGE_AWARENESS) {
    const update = decoding.readVarUint8Array(decoder);
    return {
      relay: bytes,
      documentChanged: false,
      awareness: decodeAwarenessEntries(update),
    };
  }

  if (messageType === MESSAGE_QUERY_AWARENESS) {
    return { relay: bytes, documentChanged: false };
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

export function decodeAwarenessEntries(update: Uint8Array): AwarenessEntry[] {
  const decoder = decoding.createDecoder(update);
  const count = decoding.readVarUint(decoder);
  const entries: AwarenessEntry[] = [];
  for (let index = 0; index < count; index++) {
    const clientId = decoding.readVarUint(decoder);
    const clock = decoding.readVarUint(decoder);
    const state = JSON.parse(decoding.readVarString(decoder)) as unknown;
    entries.push({ clientId, clock, present: state !== null });
  }
  return entries;
}

export function awarenessRemovalMessage(entries: AwarenessEntry[]): Uint8Array | null {
  const present = entries.filter((entry) => entry.present);
  if (present.length === 0) return null;

  const update = encoding.createEncoder();
  encoding.writeVarUint(update, present.length);
  for (const entry of present) {
    encoding.writeVarUint(update, entry.clientId);
    encoding.writeVarUint(update, entry.clock);
    encoding.writeVarString(update, "null");
  }

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
