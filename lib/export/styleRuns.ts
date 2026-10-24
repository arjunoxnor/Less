import type { JSONContent } from "@tiptap/core";
import type { TextStyleRun } from "@/types/screenplay";

/**
 * Bold, italic, underline and highlight on a script line, as the exporters
 * see them: stretches of the line's text (ScriptLine.marks), never markers
 * inside it. Everything that reads a line's words (pagination, the diff, the
 * breakdown, CONT'D, the page lock) keeps reading plain `text`, so formatting
 * can never move a page break; only the renderers (PDF, Final Draft, Fountain)
 * and the importers look at the stretches.
 */

export interface CharStyle {
  bold?: true;
  italic?: true;
  underline?: true;
  /** "#rrggbb". */
  highlight?: string;
}

/** A colour as "#rrggbb" (lower case), or undefined when it is not one. */
export function cleanHex(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return "#" + [...s.slice(1)].map((c) => c + c).join("");
  return undefined;
}

export const isPlainStyle = (s: CharStyle | undefined) => !s || (!s.bold && !s.italic && !s.underline && !s.highlight);

export const sameStyle = (a: CharStyle | undefined, b: CharStyle | undefined) =>
  !!a?.bold === !!b?.bold &&
  !!a?.italic === !!b?.italic &&
  !!a?.underline === !!b?.underline &&
  (a?.highlight ?? "") === (b?.highlight ?? "");

const styleOf = (r: CharStyle): CharStyle => ({
  ...(r.bold ? { bold: true as const } : {}),
  ...(r.italic ? { italic: true as const } : {}),
  ...(r.underline ? { underline: true as const } : {}),
  ...(r.highlight ? { highlight: r.highlight } : {}),
});

/** The style a text node's marks give it. */
function styleOfMarks(marks: JSONContent["marks"]): CharStyle {
  const s: CharStyle = {};
  for (const m of marks ?? []) {
    if (m.type === "bold") s.bold = true;
    else if (m.type === "italic") s.italic = true;
    else if (m.type === "underline") s.underline = true;
    else if (m.type === "highlight") s.highlight = cleanHex(m.attrs?.color) ?? "#fff1a8";
  }
  return s;
}

/** Runs kept within the text, empty ones dropped, neighbours of one style joined. */
export function normalizeRuns(runs: readonly TextStyleRun[] | undefined, length: number): TextStyleRun[] {
  const out: TextStyleRun[] = [];
  const sorted = [...(runs ?? [])].sort((a, b) => a.from - b.from);
  for (const r of sorted) {
    const from = Math.max(0, Math.min(length, Math.round(r.from)));
    const to = Math.max(from, Math.min(length, Math.round(r.to)));
    const style = styleOf({ ...r, highlight: cleanHex(r.highlight) });
    if (to <= from || isPlainStyle(style)) continue;
    const last = out[out.length - 1];
    if (last && last.to >= from && sameStyle(last, style)) last.to = Math.max(last.to, to);
    else out.push({ from: Math.max(from, last?.to ?? 0), to, ...style });
  }
  return out.filter((r) => r.to > r.from);
}

/** The styled stretches of a line node's text (offsets as lineText counts them). */
export function runsFromLine(node: JSONContent): TextStyleRun[] {
  const runs: TextStyleRun[] = [];
  let at = 0;
  const visit = (n?: JSONContent) => {
    if (!n) return;
    if (n.type === "text" && n.text) {
      const style = styleOfMarks(n.marks);
      if (!isPlainStyle(style)) runs.push({ from: at, to: at + n.text.length, ...style });
      at += n.text.length;
    }
    n.content?.forEach(visit);
  };
  node.content?.forEach(visit);
  return normalizeRuns(runs, at);
}

/** A line's text cut where its style changes: every piece with its style. */
export function segments(text: string, runs: readonly TextStyleRun[] | undefined): { text: string; style: CharStyle }[] {
  const clean = normalizeRuns(runs, text.length);
  if (clean.length === 0) return text ? [{ text, style: {} }] : [];
  const out: { text: string; style: CharStyle }[] = [];
  let at = 0;
  for (const r of clean) {
    if (r.from > at) out.push({ text: text.slice(at, r.from), style: {} });
    out.push({ text: text.slice(r.from, r.to), style: styleOf(r) });
    at = r.to;
  }
  if (at < text.length) out.push({ text: text.slice(at), style: {} });
  return out;
}

/** Text nodes, with marks, for a line's text and stretches (the editor's shape). */
export function nodesFromRuns(text: string, runs: readonly TextStyleRun[] | undefined): JSONContent[] {
  return segments(text, runs).map(({ text: t, style }) => {
    const marks: NonNullable<JSONContent["marks"]> = [];
    if (style.bold) marks.push({ type: "bold" });
    if (style.italic) marks.push({ type: "italic" });
    if (style.underline) marks.push({ type: "underline" });
    if (style.highlight) marks.push({ type: "highlight", attrs: { color: style.highlight } });
    return marks.length ? { type: "text", text: t, marks } : { type: "text", text: t };
  });
}

/** Each character's style (by UTF-16 offset). */
export function charStyles(length: number, runs: readonly TextStyleRun[] | undefined): (CharStyle | undefined)[] {
  const out: (CharStyle | undefined)[] = new Array(length).fill(undefined);
  for (const r of normalizeRuns(runs, length)) {
    const style = styleOf(r);
    for (let i = r.from; i < r.to; i++) out[i] = style;
  }
  return out;
}

/** Stretches moved by `shift` characters and kept within a text of `length`. */
export function shiftRuns(runs: readonly TextStyleRun[], shift: number, length: number): TextStyleRun[] {
  return normalizeRuns(
    runs.map((r) => ({ ...r, from: r.from + shift, to: r.to + shift })),
    length
  );
}
