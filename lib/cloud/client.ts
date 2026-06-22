// Talks to the LESS API (Cloudflare Pages Function + D1) that replaced Supabase.
// The app stays local-first: if there is no Google client id configured, or the
// user is signed out, these calls simply no-op and LESS runs local-only.

export interface CloudUser {
  id: string;
  email?: string | null;
  name?: string | null;
}

const TOKEN_KEY = "less:session";
const USER_KEY = "less:user";

/**
 * Sync is part of the app now (the API ships with it), so it is always offered.
 * The sync-code login needs no configuration; Google login activates when a
 * client id is set. Under `next dev` the API isn't running, so calls just fail
 * softly and LESS stays local-only there.
 */
export const isCloudConfigured = true;

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getStoredUser(): CloudUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as CloudUser) : null;
  } catch {
    return null;
  }
}

export function setSession(token: string, user: CloudUser): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
    window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* ignore */
  }
  notifyAuth();
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
  notifyAuth();
}

/* Tiny pub/sub so useAuth re-renders on sign-in / sign-out. */
const listeners = new Set<() => void>();
export function onAuthChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notifyAuth() {
  for (const fn of listeners) fn();
}

/**
 * Fetch a JSON endpoint with the session token attached. Returns null when not
 * signed in (so callers degrade to local-only). Throws on real server errors so
 * the existing sync code can log and retry, exactly as it did with Supabase.
 */
export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown } = {}
): Promise<T | null> {
  const token = getToken();
  if (!token) return null;
  const res = await fetch(`/api/${path}`, {
    method: opts.method ?? "GET",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) {
    clearSession();
    return null;
  }
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(detail.error || `Request failed (${res.status})`);
  }
  if (res.status === 204) return null;
  return (await res.json()) as T;
}
