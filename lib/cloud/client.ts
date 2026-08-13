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
export const API_TIMEOUT_MS = 20_000;

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

/**
 * Persist a session. Returns false when the browser refused to store it (private
 * mode, full quota), so the caller can report a real failure instead of a
 * sign-in that silently evaporates on the next reload.
 */
export function setSession(token: string, user: CloudUser): boolean {
  let ok = true;
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
    window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    ok = false;
  }
  // A fresh session is live again by definition.
  clearExpired();
  notifyAuth();
  return ok;
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
  // Signed out is not "expired": a fresh sign-out clears the stale banner too.
  sessionExpired = false;
  notifyAuth();
}

/* --- Session expiry -------------------------------------------------------
   When the 30-day session dies, the API answers 401. We must NOT treat that as
   a sign-out: clearing the session flips the user to null, and the sign-out
   path wipes the local copies of cloud-backed projects. Instead a module flag
   marks the session as expired, sync paths go quiet, and a banner asks the
   writer to sign in again. Local work stays untouched. */

let sessionExpired = false;

/** True after any API call has come back 401 (the stored session is dead). */
export function isSessionExpired(): boolean {
  return sessionExpired;
}

/** Reset the expiry flag (called by a successful sign-in). */
export function clearExpired(): void {
  if (!sessionExpired) return;
  sessionExpired = false;
  // Announce the restoration. Re-signing in as the SAME account keeps user.id
  // unchanged, so neither useCloudSync's reconcile key nor useProjects'
  // identity effect would notice on their own; both listen for this event and
  // re-run their reconcile so pending (dirty) work pushes without further
  // edits. Explicit sign-out (clearSession) resets the flag directly and
  // deliberately does NOT fire this.
  try {
    window.dispatchEvent(new CustomEvent("less:sessionrestored"));
  } catch {
    /* ignore */
  }
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
  opts: { method?: string; body?: unknown; keepalive?: boolean; timeoutMs?: number } = {}
): Promise<T | null> {
  const token = getToken();
  if (!token) return null;
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const request = fetch(`/api/${path}`, {
      method: opts.method ?? "GET",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      // keepalive lets a push survive the page unloading (tab close). The browser
      // caps keepalive bodies at ~64KB, so callers only set it for small payloads.
      keepalive: opts.keepalive,
      signal: controller?.signal,
    });
  const timedOut = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller?.abort();
      reject(new Error("Cloud request timed out"));
    }, opts.timeoutMs ?? API_TIMEOUT_MS);
  });
  let res: Response;
  try {
    res = await Promise.race([request, timedOut]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  if (res.status === 401) {
    // The session expired. Do NOT clear it (that would look like a sign-out
    // and trigger the local wipe of cloud-backed copies). Flag it, tell the
    // UI once, and degrade to local-only exactly like a signed-out call.
    if (!sessionExpired) {
      sessionExpired = true;
      try {
        window.dispatchEvent(new CustomEvent("less:sessionexpired"));
      } catch {
        /* ignore */
      }
    }
    return null;
  }
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(detail.error || `Request failed (${res.status})`);
  }
  if (res.status === 204) return null;
  return (await res.json()) as T;
}
