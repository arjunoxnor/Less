export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const SESSION_PATTERN = /^[A-Za-z0-9_-]{22}$/;
export const RATE_STATE_KEY = "connection-rate";
export const RATE_WINDOW_MS = 60_000;
export const RATE_MAX_NEW_SESSIONS = 30;
export const RATE_MAX_IPS = 256;
export const MAX_ROOM_CONNECTIONS = 128;

/**
 * Room creation guard. This lives in the Worker isolate, so it is consulted
 * before any Durable Object is addressed. It is deliberately best effort: an
 * attacker spread across isolates gets a higher effective ceiling, but a single
 * script can no longer mint rooms as fast as it can open sockets.
 */
export const CREATION_WINDOW_MS = 60_000;
export const CREATION_MAX_PER_IP = 20;
export const CREATION_MAX_GLOBAL = 200;
export const CREATION_MAX_TRACKED_IPS = 1024;

/**
 * Per-socket message budgets. A writer types a few small updates a second; a
 * hostile client tries to pin the Durable Object's CPU and force a full
 * snapshot write per frame. Both a frame budget and a byte budget are charged.
 */
export const MESSAGE_BURST = 240;
export const MESSAGE_REFILL_PER_SECOND = 25;
export const MESSAGE_BYTE_BURST = 4 * 1024 * 1024;
export const MESSAGE_BYTE_REFILL_PER_SECOND = 256 * 1024;

/**
 * A query-awareness frame is answered by every peer and each answer is relayed
 * to every other peer, so one frame costs O(peers^2) sends. A well behaved
 * client sends one per connection.
 */
export const QUERY_AWARENESS_BURST = 4;
export const QUERY_AWARENESS_REFILL_PER_SECOND = 1 / 15;

/**
 * Rooms do not live forever. A room nobody has connected to for this long is
 * deleted outright, and a revoked room keeps only its tombstone for long
 * enough that a stale link still explains itself.
 */
export const IDLE_ROOM_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const REVOKED_ROOM_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type RoomAuthorization =
  | "guest"
  | "owner"
  | "issue-owner"
  | "unissued"
  | "forbidden";

const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/**
 * A room token is the SHA-256 of its owner key. Only a client that generated
 * the owner key can name a room the Worker will agree to create, so the Worker
 * is no longer an open durable store: an attacker cannot pick a token out of
 * thin air and claim it. The owner key stays secret; the token is public.
 *
 * This is the same derivation as `deriveRoomToken` in lib/collab/duet.ts, and
 * lib/collab/duet.test.ts asserts the two agree.
 */
export async function deriveRoomToken(ownerKey: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(ownerKey));
  return base64Url(new Uint8Array(digest));
}

/**
 * Compare two secrets without an early exit. Only the lengths leak, and both
 * credentials are fixed length by the time this is reached.
 */
export function constantTimeEquals(left: string, right: string): boolean {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

export interface RoomCreation {
  /** The token from the request path. */
  token: string;
  /** base64url(sha256(offeredOwner)), or null when it was not computed. */
  derivedToken: string | null;
}

export interface CreationGuardState {
  windowStart: number;
  total: number;
  ips: Map<string, number>;
}

export function newCreationGuard(now = Date.now()): CreationGuardState {
  return { windowStart: now, total: 0, ips: new Map() };
}

/**
 * Charge one room-creation attempt against the isolate-wide budget. Guests
 * never reach this: only a request that carries an owner credential can create
 * a room, so a full room stays reachable however busy the guard is.
 */
export function allowRoomCreationAttempt(
  state: CreationGuardState,
  ip: string,
  now = Date.now()
): boolean {
  if (now - state.windowStart >= CREATION_WINDOW_MS || now < state.windowStart) {
    state.windowStart = now;
    state.total = 0;
    state.ips.clear();
  }
  if (state.total >= CREATION_MAX_GLOBAL) return false;
  const used = state.ips.get(ip);
  if (used === undefined && state.ips.size >= CREATION_MAX_TRACKED_IPS) return false;
  if ((used ?? 0) >= CREATION_MAX_PER_IP) return false;
  state.total += 1;
  state.ips.set(ip, (used ?? 0) + 1);
  return true;
}

export interface TokenBucket {
  tokens: number;
  updated: number;
}

export function createBucket(capacity: number, now = Date.now()): TokenBucket {
  return { tokens: capacity, updated: now };
}

/**
 * Refill by elapsed time, then charge `cost`. Returns false and charges
 * nothing when the bucket cannot cover the cost.
 */
export function spendTokens(
  bucket: TokenBucket,
  capacity: number,
  refillPerSecond: number,
  cost: number,
  now = Date.now()
): boolean {
  const elapsed = Math.max(0, now - bucket.updated) / 1000;
  bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillPerSecond);
  bucket.updated = now;
  if (bucket.tokens < cost) return false;
  bucket.tokens -= cost;
  return true;
}

