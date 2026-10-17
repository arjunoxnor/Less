/**
 * A cover digest: the handful of facts a document's cover is drawn from (its
 * first scene, its cast, a logline, its beats, the first images on a board, a
 * voice note's waveform). Small (about a kilobyte), pure, and dependency-free,
 * because two places compute it from the same document JSON:
 *
 *   - the app, on every local save, so a cover updates as you type
 *   - the API, on every content write, so a device that has never opened a
 *     document still draws its full cover from the project list
 *
 * Nothing here trusts its input: strings are trimmed and capped, image sources
 * are limited to LESS's own asset links and plain https URLs, and every list is
 * bounded, so a hostile document cannot bloat the list response.
 */

export interface CoverDigest {
  v: 1;
  /** Words across the whole document. */
  words: number;
  /** Screenplays: how many scene headings, the first one, the main cast. */
  scenes?: number;
  firstScene?: string;
  cast?: string[];
  /** Prose: the first headings (outline beats, character names). */
  headings?: string[];
  /** Prose: the opening paragraphs. */
  lines?: string[];
  /** Prose: an explicit logline ("Logline: ..." or the paragraph under a Logline heading). */
  logline?: string;
  /** Prose: the first list items (beats when there are no headings). */
  items?: string[];
  /** Boards: the first images and palette colors. */
  images?: string[];
  swatches?: string[];
  /** The first voice note in the document. */
  voice?: { ms: number; peaks: string; transcribed: boolean };
}

interface Node {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
}

const MAX_NODES = 20000;
const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
};

function textOf(node: Node, budget = { n: 0 }): string {
  if (budget.n++ > MAX_NODES) return "";
  if (typeof node.text === "string") return node.text;
  if (!Array.isArray(node.content)) return "";
  let out = "";
  for (const child of node.content) out += textOf(child, budget);
  return out;
}

