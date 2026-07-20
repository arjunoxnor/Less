import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  api,
  setSession,
  clearSession,
  getToken,
  getStoredUser,
  isSessionExpired,
} from "./client";

/**
 * The B4 session-expiry flag (Part 3.1: "reconcile must not run while
 * expired"). When the 30-day session dies the API answers 401. That must NOT
 * be treated as a sign-out: clearSession would flip the user to null, and the
 * sign-out path in useProjects wipes the local copies of cloud-backed
 * projects. These tests pin the flag mechanics that the sync engines gate on
 * (useCloudSync and useProjects both check isSessionExpired() / listen for
 * the events asserted here). The full browser-level flow (banner shown, rows
 * persist, re-auth resumes sync) is the Part 3.2 session-expiry E2E, deferred
 * with the Playwright harness to Phase 5 task 16.
 */

const USER = { id: "u1", email: "a@b.c", name: "A" };

// The vitest jsdom environment exposes node 22's stub localStorage (whose
// methods throw without --localstorage-file), so install a real in-memory one.
const store = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
});

/** A minimal fetch stub; api() only reads status / ok / json. */
const respond = (status: number, body: unknown = {}) =>
  vi.fn(async () => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  })) as unknown as typeof fetch;

beforeEach(() => {
  store.clear();
  // clearSession also resets the module-level expiry flag between tests.
  clearSession();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("B4 session expiry flag", () => {
  it("a 401 flags expiry but never clears the stored session (no wipe trigger)", async () => {
    setSession("tok", USER);
    vi.stubGlobal("fetch", respond(401));
    const expired = vi.fn();
    window.addEventListener("less:sessionexpired", expired);
    try {
      expect(await api("scripts")).toBeNull(); // degrades to local-only
      expect(isSessionExpired()).toBe(true);
      // The session survives: the user stays non-null, so the sign-out wipe
      // (dropCloudProjects and friends) can never fire off a mere expiry.
      expect(getToken()).toBe("tok");
      expect(getStoredUser()).toEqual(USER);
      expect(expired).toHaveBeenCalledTimes(1);
      // Further 401s stay quiet: the flag is already set, no repeat event.
      expect(await api("scripts")).toBeNull();
      expect(expired).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("less:sessionexpired", expired);
    }
  });

  it("signing back in clears the flag and announces the restoration", async () => {
    setSession("tok", USER);
    vi.stubGlobal("fetch", respond(401));
    await api("scripts");
    expect(isSessionExpired()).toBe(true);
    const restored = vi.fn();
    window.addEventListener("less:sessionrestored", restored);
    try {
      // Re-auth as the same account: user.id does not change, so the sync
      // engines resume off this event rather than an identity change.
      setSession("tok2", USER);
      expect(isSessionExpired()).toBe(false);
      expect(restored).toHaveBeenCalledTimes(1);
      expect(getToken()).toBe("tok2");
      // A sign-in with the session already live does not re-fire it.
      setSession("tok3", USER);
      expect(restored).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("less:sessionrestored", restored);
    }
  });

  it("an explicit sign-out resets the flag without a restoration event", async () => {
    setSession("tok", USER);
    vi.stubGlobal("fetch", respond(401));
    await api("scripts");
    expect(isSessionExpired()).toBe(true);
    const restored = vi.fn();
    window.addEventListener("less:sessionrestored", restored);
    try {
      clearSession();
      expect(isSessionExpired()).toBe(false);
      expect(restored).not.toHaveBeenCalled();
      expect(getToken()).toBeNull();
      expect(getStoredUser()).toBeNull();
    } finally {
      window.removeEventListener("less:sessionrestored", restored);
    }
  });
});
