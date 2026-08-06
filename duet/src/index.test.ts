import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as encoding from "lib0/encoding";
import * as Y from "yjs";
import {
  encodeSyncUpdate,
  loadDocument,
  MESSAGE_AWARENESS,
  MESSAGE_SEED,
  restoreSnapshot,
  SNAPSHOT_KEY,
} from "./protocol";
import { RATE_MAX_NEW_SESSIONS } from "./security";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class<Env> {
    protected readonly ctx: MockState;
    protected readonly env: Env;

    constructor(ctx: MockState, env: Env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

import { DuetRoom } from "./index";

const token = "t".repeat(43);
const ownerKey = "o".repeat(43);
const otherOwnerKey = "p".repeat(43);
const session = (index: number) => index.toString(36).padStart(22, "0");

class MockStorage {
  values = new Map<string, unknown>();
  failNextDocumentPut = false;

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put(key: string, value: unknown): Promise<void> {
    if (key === SNAPSHOT_KEY && this.failNextDocumentPut) {
      this.failNextDocumentPut = false;
      throw new Error("storage unavailable");
    }
    this.values.set(key, value);
  }
}

class MockSocket {
  static readonly OPEN = 1;
  readyState = MockSocket.OPEN;
  sent: Uint8Array[] = [];
  attachment: unknown = null;
  closeCode: number | null = null;
  closeReason: string | null = null;

  send(message: Uint8Array): void {
    this.sent.push(message.slice());
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3;
    this.closeCode = code ?? 1000;
    this.closeReason = reason ?? "";
  }

  serializeAttachment(value: unknown): void {
    this.attachment = value;
  }

  deserializeAttachment(): unknown {
    return this.attachment;
  }
}

class MockState {
  readonly storage = new MockStorage();
  readonly sockets: MockSocket[] = [];

  acceptWebSocket(socket: WebSocket): void {
    this.sockets.push(socket as unknown as MockSocket);
  }

  getWebSockets(): WebSocket[] {
    return this.sockets as unknown as WebSocket[];
  }

  async blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
    return callback();
  }
}

class MockResponse {
  readonly body: BodyInit | null;
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly webSocket?: WebSocket;

  constructor(body: BodyInit | null = null, init: ResponseInit = {}) {
    this.body = body;
    this.status = init.status ?? 200;
    this.statusText = init.statusText ?? "";
    this.headers = new Headers(init.headers);
    this.webSocket = (init as ResponseInit & { webSocket?: WebSocket }).webSocket;
  }
}

const OriginalResponse = globalThis.Response;
const OriginalWebSocket = globalThis.WebSocket;
const OriginalWebSocketPair = (
  globalThis as typeof globalThis & { WebSocketPair?: unknown }
).WebSocketPair;

beforeAll(() => {
  Object.defineProperty(globalThis, "Response", {
    configurable: true,
    value: MockResponse,
  });
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    value: MockSocket,
  });
  Object.defineProperty(globalThis, "WebSocketPair", {
    configurable: true,
    value: class {
      0 = new MockSocket();
      1 = new MockSocket();
    },
  });
});

afterAll(() => {
  Object.defineProperty(globalThis, "Response", {
    configurable: true,
    value: OriginalResponse,
  });
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    value: OriginalWebSocket,
  });
  Object.defineProperty(globalThis, "WebSocketPair", {
    configurable: true,
    value: OriginalWebSocketPair,
  });
});

function room(ctx = new MockState()): { room: DuetRoom; ctx: MockState } {
  return {
    room: new DuetRoom(
      ctx as unknown as DurableObjectState,
      {} as { ROOMS: DurableObjectNamespace }
    ),
    ctx,
  };
}

function requestUrl({
  owner,
  clientId,
  sessionId,
}: {
  owner?: string;
  clientId: number;
  sessionId: string;
}): string {
  const url = new URL(`https://worker.example/room/${token}`);
  if (owner) url.searchParams.set("owner", owner);
  url.searchParams.set("client", String(clientId));
  url.searchParams.set("session", sessionId);
  return url.toString();
}

function connectRequest(args: {
  owner?: string;
  clientId: number;
  sessionId: string;
}): Request {
  return new Request(requestUrl(args), {
    headers: { upgrade: "websocket", "cf-connecting-ip": "203.0.113.10" },
  });
}

function updateFrame(text: string): Uint8Array {
  const doc = new Y.Doc();
  doc.getText("script").insert(0, text);
  return encodeSyncUpdate(Y.encodeStateAsUpdate(doc));
}

function seedFrame(text: string): Uint8Array {
  const doc = new Y.Doc();
  if (text) doc.getText("script").insert(0, text);
  doc.getMap("duet-meta").set("initialized", "1");
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SEED);
  encoding.writeVarUint8Array(encoder, Y.encodeStateAsUpdate(doc));
  return encoding.toUint8Array(encoder);
}

