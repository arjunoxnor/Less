import type { JSONContent } from "@tiptap/core";
import type { TitlePage } from "@/lib/export/titlePage";
import { fetchScript } from "@/lib/cloud/scripts";
import { loadProjectDoc, loadProjectTitlePage, type ProjectMeta } from "./projects";

/**
 * Duplicate support for the library's file menu. A copy is filed beside the
 * original as "Title (copy)", then "Title (copy 2)" and so on, so two documents
 * never share a name. Images and voice recordings are shared by reference,
 * which is safe: nothing deletes an asset when a script is deleted or an image
 * is removed from a document.
 */

/** The next free "(copy)" name for a title, compared without case. */
export function copyTitle(title: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((t) => t.trim().toLowerCase()));
  // Copying a copy counts up from the original name, not "X (copy) (copy)".
  const root = title.trim().replace(/\s*\(copy(?: \d+)?\)$/i, "").trim() || "Untitled";
  let candidate = `${root} (copy)`;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${root} (copy ${n})`;
  return candidate;
}

/**
 * The text and title page to copy. The local body wins when present. When it
 * is missing (pulled from the account but never opened on this device, or
 * freed to save space), the cloud copy is fetched, so a duplicate of a real
 * script is never silently empty. Returns null when the text cannot be read.
 */
export async function loadBodyForCopy(
  meta: ProjectMeta
): Promise<{ content: JSONContent | undefined; titlePage: TitlePage | null } | null> {
  const local = loadProjectDoc(meta.id);
  if (local) return { content: local, titlePage: loadProjectTitlePage(meta.id) };
  // Never synced and no body: the project really is empty, so is the copy.
  if (!meta.cloudCreated) return { content: undefined, titlePage: loadProjectTitlePage(meta.id) };
  const row = await fetchScript(meta.id);
  if (!row?.content) return null;
  return { content: row.content, titlePage: row.title_page ?? null };
}
