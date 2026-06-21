import type { JSONContent } from "@tiptap/core";
import type { TitlePage } from "@/lib/export/titlePage";
import type { ProjectStatus, ProjectType } from "@/lib/storage/projects";
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
  title_page?: TitlePage | null;
  type: ProjectType;
  status: ProjectStatus;
  updated_at: string;
  created_at: string;
}

export interface ScriptSummary {
  id: string;
  title: string;
  type: ProjectType;
  status: ProjectStatus;
  updated_at: string;
  /** Folder placement (migration 0005); null when the project is loose. */
  folder_id: string | null;
  position: number | null;
}

export interface VersionRow {
  id: string;
  content: JSONContent;
  title_page?: TitlePage | null;
  label: string | null;
  created_at: string;
}

/**
 * Create a new script owned by `userId`. Pass opts.id to insert with an explicit
 * id so the cloud row id equals the local project id (no remap on sync).
 */
export async function createScript(
  userId: string,
  title: string,
  content: JSONContent,
  opts?: {
    id?: string;
    type?: ProjectType;
    status?: ProjectStatus;
    titlePage?: TitlePage | null;
  }
): Promise<ScriptRow | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const row: Record<string, unknown> = {
    user_id: userId,
    title,
    content,
    type: opts?.type ?? "screenplay",
    status: opts?.status ?? "not_started",
  };
  if (opts?.id) row.id = opts.id;
  if (opts?.titlePage) row.title_page = opts.titlePage;
  const { data, error } = await sb
    .from("scripts")
    .insert(row)
    .select("id, title, content, title_page, type, status, created_at, updated_at")
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
    .select("id, title, content, title_page, type, status, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as ScriptRow) ?? null;
}

/** The user's scripts, newest first. Drives the projects dashboard. */
export async function listScripts(): Promise<ScriptSummary[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("scripts")
    .select("id, title, type, status, updated_at, folder_id, position")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data as ScriptSummary[]) ?? [];
}

/** Update a script's manual status (no content snapshot). */
export async function setScriptStatus(
  id: string,
  status: ProjectStatus
): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from("scripts")
    .update({ status })
    .eq("id", id)
    .select("updated_at")
    .single();
  if (error) throw error;
  return (data as { updated_at: string }).updated_at;
}

/**
 * Update only a script's folder placement (folder + manual position). Touches
 * no content, so it can never affect the writing itself.
 */
export async function setScriptFolder(
  id: string,
  folderId: string | null,
  position: number | null
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb
    .from("scripts")
    .update({ folder_id: folderId, position })
    .eq("id", id);
  if (error) throw error;
}

/** Delete a script (RLS-scoped; cascades its versions). */
export async function deleteScript(id: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.from("scripts").delete().eq("id", id);
  if (error) throw error;
}

/** Save content/title (and optional title page) to an existing script. */
export async function saveScript(
  id: string,
  content: JSONContent,
  title: string,
  titlePage?: TitlePage | null
): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const patch: Record<string, unknown> = { content, title };
  // Pass null to clear it explicitly; omit (undefined) to leave it unchanged.
  if (titlePage !== undefined) patch.title_page = titlePage;
  const { data, error } = await sb
    .from("scripts")
    .update(patch)
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
  titlePage?: TitlePage | null,
  label?: string
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const row: Record<string, unknown> = {
    script_id: scriptId,
    user_id: userId,
    content,
    label: label ?? null,
  };
  if (titlePage) row.title_page = titlePage;
  const { error } = await sb.from("script_versions").insert(row);
  if (error) throw error;
}

/** List a script's snapshots, newest first. */
export async function listVersions(scriptId: string): Promise<VersionRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("script_versions")
    .select("id, content, title_page, label, created_at")
    .eq("script_id", scriptId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data as VersionRow[]) ?? [];
}