function awarenessFrame(clientId: number, clock = 1): Uint8Array {
  const update = encoding.createEncoder();
  encoding.writeVarUint(update, 1);
  encoding.writeVarUint(update, clientId);
  encoding.writeVarUint(update, clock);
  encoding.writeVarString(update, JSON.stringify({ user: { name: "Writer" } }));
  const frame = encoding.createEncoder();
  encoding.writeVarUint(frame, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(frame, encoding.toUint8Array(update));
  return encoding.toUint8Array(frame);
}

describe("Duet Durable Object lifecycle", () => {
  it("does not create a room for an unissued, correctly-shaped token", async () => {
    const instance = room();
    const response = await instance.room.fetch(
      connectRequest({ clientId: 1, sessionId: session(1) })
    );

    expect(response.status).toBe(404);
    expect(instance.ctx.sockets).toHaveLength(0);
  });

  it("serializes first-owner issuance when two credentials race", async () => {
    const instance = room();
    const [first, second] = await Promise.all([
      instance.room.fetch(
        connectRequest({ owner: ownerKey, clientId: 1, sessionId: session(1) })
      ),
      instance.room.fetch(
        connectRequest({ owner: otherOwnerKey, clientId: 2, sessionId: session(2) })
      ),
    ]);

    expect(first.status).toBe(101);
    expect(second.status).toBe(403);
    expect(instance.ctx.storage.values.get("owner-key")).toBe(ownerKey);
  });

  it("does not admit a guest in the gap before the owner's first seed", async () => {
    const instance = room();
    await instance.room.fetch(
      connectRequest({ owner: ownerKey, clientId: 1, sessionId: session(1) })
    );
    const earlyGuest = await instance.room.fetch(
      connectRequest({ clientId: 2, sessionId: session(2) })
    );
    expect(earlyGuest.status).toBe(425);

    await instance.room.webSocketMessage(
      instance.ctx.sockets[0] as unknown as WebSocket,
      seedFrame("Owner seed").slice().buffer as ArrayBuffer
    );
    const readyGuest = await instance.room.fetch(
      connectRequest({ clientId: 2, sessionId: session(2) })
    );
    expect(readyGuest.status).toBe(101);
  });

  it("persists an update before relaying it to another writer", async () => {
    const instance = room();
    await instance.room.fetch(
      connectRequest({ owner: ownerKey, clientId: 1, sessionId: session(1) })
    );
    await instance.room.webSocketMessage(
      instance.ctx.sockets[0] as unknown as WebSocket,
      seedFrame("").slice().buffer as ArrayBuffer
    );
    await instance.room.fetch(
      connectRequest({ clientId: 2, sessionId: session(2) })
    );
    const ownerSocket = instance.ctx.sockets[0];
    const guestSocket = instance.ctx.sockets[1];
    const frame = updateFrame("Network text");

    await instance.room.webSocketMessage(
      guestSocket as unknown as WebSocket,
      frame.slice().buffer as ArrayBuffer
    );

    expect(instance.ctx.storage.values.get(SNAPSHOT_KEY)).toBeInstanceOf(ArrayBuffer);
    expect(ownerSocket.sent.at(-1)).toEqual(frame);
    const restored = await loadDocument(instance.ctx.storage);
    expect(restored.getText("script").toString()).toBe("Network text");
  });

  it("cuts off connected guests and rejects their late messages after eviction", async () => {
    const instance = room();
    await instance.room.fetch(
      connectRequest({ owner: ownerKey, clientId: 1, sessionId: session(1) })
    );
    await instance.room.webSocketMessage(
      instance.ctx.sockets[0] as unknown as WebSocket,
      seedFrame("").slice().buffer as ArrayBuffer
    );
    await instance.room.fetch(
      connectRequest({ clientId: 2, sessionId: session(2) })
    );
    const guestSocket = instance.ctx.sockets[1];

    const revoke = await instance.room.fetch(
      new Request(`https://worker.example/room/${token}/revoke`, {
        method: "POST",
        headers: { "x-duet-owner": ownerKey },
      })
    );
    expect(revoke.status).toBe(200);
    expect(guestSocket.closeCode).toBe(4001);

    guestSocket.readyState = MockSocket.OPEN;
    const evicted = room(instance.ctx).room;
    await evicted.webSocketMessage(
      guestSocket as unknown as WebSocket,
      updateFrame("Too late").slice().buffer as ArrayBuffer
    );
    expect(guestSocket.closeCode).toBe(4001);
    const finalRoom = await loadDocument(instance.ctx.storage);
    expect(finalRoom.getText("script").toString()).toBe("");

    const reconnect = await evicted.fetch(
      connectRequest({ clientId: 3, sessionId: session(3) })
    );
    expect(reconnect.status).toBe(410);
  });

  it("includes every earlier accepted update in the revocation snapshot", async () => {
    const instance = room();
    await instance.room.fetch(
      connectRequest({ owner: ownerKey, clientId: 1, sessionId: session(1) })
    );
    const socket = instance.ctx.sockets[0];
    const update = instance.room.webSocketMessage(
      socket as unknown as WebSocket,
      updateFrame("Included before revoke").slice().buffer as ArrayBuffer
    );
    const revoke = instance.room.fetch(
      new Request(`https://worker.example/room/${token}/revoke`, {
        method: "POST",
        headers: { "x-duet-owner": ownerKey },
      })
    );

    const [, response] = await Promise.all([update, revoke]);
    const snapshot = restoreSnapshot(response.body as unknown as ArrayBuffer);
    expect(snapshot.getText("script").toString()).toBe("Included before revoke");
  });

  it("does not expose an update whose durable write failed", async () => {
    const instance = room();
    await instance.room.fetch(
      connectRequest({ owner: ownerKey, clientId: 1, sessionId: session(1) })
    );
    await instance.room.webSocketMessage(
      instance.ctx.sockets[0] as unknown as WebSocket,
      seedFrame("").slice().buffer as ArrayBuffer
    );
    await instance.room.fetch(
      connectRequest({ clientId: 2, sessionId: session(2) })
    );
    const ownerSocket = instance.ctx.sockets[0];
    const guestSocket = instance.ctx.sockets[1];
    const sentBefore = ownerSocket.sent.length;
    instance.ctx.storage.failNextDocumentPut = true;

    await instance.room.webSocketMessage(
      guestSocket as unknown as WebSocket,
      updateFrame("Not durable yet").slice().buffer as ArrayBuffer
    );

    expect(ownerSocket.sent).toHaveLength(sentBefore);
    expect(ownerSocket.closeCode).toBe(1011);
    expect(guestSocket.closeCode).toBe(1011);
    const lastDurable = await loadDocument(instance.ctx.storage);
    expect(lastDurable.getText("script").toString()).toBe("");

    await instance.room.fetch(
      connectRequest({ owner: ownerKey, clientId: 3, sessionId: session(3) })
    );
    const reconnected = instance.ctx.sockets.at(-1)!;
    await instance.room.webSocketMessage(
      reconnected as unknown as WebSocket,
      updateFrame("Resent safely").slice().buffer as ArrayBuffer
    );
    const restored = await loadDocument(instance.ctx.storage);
    expect(restored.getText("script").toString()).toBe("Resent safely");
  });

  it("ignores a message delivered after that socket's close callback", async () => {
    const instance = room();
    await instance.room.fetch(
      connectRequest({ owner: ownerKey, clientId: 1, sessionId: session(1) })
    );
    const socket = instance.ctx.sockets[0];
    await instance.room.webSocketClose(
      socket as unknown as WebSocket,
      1000,
      "closed",
      true
    );

    socket.readyState = MockSocket.OPEN;
    await instance.room.webSocketMessage(
      socket as unknown as WebSocket,
      updateFrame("After close").slice().buffer as ArrayBuffer
    );
    expect(instance.ctx.storage.values.get(SNAPSHOT_KEY)).toBeUndefined();
  });

  it("closes a socket that sends awareness for another client id", async () => {
    const instance = room();
    await instance.room.fetch(
      connectRequest({ owner: ownerKey, clientId: 7, sessionId: session(7) })
    );
    const socket = instance.ctx.sockets[0];

    await instance.room.webSocketMessage(
      socket as unknown as WebSocket,
      awarenessFrame(8).slice().buffer as ArrayBuffer
    );
    expect(socket.closeCode).toBe(1003);
  });

  it("rejects a backwards awareness clock so close removal cannot leave a ghost", async () => {
    const instance = room();
    await instance.room.fetch(
      connectRequest({ owner: ownerKey, clientId: 7, sessionId: session(7) })
    );
    const socket = instance.ctx.sockets[0];
    await instance.room.webSocketMessage(
      socket as unknown as WebSocket,
      awarenessFrame(7, 10).slice().buffer as ArrayBuffer
    );
    await instance.room.webSocketMessage(
      socket as unknown as WebSocket,
      awarenessFrame(7, 9).slice().buffer as ArrayBuffer
    );

    expect(socket.closeCode).toBe(1003);
    expect(socket.attachment).not.toHaveProperty("awareness");
  });

  it("keeps the new-session rate limit across eviction but admits a known reconnect", async () => {
    const ctx = new MockState();
    for (let index = 0; index < RATE_MAX_NEW_SESSIONS; index++) {
      const instance = room(ctx).room;
      const response = await instance.fetch(
        connectRequest({
          ...(index === 0 ? { owner: ownerKey } : {}),
          clientId: index + 1,
          sessionId: session(index),
        })
      );
      expect(response.status).toBe(101);
      if (index === 0) {
        await instance.webSocketMessage(
          ctx.sockets[0] as unknown as WebSocket,
          seedFrame("").slice().buffer as ArrayBuffer
        );
      }
    }

    const denied = await room(ctx).room.fetch(
      connectRequest({ clientId: 99, sessionId: session(99) })
    );
    expect(denied.status).toBe(429);

    const reconnect = await room(ctx).room.fetch(
      connectRequest({ owner: ownerKey, clientId: 1, sessionId: session(0) })
    );
    expect(reconnect.status).toBe(101);
  });
});
