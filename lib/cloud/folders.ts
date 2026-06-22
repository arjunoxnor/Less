import { api } from "./client";
import type { Folder, Stage } from "@/lib/storage/folders";

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

export async function deleteCloudFolder(id: string): Promise<boolean> {
  return (await api(`folders/${id}`, { method: "DELETE" })) !== null;
}
