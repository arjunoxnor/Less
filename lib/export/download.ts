import { deriveTitle } from "@/lib/editor/docUtils";

/**
 * Client-only file helpers. These are only ever called from event handlers in
 * client components, so `document` / `URL` are always defined and no SSR guard
 * is needed.
 */

/** Trigger a browser download of `data` as a file named `filename`. */
export function downloadBlob(data: BlobPart, filename: string, mime: string): void {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Turn a script title into a filesystem-safe filename with the given extension
 * (passed without a leading dot, e.g. "pdf"). Falls back to "screenplay".
 */
export function safeFilename(title: string, ext: string): string {
  const base = title
    .replace(/…+$/, "") // deriveTitle appends an ellipsis when it truncates
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "screenplay"}.${ext}`;
}

/** Re-exported so callers can derive a default filename from a doc in one place. */
export { deriveTitle };
