"use client";

import { useEffect, useState } from "react";
import {
  type CloudUser,
  getStoredUser,
  setSession,
  clearSession,
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
  setSession("code:" + clean, { id: "synced", email: "Synced", name: "Synced" });
  return true;
}

/** Create a fresh code on this device and link to it. */
export function createSyncCode(): string {
  const code = newCode();
  adoptSyncCode(code);
  return code;
}

export function useAuth() {
  const [user, setUser] = useState<CloudUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setUser(getStoredUser());
    setLoading(false);
    return onAuthChange(() => setUser(getStoredUser()));
  }, []);

  return { user, loading };
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
    setSession(data.token, data.user);
    // If this device had a sync code, move that data into the Google account so
    // nothing is left stranded under the old identity.
    const code = getSyncCode();
    if (code) {
      try {
        await api("auth/claim", { method: "POST", body: { code } });
      } catch {
        /* best effort; reconcile will still pull what is there */
      }
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
