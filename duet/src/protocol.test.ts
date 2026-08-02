import { describe, expect, it } from "vitest";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import {
  MESSAGE_SYNC,
  SNAPSHOT_KEY,
  encodeSyncStep1,
  encodeSyncUpdate,
  handleProtocolMessage,
  loadDocument,
  saveDocument,
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

class MemoryStorage implements SnapshotStorage {
  values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }
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
});
