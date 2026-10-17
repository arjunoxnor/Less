import { api } from "./client";
import type { Folder, Stage } from "@/lib/storage/folders";
import type { DeskLayout } from "@/lib/desk/layout";

/**
 * Folders over the LESS API (Cloudflare D1). Same shapes and signatures as the
 * old Supabase module so the folder-sync orchestration is unchanged. These calls
 * only ever touch folder rows, never script content.
 */

export interface CloudFolder {
  id: string;
  name: string;
  color: string;
  stage: Stage;
  parent_id: string | null;
  position: number;
  updated_at: string;
  /** A project's desk layout (already sanitized by the API) and its clock. */
  desk?: unknown;
  desk_at?: string | null;
}

export async function listCloudFolders(): Promise<CloudFolder[]> {
  return (await api<CloudFolder[]>("folders")) ?? [];
}

export interface CloudFolderTombstone {
  id: string;
  deleted_at: string;
}

/** Folders deleted on the cloud, so this device can drop them and not re-upload. */
export async function listCloudFolderTombstones(): Promise<CloudFolderTombstone[]> {
  return (await api<CloudFolderTombstone[]>("folders/deleted")) ?? [];
}

// Returns false when the write did not reach the server (e.g. a 401 makes api()
// return null), so reconcile counts it as a failure rather than reporting a
// false "Synced" or dropping a queued folder delete.
export async function upsertCloudFolder(_userId: string, f: Folder): Promise<boolean> {
  const r = await api(`folders/${f.id}`, {
    method: "PUT",
    body: {
      name: f.name,
      color: f.color,
      stage: f.stage,
      parent_id: f.parentId ?? null,
      position: f.order,
      updated_at: f.updatedAt,
    },
  });
  return r !== null;
}

/**
 * Save a project's desk layout. Returns the server's desk clock, or null when
 * the write did not land (no such folder row yet, or a 401), so the caller
 * leaves its clock alone and the next reconcile pushes again.
 */
export async function setCloudFolderDesk(id: string, desk: DeskLayout): Promise<string | null> {
  const r = await api<{ desk_at: string | null }>(`folders/${id}/desk`, { method: "PATCH", body: { desk } });
  return r?.desk_at ?? null;
}

export async function deleteCloudFolder(id: string): Promise<boolean> {
  return (await api(`folders/${id}`, { method: "DELETE" })) !== null;
}
