import type { JSONContent } from "@tiptap/core";
import type { TitlePage } from "@/lib/export/titlePage";
import type { ProjectStatus, ProjectType } from "@/lib/storage/projects";
import { api } from "./client";
import type { CoverDigest } from "@/lib/cover/digest";

/**
 * Scripts and version snapshots, over the LESS API (Cloudflare D1). Same shapes
 * and function signatures as the old Supabase module, so the sync orchestration
 * in useProjects / useCloudSync did not have to change. The API scopes every
 * query to the signed-in user, so you only ever touch your own rows.
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
  created_at: string | null;
  placed_at: string | null;
  title_at: string | null;
  status_at: string | null;
  folder_id: string | null;
  position: number | null;
  /** The desk (migration 0006): explicit kind, stack membership, their clock. */
  kind?: string | null;
  stack_id?: string | null;
  stack_top?: string | null;
  org_at?: string | null;
  /** What the cover is drawn from; computed by the server from the content. */
  digest?: CoverDigest | null;
  /** The title page's author line, for script covers on a fresh device. */
  tp_author?: string | null;
}

/** Kind and stack membership: one group, pushed together on its own clock. */
export interface OrgFields {
  kind?: string | null;
  stackId?: string | null;
  stackTop?: string | null;
}

export interface VersionRow {
  id: string;
  content: JSONContent;
  title_page?: TitlePage | null;
  label: string | null;
  created_at: string;
}

export async function createScript(
  _userId: string,
  title: string,
  content: JSONContent,
  opts?: {
    id?: string;
    type?: ProjectType;
    status?: ProjectStatus;
    titlePage?: TitlePage | null;
    folderId?: string | null;
    position?: number | null;
  } & OrgFields
): Promise<ScriptRow | null> {
  return api<ScriptRow>("scripts", {
    method: "POST",
    body: {
      id: opts?.id,
      title,
      content,
      type: opts?.type ?? "screenplay",
      status: opts?.status ?? "not_started",
      title_page: opts?.titlePage ?? null,
      // Carry the folder placement so a script's organization reaches the cloud
      // at creation, instead of only via a separate (easily-missed) call.
      folder_id: opts?.folderId ?? null,
      position: opts?.position ?? null,
      kind: opts?.kind ?? null,
      stack_id: opts?.stackId ?? null,
      stack_top: opts?.stackTop ?? null,
    },
  });
}

export async function fetchScript(id: string): Promise<ScriptRow | null> {
  return api<ScriptRow>(`scripts/${id}`);
}

export async function listScripts(): Promise<ScriptSummary[]> {
  return (await api<ScriptSummary[]>("scripts")) ?? [];
}

export async function setScriptStatus(id: string, status: ProjectStatus): Promise<string | null> {
  const r = await api<{ updated_at: string }>(`scripts/${id}`, { method: "PATCH", body: { status } });
  return r?.updated_at ?? null;
}

/** Title-only update, so a rename never re-uploads (and risks clobbering) content. */
export async function setScriptTitle(id: string, title: string): Promise<string | null> {
  const r = await api<{ updated_at: string }>(`scripts/${id}`, {
    method: "PATCH",
    body: { title },
  });
  return r?.updated_at ?? null;
}

// Returns false when the call did not reach the server (e.g. a 401 makes api()
// return null after clearing the session), so reconcile can count it as a
// failure instead of reporting a false "Synced".
export async function setScriptFolder(
  id: string,
  folderId: string | null,
  position: number | null
): Promise<boolean> {
  return (await api(`scripts/${id}`, { method: "PATCH", body: { folder_id: folderId, position } })) !== null;
}

/**
 * Push kind / stack membership. Only the fields given are sent; the server
 * advances org_at. Returns the server time it was written at (to align the
 * local clock), or null when it did not land (a 401 returns null, not a throw).
 */
export async function setScriptOrg(id: string, fields: OrgFields): Promise<string | null> {
  const body: Record<string, unknown> = {};
  if ("kind" in fields) body.kind = fields.kind ?? null;
  if ("stackId" in fields) body.stack_id = fields.stackId ?? null;
  if ("stackTop" in fields) body.stack_top = fields.stackTop ?? null;
  const r = await api<{ updated_at: string }>(`scripts/${id}`, { method: "PATCH", body });
  return r?.updated_at ?? null;
}

export async function deleteScript(id: string): Promise<boolean> {
  return (await api(`scripts/${id}`, { method: "DELETE" })) !== null;
}

// Body save: content (and optionally the title page) ONLY. The title is
// deliberately NOT sent here. A content autosave that carried the title would
// let a stale open editor overwrite a rename made on another device; titles
// flow exclusively through setScriptTitle (title-only, own clock). The server
// also ignores title on any content PATCH as a second line of defense.
export async function saveScript(
  id: string,
  content: JSONContent,
  titlePage?: TitlePage | null,
  opts?: { keepalive?: boolean }
): Promise<string | null> {
  const body: Record<string, unknown> = { content };
  // Pass null to clear it; omit (undefined) to leave it unchanged.
  if (titlePage !== undefined) body.title_page = titlePage;
  const r = await api<{ updated_at: string }>(`scripts/${id}`, {
    method: "PATCH",
    body,
    keepalive: opts?.keepalive,
  });
  return r?.updated_at ?? null;
}

export async function createSnapshot(
  scriptId: string,
  _userId: string,
  content: JSONContent,
  titlePage?: TitlePage | null,
  label?: string
): Promise<void> {
  await api(`scripts/${scriptId}/versions`, {
    method: "POST",
    body: { content, title_page: titlePage ?? null, label: label ?? null },
  });
}

export async function listVersions(scriptId: string): Promise<VersionRow[]> {
  return (await api<VersionRow[]>(`scripts/${scriptId}/versions`)) ?? [];
}
