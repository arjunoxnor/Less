import type { JSONContent } from "@tiptap/core";
import type { TitlePage } from "@/lib/export/titlePage";
import type { ProjectStatus, ProjectType } from "@/lib/storage/projects";
import { api } from "./client";

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
  }
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

export async function setScriptFolder(
  id: string,
  folderId: string | null,
  position: number | null
): Promise<void> {
  await api(`scripts/${id}`, { method: "PATCH", body: { folder_id: folderId, position } });
}

export async function deleteScript(id: string): Promise<void> {
  await api(`scripts/${id}`, { method: "DELETE" });
}

export async function saveScript(
  id: string,
  content: JSONContent,
  title: string,
  titlePage?: TitlePage | null
): Promise<string | null> {
  const body: Record<string, unknown> = { content, title };
  // Pass null to clear it; omit (undefined) to leave it unchanged.
  if (titlePage !== undefined) body.title_page = titlePage;
  const r = await api<{ updated_at: string }>(`scripts/${id}`, { method: "PATCH", body });
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
