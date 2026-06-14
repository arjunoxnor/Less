import type { JSONContent } from "@tiptap/core";
import { SAMPLE_SCRIPT } from "./sampleScript";

/** Concatenate all text in a ProseMirror doc (lines separated by spaces). */
export function docText(doc: JSONContent): string {
  const parts: string[] = [];
  const walk = (node?: JSONContent) => {
    if (!node) return;
    if (node.type === "text" && node.text) parts.push(node.text);
    node.content?.forEach(walk);
  };
  walk(doc);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Derive a script title from its content: the first scene heading, else the
 * first non-empty line, else "Untitled".
 */
export function deriveTitle(doc: JSONContent): string {
  const lines = doc.content ?? [];
  const firstScene = lines.find(
    (l) => l.attrs?.element === "scene_heading" && docText(l)
  );
  const pick = firstScene ?? lines.find((l) => docText(l));
  const text = pick ? docText(pick) : "";
  if (!text) return "Untitled";
  return text.length > 80 ? text.slice(0, 80) + "…" : text;
}

/**
 * Is this document real work, or just the untouched sample / an empty page?
 * Used to decide, on first sign-in, whether to preserve the local doc as a new
 * cloud script (so anonymous work is never lost) or load existing cloud work.
 */
export function isMeaningfulDoc(doc: JSONContent): boolean {
  if (!docText(doc)) return false;
  return JSON.stringify(doc) !== JSON.stringify(SAMPLE_SCRIPT);
}
