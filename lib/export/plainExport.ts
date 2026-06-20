import type { JSONContent } from "@tiptap/core";
import { downloadBlob, safeFilename } from "./download";

/**
 * Plain-document export: Markdown and plain text, both written client-side with
 * no new dependency. A small ProseMirror-doc walker, enough for outlines/notes.
 */

export type PlainExportFormat = "markdown" | "txt";

function inline(node: JSONContent): string {
  if (node.type === "text") {
    let t = node.text ?? "";
    const marks = node.marks ?? [];
    const has = (n: string) => marks.some((m) => m.type === n);
    if (has("code")) t = "`" + t + "`";
    if (has("bold")) t = "**" + t + "**";
    if (has("italic")) t = "*" + t + "*";
    if (has("strike")) t = "~~" + t + "~~";
    return t;
  }
  return (node.content ?? []).map(inline).join("");
}

function blockToMarkdown(node: JSONContent): string {
  switch (node.type) {
    case "heading":
      return "#".repeat((node.attrs?.level as number) ?? 1) + " " + inline(node);
    case "bulletList":
      return (node.content ?? []).map((li) => "- " + inline(li).trim()).join("\n");
    case "orderedList":
      return (node.content ?? [])
        .map((li, i) => `${i + 1}. ` + inline(li).trim())
        .join("\n");
    case "blockquote":
      return (node.content ?? []).map((p) => "> " + inline(p)).join("\n");
    case "horizontalRule":
      return "---";
    default:
      return inline(node);
  }
}

function toMarkdown(doc: JSONContent): string {
  return (
    (doc.content ?? [])
      .map(blockToMarkdown)
      .join("\n\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim() + "\n"
  );
}

function toText(doc: JSONContent): string {
  return (
    (doc.content ?? [])
      .map((b) => inline(b))
      .join("\n\n")
      .trim() + "\n"
  );
}

export function exportPlain(
  doc: JSONContent,
  format: PlainExportFormat,
  title: string
): void {
  if (format === "markdown") {
    downloadBlob(toMarkdown(doc), safeFilename(title, "md"), "text/markdown;charset=utf-8");
  } else {
    downloadBlob(toText(doc), safeFilename(title, "txt"), "text/plain;charset=utf-8");
  }
}
