"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabase } from "./client";

/**
 * Auth for v1 is email + password (reliable and testable; magic-link / OAuth
 * are easy to add later). Email confirmation is turned off on the project so
 * signing up lets you save immediately — no email round-trip.
 */

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) {
      setLoading(false);
      return;
    }
    sb.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return { user, loading };
}

export async function signUp(email: string, password: string) {
  const sb = getSupabase();
  if (!sb) return { error: new Error("Cloud not configured") };
  const { error } = await sb.auth.signUp({ email, password });
  return { error };
}

export async function signIn(email: string, password: string) {
  const sb = getSupabase();
  if (!sb) return { error: new Error("Cloud not configured") };
  const { error } = await sb.auth.signInWithPassword({ email, password });
  return { error };
}

export async function signOut() {
  const sb = getSupabase();
  if (!sb) return;
  await sb.auth.signOut();
}
