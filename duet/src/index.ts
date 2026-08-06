import { DurableObject } from "cloudflare:workers";
import {
  awarenessRemovalMessage,
  encodeSnapshot,
  handleProtocolMessage,
  PersistedDocument,
  queryAwarenessMessage,
  roomHasHistory,
  type AwarenessEntry,
} from "./protocol";
import {
  MAX_ROOM_CONNECTIONS,
  RATE_STATE_KEY,
  TOKEN_PATTERN,
  authorizeRoom,
  checkConnectionRate,
  parseClientId,
  validSessionId,
  type ConnectionRateState,
} from "./security";

interface Env {
  ROOMS: DurableObjectNamespace;
}

interface SocketAttachment {
  clientId: number;
  sessionId: string;
  owner: boolean;
  closed?: boolean;
}

const OWNER_KEY = "owner-key";
const REVOKED_KEY = "revoked";

function parseRoomPath(pathname: string): { token: string; action?: "revoke" } | null {
  const match = pathname.match(/^\/room\/([^/]+)(?:\/(revoke))?$/);
  if (!match || !TOKEN_PATTERN.test(match[1])) return null;
  return { token: match[1], action: match[2] as "revoke" | undefined };
}

function allowedOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  if (origin === "https://less.oxnorhub.com") return origin;
  try {
    const url = new URL(origin);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return origin;
  } catch {
    return null;
  }
  return null;
}

function withCors(response: Response, request: Request): Response {
  const origin = allowedOrigin(request);
  if (!origin) return response;
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("vary", "Origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const route = parseRoomPath(url.pathname);
    if (!route) return new Response("Not found", { status: 404 });

    if (request.method === "OPTIONS") {
      return withCors(
        new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-methods": "GET, POST, OPTIONS",
            "access-control-allow-headers": "content-type, x-duet-owner",
            "access-control-max-age": "86400",
          },
        }),
        request
      );
    }

    const stub = env.ROOMS.getByName(route.token);
    if (route.action === "revoke") {
      if (request.method !== "POST") {
        return withCors(new Response("Method not allowed", { status: 405 }), request);
      }
      return withCors(await stub.fetch(request), request);
    }

    if (
      request.method !== "GET" ||
      request.headers.get("upgrade")?.toLowerCase() !== "websocket"
    ) {
      return new Response("WebSocket upgrade required", { status: 426 });
    }
    return stub.fetch(request);
  },
};

export class DuetRoom extends DurableObject<Env> {
  private readonly document = new PersistedDocument(this.ctx.storage);
  private readonly awareness = new WeakMap<WebSocket, AwarenessEntry>();
  private revoked: boolean | null = null;
  private revoking = false;

  private openSockets(): WebSocket[] {
    return this.ctx.getWebSockets().filter((socket) => socket.readyState === WebSocket.OPEN);
  }

  private relay(message: Uint8Array, except?: WebSocket): void {
    for (const socket of this.openSockets()) {
      if (socket === except) continue;
      try {
        socket.send(message);
      } catch {
        // The client retains its Yjs update and will resend after reconnecting.
      }
    }
  }

  private async roomIsRevoked(): Promise<boolean> {
    if (this.revoking) return true;
    if (this.revoked === null) {
      this.revoked = (await this.ctx.storage.get<boolean>(REVOKED_KEY)) === true;
    }
    return this.revoked;
  }

  private attachment(socket: WebSocket): SocketAttachment | null {
    return socket.deserializeAttachment() as SocketAttachment | null;
  }

