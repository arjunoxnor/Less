export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const SESSION_PATTERN = /^[A-Za-z0-9_-]{22}$/;
export const RATE_STATE_KEY = "connection-rate";
export const RATE_WINDOW_MS = 60_000;
export const RATE_MAX_NEW_SESSIONS = 30;
export const RATE_MAX_IPS = 256;
export const MAX_ROOM_CONNECTIONS = 128;

export type RoomAuthorization =
  | "guest"
  | "owner"
  | "issue-owner"
  | "unissued"
  | "forbidden";

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
  offeredOwner: string | null
): RoomAuthorization {
  if (!storedOwner) {
    return offeredOwner && TOKEN_PATTERN.test(offeredOwner)
      ? "issue-owner"
      : "unissued";
  }
  if (!TOKEN_PATTERN.test(storedOwner)) return "forbidden";
  if (offeredOwner === null) return "guest";
  return offeredOwner === storedOwner ? "owner" : "forbidden";
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
