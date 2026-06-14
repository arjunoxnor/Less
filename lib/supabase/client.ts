import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The browser Supabase client.
 *
 * If the env vars aren't set, this returns null and the whole app degrades
 * gracefully to local-only mode — you can still write, you just can't sync.
 * That's deliberate: LESS never holds your work hostage to a backend being up.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** True when cloud sync is available (env configured). */
export const isCloudConfigured = Boolean(url && anon);

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!url || !anon) return null;
  if (!_client) {
    _client = createClient(url, anon, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return _client;
}
