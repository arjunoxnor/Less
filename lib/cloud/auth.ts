"use client";

import { useEffect, useState } from "react";
import {
  type CloudUser,
  getStoredUser,
  setSession,
  clearSession,
  isSessionExpired,
  onAuthChange,
  api,
} from "./client";

/**
 * Auth for LESS sync.
 *
 * Primary method is a private sync code: a random code that IS your identity.
 * You create one on the first device, then paste it on your others to link
 * them. The code is sent as `Authorization: Bearer code:<code>`; the API hashes
 * it for the user id, so the raw code never touches the database.
 *
 * Google sign-in (signInWithGoogle) is also supported by the API and can be
 * turned on later by configuring a Google client id; the code path needs no
 * setup, so it is the default today.
 */

const CODE_KEY = "less:synccode";
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I, L, O, 0, 1

export function getSyncCode(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(CODE_KEY);
  } catch {
    return null;
  }
}

/** Group into blocks of four for display, e.g. ABCD-EFGH-... */
export function formatSyncCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, "$1-");
}

function newCode(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s;
}

/** Adopt a code (link this device to it). Normalizes formatting. */
export function adoptSyncCode(code: string): boolean {
  const clean = code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (clean.length < 16) return false;
  try {
    window.localStorage.setItem(CODE_KEY, clean);
  } catch {
    /* ignore */
  }
  // Derive the local id from the code so switching from one code to another
  // changes user.id, which is what makes the reconcile effect re-run and pull
  // the new code's data. (The real server-side id is the code hash; this local
  // id is only used to detect an identity change.)
  const localId = "synced:" + clean.slice(0, 12);
  return setSession("code:" + clean, { id: localId, email: "Synced", name: "Synced" });
}

/** Create a fresh code on this device and link to it. */
export function createSyncCode(): string {
  const code = newCode();
  adoptSyncCode(code);
  return code;
}

/**
 * Claim another sync code's data into the ALREADY signed-in account (e.g. a
 * Google user pulling in scripts they made under a code, without signing out).
 * Uses the current session token; the API moves the code's rows into this
 * account. Returns false if the code is malformed or the call did not land.
 */
export async function claimSyncCode(code: string): Promise<boolean> {
  const clean = code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (clean.length < 16) return false;
  const res = await api<{ ok?: boolean }>("auth/claim", {
    method: "POST",
    body: { code: clean },
  });
  return res !== null;
}

export function useAuth() {
  const [user, setUser] = useState<CloudUser | null>(null);
  const [loading, setLoading] = useState(true);
  // True while the stored session is dead (an API call answered 401). The user
  // stays non-null on purpose: expiry is NOT a sign-out, and local copies of
  // cloud projects must survive it. Cleared by a successful sign-in (setSession
  // calls clearExpired and notifies).
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    setUser(getStoredUser());
    setSessionExpired(isSessionExpired());
    setLoading(false);
    const offAuth = onAuthChange(() => {
      setUser(getStoredUser());
      setSessionExpired(isSessionExpired());
    });
    const onExpired = () => setSessionExpired(true);
    window.addEventListener("less:sessionexpired", onExpired);
    return () => {
      offAuth();
      window.removeEventListener("less:sessionexpired", onExpired);
    };
  }, []);

  return { user, loading, sessionExpired };
}

/** Exchange a Google ID token for a session (used when Google login is on). */
export async function signInWithGoogle(idToken: string): Promise<{ error?: Error }> {
  try {
    const res = await fetch("/api/auth/google", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    if (!res.ok) {
      const detail = (await res.json().catch(() => ({}))) as { error?: string };
      return { error: new Error(detail.error || "Sign-in failed") };
    }
    const data = (await res.json()) as { token: string; user: CloudUser };
    // If this device had a sync code, move that data into the Google account
    // BEFORE storing the session. Storing the session is what triggers the
    // reconcile pull; if the claim has not run yet, that pull sees an empty
    // account and the writer's scripts look like they vanished. Claim with the
    // Google token directly so the re-key is done first.
    const code = getSyncCode();
    if (code) {
      try {
        await fetch("/api/auth/claim", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer " + data.token,
          },
          body: JSON.stringify({ code }),
        });
      } catch {
        /* best effort; reconcile will still pull what is there */
      }
    }
    if (!setSession(data.token, data.user)) {
      // Keep the sync code on a failed session save so the device is not left
      // signed out with no way back to its data.
      return {
        error: new Error(
          "Signed in, but your browser would not save the session. Check that storage is allowed and try again."
        ),
      };
    }
    // Only now that the session is stored is it safe to drop the sync code.
    if (code) {
      try {
        window.localStorage.removeItem(CODE_KEY);
      } catch {
        /* ignore */
      }
    }
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e : new Error("Sign-in failed") };
  }
}

export async function signOut(): Promise<void> {
  try {
    window.localStorage.removeItem(CODE_KEY);
  } catch {
    /* ignore */
  }
  clearSession();
}
