/**
 * The plain facts of a bookmark (lib/editor/bookmarks.ts): its colours, its
 * shape, and how to find the bookmarks in a document's JSON. Dependency-free,
 * because the API reads them too, for the home's list of bookmarks across
 * every project (the cover digest, lib/cover/digest.ts).
 */

export const BOOKMARK_COLORS = [
  { id: "red", label: "Red", hex: "#e5484d" },
  { id: "orange", label: "Orange", hex: "#ef8a2b" },
  { id: "yellow", label: "Yellow", hex: "#e0b30b" },
  { id: "green", label: "Green", hex: "#2f9e64" },
  { id: "blue", label: "Blue", hex: "#3b7fe6" },
  { id: "purple", label: "Purple", hex: "#8e55c9" },
] as const;

export type BookmarkColor = (typeof BOOKMARK_COLORS)[number]["id"];

export interface Bookmark {
  id: string;
  color: BookmarkColor;
  /** Optional; the line's own text stands in for it. */
  name: string;
}

export const BOOKMARK_NAME_MAX = 60;
const COLOR_IDS = new Set<string>(BOOKMARK_COLORS.map((c) => c.id));

export const bookmarkHex = (color: string) =>
  BOOKMARK_COLORS.find((c) => c.id === color)?.hex ?? BOOKMARK_COLORS[0].hex;

export const isBookmarkColor = (v: unknown): v is BookmarkColor =>
  typeof v === "string" && COLOR_IDS.has(v);

/** A bookmark's name made safe: one line, at most 60 characters. */
export const cleanBookmarkName = (v: unknown) =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, BOOKMARK_NAME_MAX) : "";

/** A bookmark read from a document: shape-checked, never trusted. */
export function sanitizeBookmark(v: unknown): Bookmark | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id.replace(/[^a-z0-9]/gi, "").slice(0, 16) : "";
  if (!id || !isBookmarkColor(r.color)) return null;
  return { id, color: r.color, name: cleanBookmarkName(r.name) };
}

/** A bookmark as the home lists it: where it is, without opening the document. */
export interface BookmarkSummary {
  id: string;
  color: BookmarkColor;
  name: string;
  /** The start of the line, as written. */
  text: string;
  /** The position before the line (a hint: the line is found by its text). */
  pos: number;
}

export const BOOKMARK_SUMMARY_MAX = 20;

/** Nodes that hold text even when empty (an empty one has no "content"). */
const BLOCKS = /^(paragraph|heading|screenplayLine|codeBlock|blockquote|listItem|taskItem|bulletList|orderedList|taskList|voiceNote)$/;

interface JsonNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: JsonNode[];
}

/**
 * The bookmarks in a document's JSON, top to bottom, with each line's
 * position worked out the way the editor counts (a text is its length, any
 * other leaf is one, a node with content is two more than its content).
 */
export function bookmarksInJson(content: unknown, max = BOOKMARK_SUMMARY_MAX): BookmarkSummary[] {
  const out: BookmarkSummary[] = [];
  let visited = 0;
  const textOf = (n: JsonNode): string =>
    typeof n.text === "string" ? n.text : Array.isArray(n.content) ? n.content.map(textOf).join("") : "";
  const size = (n: JsonNode, depth: number, pos: number): number => {
    if (visited++ > 50_000 || depth > 24 || !n || typeof n !== "object") return 0;
    if (typeof n.text === "string") return n.text.length;
    const kids = Array.isArray(n.content) ? n.content : null;
    if (!kids && !BLOCKS.test(n.type ?? "")) return 1;
    if (n.attrs?.bookmark && out.length < max) {
      const b = sanitizeBookmark(n.attrs.bookmark);
      if (b) {
        // As it is on the page (the editor finds the line by it).
        const text = textOf(n).slice(0, 60);
        out.push({ ...b, text, pos });
      }
    }
    let inner = 0;
    for (const k of kids ?? []) inner += size(k, depth + 1, pos + 1 + inner);
    return inner + 2;
  };
  const root = (content && typeof content === "object" ? content : {}) as JsonNode;
  let pos = 0;
  for (const n of Array.isArray(root.content) ? root.content : []) pos += size(n, 0, pos);
  return out;
}

/** Bookmark summaries read back from storage or the network. */
export function readBookmarkSummaries(v: unknown): BookmarkSummary[] {
  if (!Array.isArray(v)) return [];
  const out: BookmarkSummary[] = [];
  for (const x of v.slice(0, BOOKMARK_SUMMARY_MAX)) {
    const b = sanitizeBookmark(x);
    if (!b) continue;
    const r = x as Record<string, unknown>;
    const pos = typeof r.pos === "number" && Number.isFinite(r.pos) ? Math.max(0, Math.min(10_000_000, Math.round(r.pos))) : 0;
    const text = typeof r.text === "string" ? r.text.slice(0, 60) : "";
    out.push({ ...b, text, pos });
  }
  return out;
}
