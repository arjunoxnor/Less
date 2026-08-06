import { describe, expect, it } from "vitest";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import {
  MAX_MESSAGE_BYTES,
  MESSAGE_AWARENESS,
  MESSAGE_SEED,
  MESSAGE_SYNC,
  SNAPSHOT_KEY,
  PersistedDocument,
  awarenessRemovalMessage,
  encodeSyncStep1,
  encodeSyncUpdate,
  handleProtocolMessage,
  loadDocument,
  roomHasHistory,
  saveDocument,
  type ProtocolOptions,
  type SnapshotStorage,
} from "./protocol";

function applyServerFrame(doc: Y.Doc, frame: Uint8Array): void {
  const decoder = decoding.createDecoder(frame);
  expect(decoding.readVarUint(decoder)).toBe(MESSAGE_SYNC);
  syncProtocol.readSyncMessage(decoder, encoding.createEncoder(), doc, null);
}

function answerServerFrame(doc: Y.Doc, frame: Uint8Array): Uint8Array | null {
  const decoder = decoding.createDecoder(frame);
  expect(decoding.readVarUint(decoder)).toBe(MESSAGE_SYNC);
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.readSyncMessage(decoder, encoder, doc, null);
  return encoding.length(encoder) > 1 ? encoding.toUint8Array(encoder) : null;
}

function seedFrame(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SEED);
  encoding.writeVarUint8Array(encoder, update);
  return encoding.toUint8Array(encoder);
}

function seedUpdate(text: string): Uint8Array {
  const doc = new Y.Doc();
  doc.getText("script").insert(0, text);
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
}

function awarenessFrame(
  entries: Array<{ clientId: number; clock: number; state: unknown }>
): Uint8Array {
  const update = encoding.createEncoder();
  encoding.writeVarUint(update, entries.length);
  for (const entry of entries) {
    encoding.writeVarUint(update, entry.clientId);
    encoding.writeVarUint(update, entry.clock);
    encoding.writeVarString(update, JSON.stringify(entry.state));
  }
  const frame = encoding.createEncoder();
  encoding.writeVarUint(frame, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(frame, encoding.toUint8Array(update));
  return encoding.toUint8Array(frame);
}

class MemoryStorage implements SnapshotStorage {
  values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }
}

class BlockingStorage extends MemoryStorage {
  private releasePut: (() => void) | null = null;
  private putStarted: (() => void) | null = null;
  private blockFirstPut = true;
  readonly started = new Promise<void>((resolve) => {
    this.putStarted = resolve;
  });

  release(): void {
    this.releasePut?.();
  }

  override async put(key: string, value: unknown): Promise<void> {
    if (this.blockFirstPut) {
      this.blockFirstPut = false;
      this.putStarted?.();
      this.putStarted = null;
      await new Promise<void>((resolve) => {
        this.releasePut = resolve;
      });
    }
    await super.put(key, value);
  }
}

async function applyPersisted(
  persisted: PersistedDocument,
  frame: Uint8Array,
  options: ProtocolOptions = {}
) {
  return persisted.run(async (doc) => {
    const result = handleProtocolMessage(doc, frame, options);
    if (result.documentChanged) await persisted.persist(doc);
    return result;
  });
}

