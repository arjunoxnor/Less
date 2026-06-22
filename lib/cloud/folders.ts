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

/** Insert or update a folder (idempotent on id). */
export async function upsertCloudFolder(_userId: string, f: Folder): Promise<void> {
  await api(`folders/${f.id}`, {
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
}

export async function deleteCloudFolder(id: string): Promise<void> {
  await api(`folders/${id}`, { method: "DELETE" });
}
