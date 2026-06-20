import type { JSONContent } from "@tiptap/core";
import { deriveTitle, isMeaningfulDoc } from "./docUtils";

/**
 * Title / meaningfulness for PLAIN documents (the standard rich-text schema),
 * the siblings of docUtils for the screenplay schema. Kept separate so the two
 * schemas never share derivation logic.
 */

/** Concatenate all text in a plain-doc ProseMirror doc. */
function plainText(node: JSONContent): string {
  const parts: string[] = [];
  const walk = (n?: JSONContent) => {
    if (!n) return;
    if (n.type === "text" && n.text) parts.push(n.text);
    n.content?.forEach(walk);
  };
  walk(node);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** Title from a plain doc: the first non-empty block's text, else "Untitled". */
export function derivePlainTitle(doc: JSONContent): string {
  for (const block of doc.content ?? []) {
    const t = plainText(block);
    if (t) return t.length > 80 ? t.slice(0, 80) + "…" : t;
  }
  return "Untitled";
}

/** Is this plain doc real work, or an empty page? */
export function isMeaningfulPlainDoc(doc: JSONContent): boolean {
  return plainText(doc).length > 0;
}

/** Title dispatcher by project type, used by storage and sync. */
export function deriveTitleFor(
  type: "screenplay" | "plain",
  doc: JSONContent
): string {
  return type === "plain" ? derivePlainTitle(doc) : deriveTitle(doc);
}

/** Meaningfulness dispatcher by project type. */
export function isMeaningfulFor(
  type: "screenplay" | "plain",
  doc: JSONContent
): boolean {
  return type === "plain" ? isMeaningfulPlainDoc(doc) : isMeaningfulDoc(doc);
}
