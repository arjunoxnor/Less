import type { JSONContent } from "@tiptap/core";
import { deriveTitle, isMeaningfulDoc } from "./docUtils";

/**
 * Title / meaningfulness for PLAIN documents (the standard rich-text schema),
 * the siblings of docUtils for the screenplay schema. Kept separate so the two
 * schemas never share derivation logic.
 */

const STRUCTURAL_CONTAINERS = new Set([
  "doc",
  "blockquote",
  "bulletList",
  "orderedList",
  "taskList",
  "listItem",
  "taskItem",
]);

/** Concatenate text without adding spaces at inline mark boundaries. */
function plainText(node: JSONContent): string {
  const read = (current?: JSONContent): string => {
    if (!current) return "";
    if (current.type === "text") return current.text ?? "";
    if (current.type === "hardBreak") return "\n";
    const separator = STRUCTURAL_CONTAINERS.has(current.type ?? "") ? "\n" : "";
    return (current.content ?? []).map(read).join(separator);
  };
  return read(node).replace(/\s+/g, " ").trim();
}

/** Title from a plain doc: the first non-empty block's text, else "Untitled". */
export function derivePlainTitle(doc: JSONContent): string {
  for (const block of doc.content ?? []) {
    const t = plainText(block);
    if (t) {
      const characters = Array.from(t);
      return characters.length > 80 ? characters.slice(0, 80).join("") + "…" : t;
    }
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
