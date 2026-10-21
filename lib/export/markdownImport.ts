import type { JSONContent } from "@tiptap/core";

/**
 * Markdown into a plain document: the reverse of plainExport's Markdown, so a
 * treatment exported to Markdown and imported again comes back as it left,
 * with its headings, lists, checklists, quotes, rules, bold, italics,
 * strikethrough, code and links. (A screenplay in a Markdown file is still
 * read as Fountain; this is for prose.)
 */

type Mark = { type: string; attrs?: Record<string, unknown> };
type Inline = JSONContent;

const textNode = (text: string, marks: Mark[]): Inline =>
  marks.length ? { type: "text", text, marks: marks.map((m) => ({ ...m })) } : { type: "text", text };

/** Inline Markdown into text nodes with marks. */
export function parseInline(src: string, marks: Mark[] = []): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push(textNode(buf, marks));
    buf = "";
  };
  const wordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    // A backslash keeps the next punctuation as itself.
    if (ch === "\\" && i + 1 < src.length && /[\\`*_[\]~()#>!.+-]/.test(src[i + 1])) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        out.push(textNode(src.slice(i + 1, end), [...marks, { type: "code" }]));
        i = end + 1;
        continue;
      }
    }
    if (ch === "[") {
      const close = src.indexOf("](", i + 1);
      // The link's address ends at the first ")" that is not escaped.
      let end = -1;
      for (let k = close + 2; close > 0 && k < src.length; k++) {
        if (src[k] === "\\") k++;
        else if (src[k] === ")") {
          end = k;
          break;
        }
      }
      if (close > i && end > close) {
        flush();
        const href = src.slice(close + 2, end).replace(/\\([()\\])/g, "$1").replace(/%20/g, " ").trim();
        out.push(...parseInline(src.slice(i + 1, close), [...marks, { type: "link", attrs: { href } }]));
        i = end + 1;
        continue;
      }
    }
    const pair = (token: string, mark: string, intraword: boolean) => {
      if (!src.startsWith(token, i)) return false;
      const start = i + token.length;
      if (start >= src.length || /\s/.test(src[start])) return false;
      if (!intraword && wordChar(src[i - 1])) return false;
      let end = src.indexOf(token, start);
      while (end > 0 && (/\s/.test(src[end - 1]) || (!intraword && wordChar(src[end + token.length])))) {
        end = src.indexOf(token, end + 1);
      }
      if (end <= start) return false;
      flush();
      out.push(...parseInline(src.slice(start, end), [...marks, { type: mark }]));
      i = end + token.length;
      return true;
    };
    if (pair("**", "bold", true) || pair("__", "bold", false) || pair("~~", "strike", true)) continue;
    if (pair("*", "italic", true) || pair("_", "italic", false)) continue;
    buf += ch;
    i++;
  }
  flush();
  return out;
}

/** Neighbouring text with the same marks is one run of text. */
function merge(nodes: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const node of nodes) {
    const prev = out[out.length - 1];
    if (prev?.type === "text" && node.type === "text" && JSON.stringify(prev.marks ?? []) === JSON.stringify(node.marks ?? [])) {
      out[out.length - 1] = { ...prev, text: (prev.text ?? "") + (node.text ?? "") };
    } else out.push(node);
  }
  return out;
}

/** A paragraph's lines: two trailing spaces (or a backslash) is a line break. */
function inlineLines(lines: string[]): Inline[] {
  const out: Inline[] = [];
  lines.forEach((line, n) => {
    const hard = /( {2,}|\\)$/.test(line);
    const text = line.replace(/( {2,}|\\)$/, "").trim();
    out.push(...parseInline(text));
    if (n < lines.length - 1) out.push(hard ? { type: "hardBreak" } : { type: "text", text: " " });
  });
  return merge(out.filter((node, k) => !(node.type === "text" && node.text === " " && (k === 0 || k === out.length - 1))));
}

const para = (content: Inline[]): JSONContent => (content.length ? { type: "paragraph", content } : { type: "paragraph" });

const LIST = /^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?(.*)$/;

interface Item {
  indent: number;
  ordered: boolean;
  task: boolean;
  checked: boolean;
  lines: string[];
  children: Item[];
}

function buildList(items: Item[]): JSONContent {
  const first = items[0];
  const type = first.task ? "taskList" : first.ordered ? "orderedList" : "bulletList";
  return {
    type,
    content: items.map((it) => ({
      type: first.task ? "taskItem" : "listItem",
      ...(first.task ? { attrs: { checked: it.checked } } : {}),
      content: [para(inlineLines(it.lines)), ...(it.children.length ? [buildList(it.children)] : [])],
    })),
  };
}

/** Markdown text into a plain document. */
export function markdownToPlainDoc(markdown: string): JSONContent {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: JSONContent[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }
    // Fenced code.
    const fence = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      blocks.push(body.length ? { type: "codeBlock", content: [{ type: "text", text: body.join("\n") }] } : { type: "codeBlock" });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      const content = merge(parseInline(heading[2]));
      blocks.push({ type: "heading", attrs: { level: Math.min(3, heading[1].length) }, ...(content.length ? { content } : {}) });
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ type: "horizontalRule" });
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quoted.push(lines[i++].replace(/^\s*>\s?/, ""));
      const inner = markdownToPlainDoc(quoted.join("\n")).content ?? [];
      blocks.push({ type: "blockquote", content: inner.length ? inner : [para([])] });
      continue;
    }
    if (LIST.test(line)) {
      // A run of list lines; deeper indents nest under the item above.
      const roots: Item[] = [];
      const stack: Item[] = [];
      while (i < lines.length) {
        const m = LIST.exec(lines[i]);
        if (m) {
          const item: Item = {
            indent: m[1].replace(/\t/g, "    ").length,
            ordered: /\d/.test(m[2]),
            task: !!m[3],
            checked: !!m[3] && /x/i.test(m[3]),
            lines: [m[4]],
            children: [],
          };
          while (stack.length && stack[stack.length - 1].indent >= item.indent) stack.pop();
          const parent = stack[stack.length - 1];
          // A change of list kind at the top level starts a new list.
          if (!parent && roots.length && (roots[0].ordered !== item.ordered || roots[0].task !== item.task)) break;
          (parent ? parent.children : roots).push(item);
          stack.push(item);
          i++;
        } else if (lines[i].trim() !== "" && /^\s+\S/.test(lines[i]) && stack.length) {
          stack[stack.length - 1].lines.push(lines[i].trim());
          i++;
        } else break;
      }
      blocks.push(buildList(roots));
      continue;
    }
    // A paragraph: lines up to a blank line or the start of another block.
    const body: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,6})\s/.test(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !/^\s*(`{3,}|~{3,})/.test(lines[i]) &&
      !(body.length && LIST.test(lines[i]))
    ) {
      body.push(lines[i++]);
    }
    blocks.push(para(inlineLines(body)));
  }
  return { type: "doc", content: blocks.length ? blocks : [{ type: "paragraph" }] };
}

/** Plain text into a plain document: each line as written, nothing read as markup. */
export function textToPlainDoc(text: string): JSONContent {
  const blocks = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => ({ type: "paragraph", content: [{ type: "text", text: l }] }));
  return { type: "doc", content: blocks.length ? blocks : [{ type: "paragraph" }] };
}
