import type { JSONContent } from "@tiptap/core";
import { getSupabase } from "./client";

/**
 * Data access for the `scripts` and `script_versions` tables.
 *
 * Every call goes through Supabase with the user's session, so Row Level
 * Security enforces that you can only ever touch your own rows — even if there
 * were a bug here, the database would refuse a cross-user read or write.
 */

export interface ScriptRow {
  id: string;
  title: string;
  content: JSONContent;
  updated_at: string;
  created_at: string;
}

export interface ScriptSummary {
  id: string;
  title: string;
  updated_at: string;
}

export interface VersionRow {
  id: string;
  content: JSONContent;
  label: string | null;
  created_at: string;
}

/** Create a new script owned by `userId`. */
export async function createScript(
  userId: string,
  title: string,
  content: JSONContent
): Promise<ScriptRow | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from("scripts")
    .insert({ user_id: userId, title, content })
    .select("id, title, content, created_at, updated_at")
    .single();
  if (error) throw error;
  return data as ScriptRow;
}

/** Fetch one script by id (RLS guarantees it's yours). */
export async function fetchScript(id: string): Promise<ScriptRow | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from("scripts")
    .select("id, title, content, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as ScriptRow) ?? null;
}

/** The user's scripts, newest first. (Used by the future script picker.) */
export async function listScripts(): Promise<ScriptSummary[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("scripts")
    .select("id, title, updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data as ScriptSummary[]) ?? [];
}

/** Save content/title to an existing script. Returns the new updated_at. */
export async function saveScript(
  id: string,
  content: JSONContent,
  title: string
): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from("scripts")
    .update({ content, title })
    .eq("id", id)
    .select("updated_at")
    .single();
  if (error) throw error;
  return (data as { updated_at: string }).updated_at;
}

/** Take an immutable snapshot for rollback. */
export async function createSnapshot(
  scriptId: string,
  userId: string,
  content: JSONContent,
  label?: string
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.from("script_versions").insert({
    script_id: scriptId,
    user_id: userId,
    content,
    label: label ?? null,
  });
  if (error) throw error;
}

/** List a script's snapshots, newest first. */
export async function listVersions(scriptId: string): Promise<VersionRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("script_versions")
    .select("id, content, label, created_at")
    .eq("script_id", scriptId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data as VersionRow[]) ?? [];
}
