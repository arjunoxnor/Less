"use client";

import { useEffect, useState } from "react";
import {
  type CloudUser,
  getStoredUser,
  setSession,
  clearSession,
  onAuthChange,
} from "./client";

/**
 * Auth is "Sign in with Google". The Google button (rendered in AuthModal via
 * Google Identity Services) hands us an ID token; we trade it at /api/auth/google
 * for a 30-day session token, which the api() helper attaches to every call.
 * useAuth just reflects the stored session, so the rest of the app keeps using
 * a `user` with `.id` and `.email`, same as before.
 */

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

/** Exchange a Google ID token (credential) for a LESS session. */
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
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e : new Error("Sign-in failed") };
  }
}

export async function signOut(): Promise<void> {
  clearSession();
}