function countWords(s: string): number {
  const m = s.match(/[\p{L}\p{N}'’-]+/gu);
  return m ? m.length : 0;
}

/** LESS asset links, or ordinary https images. Anything else is dropped. */
function safeSrc(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (/^\/api\/assets\/[a-f0-9]{32}$/i.test(s)) return s;
  if (/^https:\/\/[^\s"'<>\\]{1,300}$/i.test(s)) return s;
  return null;
}

function safeHex(v: unknown): string | null {
  return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : null;
}

/** "MARY (V.O.)" and "MARY (CONT'D)" are the same speaker. */
function cueName(raw: string): string {
  return raw
    .replace(/\(.*?\)/g, "")
    .replace(/\^$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

const LOGLINE_LEAD = /^\s*log\s*line\s*[:.–—-]\s*/i;

export function digestOf(content: unknown): CoverDigest {
  const root = (content && typeof content === "object" ? content : {}) as Node;
  const top = Array.isArray(root.content) ? root.content : [];
  const d: CoverDigest = { v: 1, words: 0 };

  let words = 0;
  let scenes = 0;
  const castCount = new Map<string, number>();
  const headings: string[] = [];
  const lines: string[] = [];
  const items: string[] = [];
  const images: string[] = [];
  const swatches: string[] = [];
  let logline: string | undefined;
  let loglineHeadingSeen = false;
  let visited = 0;

  const walk = (node: Node, depth: number) => {
    if (visited++ > MAX_NODES || depth > 12 || !node || typeof node !== "object") return;
    const type = node.type ?? "";

    if (type === "screenplayLine") {
      const element = node.attrs?.element;
      const text = textOf(node).trim();
      words += countWords(text);
      if (!text) return;
      if (element === "scene_heading") {
        scenes++;
        if (!d.firstScene) d.firstScene = clip(text.toUpperCase(), 60);
      } else if (element === "character") {
        const name = cueName(text);
        if (name) castCount.set(name, (castCount.get(name) ?? 0) + 1);
      } else if ((element === "action" || element === "dialogue") && lines.length < 3) {
        lines.push(clip(text, 140));
      }
      return;
    }

    if (type === "figure") {
      const src = safeSrc(node.attrs?.src);
      if (src && images.length < 4) images.push(src);
      words += countWords(textOf(node));
      return;
    }
    if (type === "palette") {
      const colors = Array.isArray(node.attrs?.colors) ? (node.attrs!.colors as unknown[]) : [];
      for (const c of colors) {
        const hex = safeHex((c as { hex?: unknown })?.hex);
        if (hex && swatches.length < 6) swatches.push(hex);
      }
      return;
    }
    if (type === "voiceNote" || type === "voicePending") {
      if (!d.voice) {
        const ms = Number(node.attrs?.duration);
        const peaks = typeof node.attrs?.peaks === "string" ? node.attrs.peaks : "";
        d.voice = {
          ms: Number.isFinite(ms) && ms > 0 ? Math.min(Math.round(ms), 6 * 60 * 60 * 1000) : 0,
          peaks: peaks.toLowerCase().replace(/[^0-9a-z]/g, "").slice(0, 96),
          transcribed: type === "voiceNote",
        };
        const said = textOf(node).trim();
        if (said && lines.length < 3) lines.push(clip(said, 140));
      }
      words += countWords(textOf(node));
      return;
    }

    if (type === "heading") {
      const text = textOf(node).trim();
      words += countWords(text);
      if (!text) return;
      if (/^log\s*line$/i.test(text.replace(/[:.]/g, ""))) loglineHeadingSeen = true;
      else if (headings.length < 8) headings.push(clip(text, 40));
      return;
    }
    if (type === "paragraph") {
      const text = textOf(node).trim();
      words += countWords(text);
      if (!text) return;
      if (!logline && LOGLINE_LEAD.test(text)) logline = clip(text.replace(LOGLINE_LEAD, ""), 240);
      else if (!logline && loglineHeadingSeen) logline = clip(text, 240);
      else if (lines.length < 4) lines.push(clip(text, 160));
      loglineHeadingSeen = false;
      return;
    }
    if (type === "listItem" || type === "taskItem") {
      const text = textOf(node).trim();
      words += countWords(text);
      if (text && items.length < 8) items.push(clip(text, 40));
      return;
    }

    if (Array.isArray(node.content)) for (const child of node.content) walk(child, depth + 1);
    else if (typeof node.text === "string") words += countWords(node.text);
  };

  for (const node of top) walk(node, 0);

  d.words = words;
  if (scenes) d.scenes = scenes;
  if (castCount.size) {
    d.cast = [...castCount.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 4)
      .map(([name]) => clip(name, 24));
  }
  if (headings.length) d.headings = headings;
  if (lines.length) d.lines = lines;
  if (logline) d.logline = logline;
  if (items.length) d.items = items;
  if (images.length) d.images = images;
  if (swatches.length) d.swatches = swatches;
  return d;
}

/** A digest read back from storage or the network: shape-checked, never trusted. */
export function readDigest(value: unknown): CoverDigest | null {
  let v = value;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object" || (v as CoverDigest).v !== 1) return null;
  const raw = v as Record<string, unknown>;
  const strs = (x: unknown, n: number, len: number) =>
    Array.isArray(x) ? x.filter((s): s is string => typeof s === "string").slice(0, n).map((s) => clip(s, len)) : undefined;
  const out: CoverDigest = { v: 1, words: Number.isFinite(raw.words) ? Math.max(0, Number(raw.words)) : 0 };
  if (Number.isFinite(raw.scenes)) out.scenes = Math.max(0, Number(raw.scenes));
  if (typeof raw.firstScene === "string") out.firstScene = clip(raw.firstScene, 60);
  const cast = strs(raw.cast, 4, 24);
  if (cast?.length) out.cast = cast;
  const headings = strs(raw.headings, 8, 40);
  if (headings?.length) out.headings = headings;
  const lines = strs(raw.lines, 4, 160);
  if (lines?.length) out.lines = lines;
  if (typeof raw.logline === "string") out.logline = clip(raw.logline, 240);
  const items = strs(raw.items, 8, 40);
  if (items?.length) out.items = items;
  const images = Array.isArray(raw.images)
    ? raw.images.map(safeSrc).filter((s): s is string => !!s).slice(0, 4)
    : [];
  if (images.length) out.images = images;
  const swatches = Array.isArray(raw.swatches)
    ? raw.swatches.map(safeHex).filter((s): s is string => !!s).slice(0, 6)
    : [];
  if (swatches.length) out.swatches = swatches;
  const voice = raw.voice as Record<string, unknown> | undefined;
  if (voice && typeof voice === "object") {
    out.voice = {
      ms: Number.isFinite(voice.ms) ? Math.max(0, Number(voice.ms)) : 0,
      peaks: typeof voice.peaks === "string" ? voice.peaks.replace(/[^0-9a-z]/gi, "").slice(0, 96) : "",
      transcribed: voice.transcribed === true,
    };
  }
  return out;
}