describe("Duet y-websocket protocol", () => {
  it("relays one client's update to another client", () => {
    const room = new Y.Doc();
    const first = new Y.Doc();
    const second = new Y.Doc();
    first.getText("script").insert(0, "Keep every word");

    const update = Y.encodeStateAsUpdate(first);
    const handled = handleProtocolMessage(room, encodeSyncUpdate(update));
    expect(handled.documentChanged).toBe(true);
    expect(handled.relay).toBeDefined();
    applyServerFrame(second, handled.relay!);

    expect(second.getText("script").toString()).toBe("Keep every word");
    expect(room.getText("script").toString()).toBe("Keep every word");
  });

  it("merges simultaneous paragraph edits once even when one frame is resent", () => {
    const room = new Y.Doc();
    room.getText("script").insert(0, "Start end");
    const baseState = Y.encodeStateVector(room);
    const first = new Y.Doc();
    const second = new Y.Doc();
    const snapshot = Y.encodeStateAsUpdate(room);
    Y.applyUpdate(first, snapshot);
    Y.applyUpdate(second, snapshot);
    first.getText("script").insert(6, "first ");
    second.getText("script").insert(6, "second ");
    const firstFrame = encodeSyncUpdate(Y.encodeStateAsUpdate(first, baseState));
    const secondFrame = encodeSyncUpdate(Y.encodeStateAsUpdate(second, baseState));

    handleProtocolMessage(room, firstFrame);
    handleProtocolMessage(room, secondFrame);
    const duplicate = handleProtocolMessage(room, firstFrame);

    const text = room.getText("script").toString();
    expect(text.match(/first /g)).toHaveLength(1);
    expect(text.match(/second /g)).toHaveLength(1);
    expect(duplicate.documentChanged).toBe(false);
  });

  it("sends the full room state to a late joiner", () => {
    const room = new Y.Doc();
    room.getText("script").insert(0, "Already here");
    const late = new Y.Doc();

    const handled = handleProtocolMessage(room, encodeSyncStep1(late));
    expect(handled.documentChanged).toBe(false);
    expect(handled.reply).toBeDefined();
    applyServerFrame(late, handled.reply!);

    expect(late.getText("script").toString()).toBe("Already here");
  });

  it("asks for and merges edits a client made while offline", () => {
    const room = new Y.Doc();
    room.getText("script").insert(0, "Room");
    const client = new Y.Doc();
    Y.applyUpdate(client, Y.encodeStateAsUpdate(room));
    client.getText("script").insert(4, " plus offline");

    const reconnect = handleProtocolMessage(room, encodeSyncStep1(client));
    expect(reconnect.reply).toBeDefined();
    expect(reconnect.followUp).toBeDefined();
    applyServerFrame(client, reconnect.reply!);
    const clientReply = answerServerFrame(client, reconnect.followUp!);
    expect(clientReply).toBeDefined();
    handleProtocolMessage(room, clientReply!);

    expect(room.getText("script").toString()).toBe("Room plus offline");
  });

  it("round-trips a binary snapshot through storage", async () => {
    const storage = new MemoryStorage();
    const original = new Y.Doc();
    original.getText("script").insert(0, "Persist after everyone leaves");

    await saveDocument(storage, original);
    expect(storage.values.get(SNAPSHOT_KEY)).toBeInstanceOf(ArrayBuffer);
    const restored = await loadDocument(storage);

    expect(restored.getText("script").toString()).toBe(
      "Persist after everyone leaves"
    );
  });

  it("persists an accepted update before the message operation resolves", async () => {
    const storage = new MemoryStorage();
    const persisted = new PersistedDocument(storage);

    await applyPersisted(persisted, encodeSyncUpdate(seedUpdate("Durable now")));
    const restored = await loadDocument(storage);

    expect(restored.getText("script").toString()).toBe("Durable now");
  });

  it("serializes snapshots so an older delayed write cannot overwrite a newer one", async () => {
    const storage = new BlockingStorage();
    const persisted = new PersistedDocument(storage);
    const first = applyPersisted(
      persisted,
      encodeSyncUpdate(seedUpdate("first"))
    );
    await storage.started;

    let secondFinished = false;
    const second = applyPersisted(
      persisted,
      encodeSyncUpdate(seedUpdate("second"))
    ).then(() => {
      secondFinished = true;
    });
    await Promise.resolve();
    expect(secondFinished).toBe(false);

    storage.release();
    await first;
    await second;
    const restored = await loadDocument(storage);
    const text = restored.getText("script").toString();
    expect(text).toContain("first");
    expect(text).toContain("second");
  });

  it("restores the last accepted state after a Durable Object eviction", async () => {
    const storage = new MemoryStorage();
    const beforeEviction = new PersistedDocument(storage);
    await applyPersisted(
      beforeEviction,
      encodeSyncUpdate(seedUpdate("Before eviction"))
    );

    const afterEviction = new PersistedDocument(storage);
    await afterEviction.run((doc) => {
      expect(doc.getText("script").toString()).toBe("Before eviction");
    });
  });

  it("accepts only one of two simultaneous owner seeds", () => {
    const room = new Y.Doc();
    const first = handleProtocolMessage(room, seedFrame(seedUpdate("First tab")), {
      allowSeed: true,
    });
    const second = handleProtocolMessage(room, seedFrame(seedUpdate("Second tab")), {
      allowSeed: true,
    });

    expect(first.seedAccepted).toBe(true);
    expect(second.seedAccepted).toBe(false);
    expect(room.getText("script").toString()).toBe("First tab");
  });

  it("does not seed a document that was intentionally cleared", () => {
    const room = new Y.Doc();
    handleProtocolMessage(room, seedFrame(seedUpdate("Remove me")), {
      allowSeed: true,
    });
    room.getText("script").delete(0, room.getText("script").length);
    expect(roomHasHistory(room)).toBe(true);

    const reseed = handleProtocolMessage(
      room,
      seedFrame(seedUpdate("Stale local mirror")),
      { allowSeed: true }
    );
    expect(reseed.seedAccepted).toBe(false);
    expect(room.getText("script").toString()).toBe("");
  });

  it("rejects a guest seed", () => {
    expect(() =>
      handleProtocolMessage(new Y.Doc(), seedFrame(seedUpdate("Not owner")))
    ).toThrow(/owner/);
  });

  it("rejects truncated and trailing frames without changing the document", () => {
    const room = new Y.Doc();
    const truncated = Uint8Array.of(MESSAGE_SYNC, syncProtocol.messageYjsUpdate, 5, 1);
    expect(() => handleProtocolMessage(room, truncated)).toThrow();
    expect(roomHasHistory(room)).toBe(false);

    const valid = encodeSyncUpdate(seedUpdate("Valid"));
    const trailing = new Uint8Array(valid.length + 1);
    trailing.set(valid);
    trailing[trailing.length - 1] = 1;
    expect(() => handleProtocolMessage(room, trailing)).toThrow(/Trailing/);
    expect(roomHasHistory(room)).toBe(false);
  });

  it("rejects a framed but malformed Yjs update before it reaches the live room", () => {
    const room = new Y.Doc();
    const malformed = encodeSyncUpdate(Uint8Array.of(255, 255, 255, 255));

    expect(() => handleProtocolMessage(room, malformed)).toThrow();
    expect(roomHasHistory(room)).toBe(false);
  });

  it("rejects an enormous update before decoding it", () => {
    const enormous = encodeSyncUpdate(new Uint8Array(MAX_MESSAGE_BYTES));
    expect(() => handleProtocolMessage(new Y.Doc(), enormous)).toThrow(/size/);
  });

  it("binds one bounded awareness client to the socket", () => {
    const valid = handleProtocolMessage(
      new Y.Doc(),
      awarenessFrame([{ clientId: 7, clock: 1, state: { user: { name: "A" } } }]),
      { awarenessClientId: 7 }
    );
    expect(valid.awareness).toEqual({ clientId: 7, clock: 1, present: true });

    expect(() =>
      handleProtocolMessage(
        new Y.Doc(),
        awarenessFrame([{ clientId: 8, clock: 1, state: {} }]),
        { awarenessClientId: 7 }
      )
    ).toThrow(/identity/);
    expect(() =>
      handleProtocolMessage(
        new Y.Doc(),
        awarenessFrame([
          { clientId: 7, clock: 1, state: {} },
          { clientId: 8, clock: 1, state: {} },
        ]),
        { awarenessClientId: 7 }
      )
    ).toThrow(/one awareness/);
  });

  it("builds one removal entry for a disconnected awareness client", () => {
    const removal = awarenessRemovalMessage({ clientId: 9, clock: 4, present: true });
    expect(removal).not.toBeNull();
    const parsed = handleProtocolMessage(new Y.Doc(), removal!, {
      awarenessClientId: 9,
    });
    expect(parsed.awareness).toEqual({ clientId: 9, clock: 4, present: false });
  });
});
