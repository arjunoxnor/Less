import { DurableObject } from "cloudflare:workers";
import {
  DocumentTooLargeError,
  SNAPSHOT_KEY,
  awarenessRemovalMessage,
  encodeSnapshot,
  handleProtocolMessage,
  PersistedDocument,
  queryAwarenessMessage,
  roomHasHistory,
  type AwarenessEntry,
} from "./protocol";
import {
  IDLE_ROOM_TTL_MS,
  MAX_ROOM_CONNECTIONS,
  MESSAGE_BURST,
  MESSAGE_BYTE_BURST,
  MESSAGE_BYTE_REFILL_PER_SECOND,
  MESSAGE_REFILL_PER_SECOND,
  QUERY_AWARENESS_BURST,
  QUERY_AWARENESS_REFILL_PER_SECOND,
  RATE_STATE_KEY,
  REVOKED_ROOM_TTL_MS,
  TOKEN_PATTERN,
  allowRoomCreationAttempt,
  authorizeRoom,
  checkConnectionRate,
  constantTimeEquals,
  createBucket,
  deriveRoomToken,
  newCreationGuard,
  parseClientId,
  spendTokens,
  validSessionId,
  type ConnectionRateState,
  type TokenBucket,
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

interface SocketBudget {
  messages: TokenBucket;
  bytes: TokenBucket;
  queries: TokenBucket;
}

const OWNER_KEY = "owner-key";
const REVOKED_KEY = "revoked";
const LAST_ACTIVE_KEY = "last-active";

/** Close codes the client understands. */
const CLOSE_REVOKED = 4001;
const CLOSE_FLOODING = 4003;
const CLOSE_DOCUMENT_FULL = 4009;

/**
 * Isolate-wide room-creation budget, consulted before any Durable Object is
 * addressed. This is the only guard that can run before `getByName`, which is
 * itself the act that would bill this account for a new room.
 */
const creationGuard = newCreationGuard();

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

    // Only a request carrying an owner credential can bring a new room into
    // existence, so the guard covers creation without ever standing between a
    // guest and a link that already works.
    if (route.action !== "revoke" && url.searchParams.has("owner")) {
      const ip = (request.headers.get("cf-connecting-ip") || "unknown").slice(0, 64);
      if (!allowRoomCreationAttempt(creationGuard, ip)) {
        return withCors(
          new Response("Too many sharing attempts", {
            status: 429,
            headers: { "retry-after": "60" },
          }),
          request
        );
      }
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
  // Per-socket budgets live in memory only. A socket that hibernates has been
  // idle long enough that a refilled bucket is the honest answer anyway, and a
  // socket that is flooding never gets the chance to hibernate.
  private readonly budgets = new WeakMap<WebSocket, SocketBudget>();
  private revoked: boolean | null = null;
  private revoking = false;

  private budget(socket: WebSocket): SocketBudget {
    let budget = this.budgets.get(socket);
    if (!budget) {
      budget = {
        messages: createBucket(MESSAGE_BURST),
        bytes: createBucket(MESSAGE_BYTE_BURST),
        queries: createBucket(QUERY_AWARENESS_BURST),
      };
      this.budgets.set(socket, budget);
    }
    return budget;
  }

  /** Charge one frame and its bytes before anything expensive is decoded. */
  private affordMessage(socket: WebSocket, size: number): boolean {
    const budget = this.budget(socket);
    const now = Date.now();
    if (!spendTokens(budget.messages, MESSAGE_BURST, MESSAGE_REFILL_PER_SECOND, 1, now)) {
      return false;
    }
    return spendTokens(
      budget.bytes,
      MESSAGE_BYTE_BURST,
      MESSAGE_BYTE_REFILL_PER_SECOND,
      size,
      now
    );
  }

  /**
   * Record that the room is in use and arm the expiry alarm. Without this a
   * room lived forever, holding the full text of a screenplay indefinitely.
   */
  private async touch(now = Date.now()): Promise<void> {
    await this.ctx.storage.put(LAST_ACTIVE_KEY, now);
    await this.ctx.storage.setAlarm(now + IDLE_ROOM_TTL_MS);
  }

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
        if (
          !storedOwner ||
          !suppliedOwner ||
          !constantTimeEquals(suppliedOwner, storedOwner)
        ) {
          return new Response("Not allowed", { status: 403 });
        }

        const finalSnapshot = encodeSnapshot(doc);
        await this.ctx.storage.put(REVOKED_KEY, true);
        // "Sharing stopped" has to mean the copy is gone, not just unreachable.
        // The owner is handed the last snapshot in this response and keeps the
        // screenplay locally; the Worker keeps nothing but the tombstone.
        await this.ctx.storage.delete(SNAPSHOT_KEY);
        await this.ctx.storage.delete(RATE_STATE_KEY);
        this.document.reset();
        this.revoked = true;
        this.revoking = true;
        await this.ctx.storage.put(LAST_ACTIVE_KEY, Date.now());
        await this.ctx.storage.setAlarm(Date.now() + REVOKED_ROOM_TTL_MS);
        for (const socket of this.openSockets()) {
          socket.close(CLOSE_REVOKED, "Sharing stopped");
        }
        return new Response(finalSnapshot.slice().buffer as ArrayBuffer, {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        });
      }

      if (await this.roomIsRevoked()) {
        return new Response("This sharing link has been stopped", { status: 410 });
      }

      // The owner credential still travels as a query parameter because a
      // browser WebSocket cannot set request headers, and y-websocket has no
      // hook to authorize after the upgrade without first admitting the socket.
      // Moving it would mean accepting an unauthenticated socket and promoting
      // it, which is a worse trade than a credential in the Worker's own
      // request log. Revocation, which is a plain fetch, does use a header.
      const offeredOwner = url.searchParams.get("owner");
      const storedOwner = await this.ctx.storage.get<string>(OWNER_KEY);
      const route = parseRoomPath(url.pathname);
      // Creating a room requires proving the token is the hash of the owner
      // key. Existing rooms have a stored owner and never reach this branch,
      // so their original random tokens keep working.
      const creation =
        !storedOwner && offeredOwner && TOKEN_PATTERN.test(offeredOwner) && route
          ? { token: route.token, derivedToken: await deriveRoomToken(offeredOwner) }
          : undefined;
      const authorization = authorizeRoom(storedOwner, offeredOwner, creation);
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

      // Recorded before the socket is accepted so a storage failure cannot
      // leave a live room with no expiry armed.
      await this.touch();

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
    // Charged before the message joins the document queue, so a flood cannot
    // pile up work the room is obliged to decode, apply and persist.
    const preflight = this.attachment(socket);
    if (!preflight || preflight.closed || socket.readyState !== WebSocket.OPEN) return;
    if (typeof message === "string") {
      socket.close(1003, "Binary messages required");
      return;
    }
    if (!this.affordMessage(socket, message.byteLength)) {
      socket.close(CLOSE_FLOODING, "Too many changes too quickly");
      return;
    }

    await this.document.run(async (doc) => {
      const attachment = this.attachment(socket);
      if (!attachment || attachment.closed || socket.readyState !== WebSocket.OPEN) return;
      if (await this.roomIsRevoked()) {
        socket.close(CLOSE_REVOKED, "Sharing stopped");
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

      if (
        result.kind === "query-awareness" &&
        !spendTokens(
          this.budget(socket).queries,
          QUERY_AWARENESS_BURST,
          QUERY_AWARENESS_REFILL_PER_SECOND,
          1,
          Date.now()
        )
      ) {
        // Every peer answers a query and every answer is relayed onward, so
        // this frame is quadratic. Dropping the extras costs a client nothing:
        // presence still arrives from the peers' own awareness updates.
        return;
      }

      if (result.documentChanged) {
        try {
          // The update is not replied to or relayed until durable storage has
          // accepted the complete post-transaction snapshot.
          await this.document.persist(doc);
        } catch (cause) {
          // The in-memory document now contains an update that storage did not
          // accept. Drop that instance so the last durable snapshot is reloaded.
          this.document.reset();
          if (cause instanceof DocumentTooLargeError) {
            // Nothing was stored and nothing was relayed, so every other writer
            // is still exactly in sync with the last good snapshot. Refusing
            // this one update is the whole point: accepting it and failing the
            // write afterwards is what used to destroy the room.
            socket.close(
              CLOSE_DOCUMENT_FULL,
              "This shared screenplay has reached its maximum size"
            );
            return;
          }
          // Any other storage failure could have left the room ahead of what
          // was persisted, so disconnect everyone before a sync reply can
          // expose state that would disappear after eviction.
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

  /**
   * Expire an idle room. A shared screenplay should not sit on the Worker
   * forever just because it was shared once, so a room nobody has connected to
   * for the whole window is deleted, tombstone and all.
   */
  async alarm(): Promise<void> {
    await this.document.run(async () => {
      const now = Date.now();
      const revoked = await this.roomIsRevoked();
      const ttl = revoked ? REVOKED_ROOM_TTL_MS : IDLE_ROOM_TTL_MS;
      const lastActive = (await this.ctx.storage.get<number>(LAST_ACTIVE_KEY)) ?? now;
      const expiresAt = lastActive + ttl;
      if (this.openSockets().length > 0 || now < expiresAt) {
        await this.ctx.storage.setAlarm(Math.max(expiresAt, now + 60_000));
        return;
      }
      await this.ctx.storage.deleteAll();
      this.document.reset();
      this.revoked = null;
    });
  }
}