  private closeSocket(socket: WebSocket): void {
    const attachment = this.attachment(socket);
    if (!attachment || attachment.closed) return;
    socket.serializeAttachment({ ...attachment, closed: true } satisfies SocketAttachment);
    const removal = awarenessRemovalMessage(this.awareness.get(socket));
    this.awareness.delete(socket);
    if (removal) this.relay(removal, socket);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    return this.document.run(async (doc) => {
      if (url.pathname.endsWith("/revoke")) {
        const storedOwner = await this.ctx.storage.get<string>(OWNER_KEY);
        const suppliedOwner = request.headers.get("x-duet-owner");
        if (!storedOwner || !suppliedOwner || suppliedOwner !== storedOwner) {
          return new Response("Not allowed", { status: 403 });
        }

        const finalSnapshot = encodeSnapshot(doc);
        await this.ctx.storage.put(REVOKED_KEY, true);
        this.revoked = true;
        this.revoking = true;
        for (const socket of this.openSockets()) {
          socket.close(4001, "Sharing stopped");
        }
        return new Response(finalSnapshot.slice().buffer as ArrayBuffer, {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        });
      }

      if (await this.roomIsRevoked()) {
        return new Response("This sharing link has been stopped", { status: 410 });
      }

      const offeredOwner = url.searchParams.get("owner");
      const storedOwner = await this.ctx.storage.get<string>(OWNER_KEY);
      const authorization = authorizeRoom(storedOwner, offeredOwner);
      if (authorization === "unissued") {
        return new Response("This sharing link does not exist", { status: 404 });
      }
      if (authorization === "forbidden") {
        return new Response("Not allowed", { status: 403 });
      }
      const clientId = parseClientId(url.searchParams.get("client"));
      const sessionId = url.searchParams.get("session");
      if (clientId === null || !validSessionId(sessionId)) {
        return new Response("Invalid client identity", { status: 400 });
      }
      if (authorization === "issue-owner") {
        await this.ctx.storage.put(OWNER_KEY, offeredOwner!);
      }
      const isOwner = authorization === "owner" || authorization === "issue-owner";
      if (!isOwner && !roomHasHistory(doc)) {
        return new Response("This sharing room is still initializing", {
          status: 425,
          headers: { "retry-after": "1" },
        });
      }

      const ip = (request.headers.get("cf-connecting-ip") || "unknown").slice(0, 64);
      const rateState = await this.ctx.storage.get<ConnectionRateState>(RATE_STATE_KEY);
      const rate = checkConnectionRate(rateState, ip, sessionId, clientId);
      await this.ctx.storage.put(RATE_STATE_KEY, rate.state);
      if (!rate.allowed) {
        return new Response("Too many connection attempts", {
          status: 429,
          headers: { "retry-after": "60" },
        });
      }

      const duplicateSession = this.openSockets().find(
        (socket) => this.attachment(socket)?.sessionId === sessionId
      );
      if (duplicateSession) duplicateSession.close(4002, "Reconnected elsewhere");

      const peers = this.openSockets();
      if (peers.length >= MAX_ROOM_CONNECTIONS) {
        return new Response("This room has too many connected writers", { status: 503 });
      }
      if (peers.some((socket) => this.attachment(socket)?.clientId === clientId)) {
        return new Response("Yjs client identity is already connected", { status: 409 });
      }

      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      server.serializeAttachment({
        clientId,
        sessionId,
        owner: isOwner,
      } satisfies SocketAttachment);
      this.ctx.acceptWebSocket(server);

      // Each peer's overridden query handler returns only its local state. The
      // Worker rejects a response that claims any other Yjs client id.
      const query = queryAwarenessMessage();
      for (const peer of peers) {
        try {
          peer.send(query);
        } catch {
          // A closing peer will remove its own presence in the close callback.
        }
      }

      return new Response(null, {
        status: 101,
        webSocket: client,
      } as ResponseInit);
    });
  }

  async webSocketMessage(socket: WebSocket, message: ArrayBuffer | string): Promise<void> {
    await this.document.run(async (doc) => {
      const attachment = this.attachment(socket);
      if (!attachment || attachment.closed || socket.readyState !== WebSocket.OPEN) return;
      if (await this.roomIsRevoked()) {
        socket.close(4001, "Sharing stopped");
        return;
      }
      if (typeof message === "string") {
        socket.close(1003, "Binary messages required");
        return;
      }

      let result;
      try {
        result = handleProtocolMessage(doc, message, {
          allowSeed: attachment.owner,
          awarenessClientId: attachment.clientId,
        });
        if (
          result.awareness &&
          this.awareness.has(socket) &&
          result.awareness.clock < this.awareness.get(socket)!.clock
        ) {
          throw new Error("Awareness clocks must not move backwards");
        }
      } catch {
        socket.close(1003, "Invalid y-websocket message");
        return;
      }

      if (result.documentChanged) {
        try {
          // The update is not replied to or relayed until durable storage has
          // accepted the complete post-transaction snapshot.
          await this.document.persist(doc);
        } catch {
          // The in-memory document now contains an update that storage did not
          // accept. Drop that instance and disconnect everyone before any sync
          // reply can expose state that would disappear after eviction.
          this.document.reset();
          for (const peer of this.openSockets()) {
            peer.close(1011, "The shared document could not be persisted");
          }
          return;
        }
      }

      if (result.awareness) {
        this.awareness.set(socket, result.awareness);
      }
      try {
        if (result.reply) socket.send(result.reply);
        if (result.followUp) socket.send(result.followUp);
      } catch {
        return;
      }
      if (result.relay) this.relay(result.relay, socket);
    });
  }

  async webSocketClose(
    socket: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean
  ): Promise<void> {
    await this.document.run(() => this.closeSocket(socket));
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.document.run(() => this.closeSocket(socket));
  }
}
