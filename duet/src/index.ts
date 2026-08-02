import { DurableObject } from "cloudflare:workers";
import {
  awarenessRemovalMessage,
  encodeSnapshot,
  handleProtocolMessage,
  loadDocument,
  queryAwarenessMessage,
  saveDocument,
  type AwarenessEntry,
} from "./protocol";
import type * as Y from "yjs";

interface Env {
  ROOMS: DurableObjectNamespace;
}

interface SocketAttachment {
  awareness: AwarenessEntry[];
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_CONNECTIONS = 30;
const SNAPSHOT_DEBOUNCE_MS = 2_000;
const OWNER_KEY = "owner-key";
const REVOKED_KEY = "revoked";

const connectionAttempts = new Map<string, number[]>();

function allowConnection(ip: string, now = Date.now()): boolean {
  const cutoff = now - RATE_WINDOW_MS;
  const recent = (connectionAttempts.get(ip) ?? []).filter((at) => at > cutoff);
  if (recent.length >= RATE_MAX_CONNECTIONS) {
    connectionAttempts.set(ip, recent);
    return false;
  }
  recent.push(now);
  connectionAttempts.set(ip, recent);
  return true;
}

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

    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
    if (!allowConnection(ip)) {
      return withCors(
        new Response("Too many connection attempts", {
          status: 429,
          headers: { "retry-after": "60" },
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
  private docPromise: Promise<Y.Doc> | null = null;
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  private changeVersion = 0;
  private persistedVersion = 0;
  private revoking = false;

  private getDocument(): Promise<Y.Doc> {
    if (!this.docPromise) this.docPromise = loadDocument(this.ctx.storage);
    return this.docPromise;
  }

  private openSockets(): WebSocket[] {
    return this.ctx.getWebSockets().filter((socket) => socket.readyState === 1);
  }

  private relay(message: Uint8Array, except?: WebSocket): void {
    for (const socket of this.openSockets()) {
      if (socket === except) continue;
      try {
        socket.send(message);
      } catch {
        // A close event will perform the final persistence check.
      }
    }
  }

  private scheduleSnapshot(): void {
    if (this.snapshotTimer) return;
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null;
      void this.flushSnapshot();
    }, SNAPSHOT_DEBOUNCE_MS);
  }

  private markDocumentChanged(): void {
    this.changeVersion++;
    this.scheduleSnapshot();
  }

  private async flushSnapshot(): Promise<void> {
    if (this.persistedVersion === this.changeVersion) return;
    const version = this.changeVersion;
    const doc = await this.getDocument();
    await saveDocument(this.ctx.storage, doc);
    this.persistedVersion = version;
    if (this.persistedVersion !== this.changeVersion) this.scheduleSnapshot();
  }

  private async closeSocket(socket: WebSocket): Promise<void> {
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    const removal = awarenessRemovalMessage(attachment?.awareness ?? []);
    if (removal) this.relay(removal, socket);
    if (this.openSockets().filter((peer) => peer !== socket).length === 0) {
      if (this.snapshotTimer) {
        clearTimeout(this.snapshotTimer);
        this.snapshotTimer = null;
      }
      await this.flushSnapshot();
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/revoke")) {
      const storedOwner = await this.ctx.storage.get<string>(OWNER_KEY);
      const suppliedOwner = request.headers.get("x-duet-owner");
      if (!storedOwner || !suppliedOwner || suppliedOwner !== storedOwner) {
        return new Response("Not allowed", { status: 403 });
      }
      const snapshot = await this.ctx.blockConcurrencyWhile(async () => {
        this.revoking = true;
        await this.flushSnapshot();
        const doc = await this.getDocument();
        const finalSnapshot = encodeSnapshot(doc);
        await this.ctx.storage.put(REVOKED_KEY, true);
        for (const socket of this.openSockets()) {
          socket.close(4001, "Sharing stopped");
        }
        return finalSnapshot;
      });
      return new Response(snapshot.slice().buffer as ArrayBuffer, {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      });
    }

    if (await this.ctx.storage.get<boolean>(REVOKED_KEY)) {
      return new Response("This sharing link has been stopped", { status: 410 });
    }

    const offeredOwner = url.searchParams.get("owner");
    const storedOwner = await this.ctx.storage.get<string>(OWNER_KEY);
    if (!storedOwner && offeredOwner && TOKEN_PATTERN.test(offeredOwner)) {
      await this.ctx.storage.put(OWNER_KEY, offeredOwner);
    }

    await this.getDocument();
    const peers = this.openSockets();
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.serializeAttachment({ awareness: [] } satisfies SocketAttachment);
    this.ctx.acceptWebSocket(server);

    // Existing peers answer this standard y-websocket query with their current
    // awareness, which is then relayed to the newcomer without persisting it.
    const query = queryAwarenessMessage();
    for (const peer of peers) peer.send(query);

    return new Response(null, {
      status: 101,
      webSocket: client,
    } as ResponseInit);
  }

  async webSocketMessage(socket: WebSocket, message: ArrayBuffer | string): Promise<void> {
    if (this.revoking) {
      socket.close(4001, "Sharing stopped");
      return;
    }
    if (typeof message === "string") {
      socket.close(1003, "Binary messages required");
      return;
    }

    try {
      const doc = await this.getDocument();
      const result = handleProtocolMessage(doc, message);
      if (result.reply) socket.send(result.reply);
      if (result.followUp) socket.send(result.followUp);
      if (result.relay) this.relay(result.relay, socket);
      if (result.awareness) {
        const previous =
          (socket.deserializeAttachment() as SocketAttachment | null)?.awareness ?? [];
        const byClient = new Map(previous.map((entry) => [entry.clientId, entry]));
        for (const entry of result.awareness) {
          if (entry.present) byClient.set(entry.clientId, entry);
          else byClient.delete(entry.clientId);
        }
        socket.serializeAttachment({ awareness: [...byClient.values()] } satisfies SocketAttachment);
      }
      if (result.documentChanged) this.markDocumentChanged();
    } catch {
      socket.close(1003, "Invalid y-websocket message");
    }
  }

  async webSocketClose(
    socket: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean
  ): Promise<void> {
    await this.closeSocket(socket);
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.closeSocket(socket);
  }
}
