import type { JSONContent } from "@tiptap/core";
import { downloadBlob, safeFilename } from "./download";

/**
 * Plain-document export: Markdown and plain text, both written client-side with
 * no new dependency. A small ProseMirror-doc walker, enough for outlines/notes.
 */

export type PlainExportFormat = "markdown" | "txt";

function longestBacktickRun(text: string): number {
  return Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
}

function inlineCode(text: string): string {
  const fence = "`".repeat(Math.max(1, longestBacktickRun(text) + 1));
  const pad = /^`|`$|^ | $/.test(text) ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

function escapeMarkdownText(text: string): string {
  return text.replace(/([\\`*_[\]~])/g, "\\$1");
}

function escapeLinkDestination(href: string): string {
  return href.replace(/([\\()])/g, "\\$1").replace(/\s/g, "%20");
}

function escapeMarkdownBlockStarts(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      line
        .replace(/^(\s*)(#{1,6})(?=\s|$)/, "$1\\$2")
        .replace(/^(\s*)(>)/, "$1\\$2")
        .replace(/^(\s*)([-+])(?=\s)/, "$1\\$2")
        .replace(/^(\s*)-(?=-{2,}\s*$)/, "$1\\-")
        .replace(/^(\s*\d+)([.)])(?=\s)/, "$1\\$2")
    )
    .join("\n");
}

function inlineMarkdown(node: JSONContent): string {
  if (node.type === "hardBreak") return "  \n";
  if (node.type !== "text") {
    return (node.content ?? []).map(inlineMarkdown).join("");
  }

  const marks = node.marks ?? [];
  const mark = (name: string) => marks.find((candidate) => candidate.type === name);
  let text = mark("code") ? inlineCode(node.text ?? "") : escapeMarkdownText(node.text ?? "");
  if (mark("bold")) text = `**${text}**`;
  if (mark("italic")) text = `*${text}*`;
  if (mark("strike")) text = `~~${text}~~`;
  const link = mark("link");
  const href = link?.attrs?.href;
  if (typeof href === "string" && href) {
    text = `[${text}](${escapeLinkDestination(href)})`;
  }
  return text;
}

function inlineText(node: JSONContent): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  return (node.content ?? []).map(inlineText).join("");
}

function indent(text: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");
}

function isListNode(node: JSONContent): boolean {
  return ["bulletList", "orderedList", "taskList"].includes(node.type ?? "");
}

function markdownListItem(
  node: JSONContent,
  marker: string,
  task: boolean
): string {
  const content = node.content ?? [];
  const checked = node.attrs?.checked === true;
  const prefix = task ? `${marker} [${checked ? "x" : " "}] ` : `${marker} `;
  const continuation = " ".repeat(prefix.length);
  const firstIndex = content.findIndex((child) => !isListNode(child));
  const first = firstIndex >= 0 ? markdownBlock(content[firstIndex]) : "";
  let result = first
    .split("\n")
    .map((line, index) => (index === 0 ? prefix : continuation) + line)
    .join("\n");
  for (let index = 0; index < content.length; index++) {
    if (index === firstIndex) continue;
    const child = content[index];
    if (isListNode(child)) result += `\n${indent(markdownBlock(child), 2)}`;
    else result += `\n${continuation}\n${indent(markdownBlock(child), continuation.length)}`;
  }
  return result;
}

function markdownList(node: JSONContent): string {
  const ordered = node.type === "orderedList";
  const task = node.type === "taskList";
  const rawStart = node.attrs?.start;
  const start = ordered && typeof rawStart === "number" && Number.isFinite(rawStart)
    ? Math.trunc(rawStart)
    : 1;
  return (node.content ?? [])
    .map((item, index) =>
      markdownListItem(item, ordered ? `${start + index}.` : "-", task)
    )
    .join("\n");
}

function markdownBlock(node: JSONContent): string {
  switch (node.type) {
    case "heading": {
      const rawLevel = node.attrs?.level;
      const level = typeof rawLevel === "number"
        ? Math.trunc(Math.min(6, Math.max(1, rawLevel)))
        : 1;
      return `${"#".repeat(level)} ${inlineMarkdown(node)}`;
    }
    case "bulletList":
    case "orderedList":
    case "taskList":
      return markdownList(node);
    case "blockquote": {
      const content = (node.content ?? []).map(markdownBlock).join("\n\n");
      return content
        .split("\n")
        .map((line) => (line ? `> ${line}` : ">"))
        .join("\n");
    }
    case "codeBlock": {
      const content = inlineText(node);
      const fence = "`".repeat(Math.max(3, longestBacktickRun(content) + 1));
      return `${fence}\n${content}${content.endsWith("\n") ? "" : "\n"}${fence}`;
    }
    case "horizontalRule":
      return "---";
    case "paragraph":
      return escapeMarkdownBlockStarts(inlineMarkdown(node));
    default:
      return inlineMarkdown(node);
  }
}

function textListItem(node: JSONContent, marker: string, task: boolean): string {
  const content = node.content ?? [];
  const checked = node.attrs?.checked === true;
  const prefix = task ? `[${checked ? "x" : " "}] ` : `${marker} `;
  const continuation = " ".repeat(prefix.length);
  const firstIndex = content.findIndex((child) => !isListNode(child));
  const first = firstIndex >= 0 ? textBlock(content[firstIndex]) : "";
  let result = first
    .split("\n")
    .map((line, index) => (index === 0 ? prefix : continuation) + line)
    .join("\n");
  for (let index = 0; index < content.length; index++) {
    if (index === firstIndex) continue;
    const child = content[index];
    if (isListNode(child)) result += `\n${indent(textBlock(child), 2)}`;
    else result += `\n${continuation}\n${indent(textBlock(child), continuation.length)}`;
  }
  return result;
}

function textList(node: JSONContent): string {
  const ordered = node.type === "orderedList";
  const task = node.type === "taskList";
  const rawStart = node.attrs?.start;
  const start = ordered && typeof rawStart === "number" && Number.isFinite(rawStart)
    ? Math.trunc(rawStart)
    : 1;
  return (node.content ?? [])
    .map((item, index) => textListItem(item, ordered ? `${start + index}.` : "-", task))
    .join("\n");
}

function textBlock(node: JSONContent): string {
  switch (node.type) {
    case "bulletList":
    case "orderedList":
    case "taskList":
      return textList(node);
    case "blockquote":
      return (node.content ?? []).map(textBlock).join("\n\n");
    case "horizontalRule":
      return "---";
    default:
      return inlineText(node);
  }
}

function finish(blocks: string[]): string {
  const body = blocks.join("\n\n");
  return body.endsWith("\n") ? body : body + "\n";
}

export function plainToMarkdown(doc: JSONContent): string {
  return finish((doc.content ?? []).map(markdownBlock));
}

export function plainToText(doc: JSONContent): string {
  return finish((doc.content ?? []).map(textBlock));
}

export function exportPlain(
  doc: JSONContent,
  format: PlainExportFormat,
  title: string
): void {
  if (format === "markdown") {
    downloadBlob(plainToMarkdown(doc), safeFilename(title, "md"), "text/markdown;charset=utf-8");
  } else {
    downloadBlob(plainToText(doc), safeFilename(title, "txt"), "text/plain;charset=utf-8");
  }
}