export interface RateSession {
  id: string;
  clientId: number;
  lastSeen: number;
}

export interface RateClient {
  ip: string;
  attempts: number[];
  sessions: RateSession[];
  lastSeen: number;
}

export interface ConnectionRateState {
  clients: RateClient[];
}

export interface RateDecision {
  allowed: boolean;
  state: ConnectionRateState;
  reason?: "rate" | "session-client-mismatch";
}

export function authorizeRoom(
  storedOwner: string | undefined,
  offeredOwner: string | null,
  creation?: RoomCreation
): RoomAuthorization {
  if (!storedOwner) {
    // A room with no stored owner does not exist yet. Creating it requires
    // proving the token was derived from the offered owner key, which only the
    // client that generated the pair can do. Everything else looks like a
    // request for a link that was never issued.
    if (!offeredOwner || !TOKEN_PATTERN.test(offeredOwner)) return "unissued";
    if (!creation || creation.derivedToken === null) return "unissued";
    return constantTimeEquals(creation.derivedToken, creation.token)
      ? "issue-owner"
      : "unissued";
  }
  // Rooms issued before token derivation keep their stored owner and their
  // original random token. Only creation is gated, so they are unaffected.
  if (!TOKEN_PATTERN.test(storedOwner)) return "forbidden";
  if (offeredOwner === null) return "guest";
  return constantTimeEquals(offeredOwner, storedOwner) ? "owner" : "forbidden";
}

export function parseClientId(value: string | null): number | null {
  if (!value || !/^(0|[1-9][0-9]{0,9})$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 0xffffffff
    ? parsed
    : null;
}

export function validSessionId(value: string | null): value is string {
  return value !== null && SESSION_PATTERN.test(value);
}

function validRateSession(value: RateSession, cutoff: number): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    SESSION_PATTERN.test(value.id) &&
    Number.isInteger(value.clientId) &&
    value.clientId >= 0 &&
    value.clientId <= 0xffffffff &&
    Number.isFinite(value.lastSeen) &&
    value.lastSeen > cutoff
  );
}

function normalizeClient(value: RateClient, cutoff: number): RateClient | null {
  if (
    value === null ||
    typeof value !== "object" ||
    typeof value.ip !== "string" ||
    value.ip.length === 0 ||
    value.ip.length > 64 ||
    !Number.isFinite(value.lastSeen) ||
    value.lastSeen <= cutoff
  ) {
    return null;
  }
  const attempts = Array.isArray(value.attempts)
    ? value.attempts.filter((at) => Number.isFinite(at) && at > cutoff)
    : [];
  const sessions = Array.isArray(value.sessions)
    ? value.sessions.filter((session) => validRateSession(session, cutoff))
    : [];
  return { ip: value.ip, attempts, sessions, lastSeen: value.lastSeen };
}

/**
 * Count new client sessions in Durable Object storage. A known session can
 * reconnect during a full window without consuming another attempt.
 */
export function checkConnectionRate(
  previous: ConnectionRateState | undefined,
  ip: string,
  sessionId: string,
  clientId: number,
  now = Date.now()
): RateDecision {
  const cutoff = now - RATE_WINDOW_MS;
  const clients = (Array.isArray(previous?.clients) ? previous.clients : [])
    .map((client) => normalizeClient(client, cutoff))
    .filter((client): client is RateClient => client !== null)
    .slice(0, RATE_MAX_IPS);
  let client = clients.find((entry) => entry.ip === ip);

  if (!client) {
    if (clients.length >= RATE_MAX_IPS) {
      return { allowed: false, state: { clients }, reason: "rate" };
    }
    client = { ip, attempts: [], sessions: [], lastSeen: now };
    clients.push(client);
  }

  const known = client.sessions.find((session) => session.id === sessionId);
  client.lastSeen = now;
  if (known) {
    if (known.clientId !== clientId) {
      return {
        allowed: false,
        state: { clients },
        reason: "session-client-mismatch",
      };
    }
    known.lastSeen = now;
    return { allowed: true, state: { clients } };
  }

  if (client.attempts.length >= RATE_MAX_NEW_SESSIONS) {
    return { allowed: false, state: { clients }, reason: "rate" };
  }

  client.attempts.push(now);
  client.sessions.push({ id: sessionId, clientId, lastSeen: now });
  return { allowed: true, state: { clients } };
}
