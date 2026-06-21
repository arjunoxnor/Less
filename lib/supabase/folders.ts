import { getSupabase } from "./client";
import type { Folder, Stage } from "@/lib/storage/folders";

/**
 * Cloud access for the `folders` table (migration 0005). Folders are the
 * organizing layer; like scripts, a folder's local id IS its cloud id, so the
 * two sides line up with no remapping. These calls only ever touch folder rows,
 * never script content, so a folder-sync problem can never endanger the writing.
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

const COLS = "id, name, color, stage, parent_id, position, updated_at";

export async function listCloudFolders(): Promise<CloudFolder[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb.from("folders").select(COLS);
  if (error) throw error;
  return (data as CloudFolder[]) ?? [];
}

/** Insert or update a folder (idempotent on id). */
export async function upsertCloudFolder(userId: string, f: Folder): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const row = {
    id: f.id,
    user_id: userId,
    name: f.name,
    color: f.color,
    stage: f.stage,
    parent_id: f.parentId ?? null,
    position: f.order,
  };
  const { error } = await sb.from("folders").upsert(row);
  if (error) throw error;
}

export async function deleteCloudFolder(id: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.from("folders").delete().eq("id", id);
  if (error) throw error;
}
