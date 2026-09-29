import type { JSONContent } from "@tiptap/core";

/**
 * The Mac's half of a voice note, as pure functions, so they can be tested
 * and so tools/voice/voice.ts only does I/O:
 *
 *   rawTranscript   whisper's timed segments as readable paragraphs: the
 *                   original transcript, kept in the note for "Original"
 *   blocksFromText  the cleaned-up text as document paragraphs
 *   deliverNote     swap a pending card in a saved document for the
 *                   transcribed note, changing nothing else
 */

export const VOICE_NOTE_ID = /^[a-f0-9]{32}$/;

export interface Segment {
  /** Milliseconds from the start of the recording. */
  from: number;
  to: number;
  text: string;
}

/** Whisper's markers for stretches with no words in them. */
const NON_SPEECH = /^\s*[[(]\s*(blank_audio|silence|music|noise|inaudible|no speech|pause)\s*[\])]\s*$/i;

/**
 * Segments as paragraphs: a pause of `pauseMs` or more starts a new one, which
 * is roughly where a speaker changes thought.
 */
export function rawTranscript(segments: readonly Segment[], pauseMs = 1500): string {
  const paragraphs: string[][] = [];
  let lastEnd = Number.NEGATIVE_INFINITY;
  for (const segment of segments) {
    const text = segment.text.replace(/\s+/g, " ").trim();
    if (!text || NON_SPEECH.test(text)) continue;
    if (paragraphs.length === 0 || segment.from - lastEnd >= pauseMs) paragraphs.push([]);
    paragraphs[paragraphs.length - 1].push(text);
    lastEnd = segment.to;
  }
  return paragraphs.map((p) => p.join(" ")).join("\n\n");
}

const textNode = (text: string): JSONContent => ({ type: "text", text });
const paragraph = (text: string): JSONContent =>
  text ? { type: "paragraph", content: [textNode(text)] } : { type: "paragraph" };

/**
 * The cleaned text as blocks. A blank line separates paragraphs; lines within
 * one are joined. A block whose every line starts with "- " is a bulleted list.
 */
export function blocksFromText(text: string): JSONContent[] {
  const blocks = text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((block) => block.split("\n").map((line) => line.trim()).filter(Boolean))
    .filter((lines) => lines.length > 0);
  return blocks.map((lines) => {
    if (lines.every((line) => /^[-*•]\s+/.test(line))) {
      return {
        type: "bulletList",
        content: lines.map((line) => ({
          type: "listItem",
          content: [paragraph(line.replace(/^[-*•]\s+/, ""))],
        })),
      };
    }
    return paragraph(lines.join(" ").replace(/\s+/g, " "));
  });
}

export interface PendingInDoc {
  id: string;
  attrs: Record<string, unknown>;
}

/** Every pending card in a saved document, in reading order. */
export function pendingNotes(doc: JSONContent): PendingInDoc[] {
  const out: PendingInDoc[] = [];
  const walk = (node: JSONContent) => {
    if (node.type === "voicePending") {
      const id = node.attrs?.id;
      if (typeof id === "string" && VOICE_NOTE_ID.test(id)) out.push({ id, attrs: node.attrs ?? {} });
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(doc);
  return out;
}

/**
 * Replace the pending card `id` with its transcribed note. Returns null when
 * that card is not in the document (already delivered, or deleted by the
 * writer). The rest of the document comes back exactly as it went in.
 */
export function deliverNote(
  doc: JSONContent,
  id: string,
  raw: string,
  clean: string,
  opts: { durationMs?: number } = {}
): JSONContent | null {
  if (!VOICE_NOTE_ID.test(id)) return null;
  const blocks = blocksFromText(clean);
  let found = false;

  const swap = (node: JSONContent): JSONContent => {
    if (node.type === "voicePending" && node.attrs?.id === id && !found) {
      found = true;
      const a = node.attrs ?? {};
      const recorded = Number(a.duration);
      return {
        type: "voiceNote",
        attrs: {
          id,
          mime: typeof a.mime === "string" ? a.mime : "",
          duration: Number.isFinite(recorded) && recorded > 0 ? recorded : Math.max(0, Math.round(opts.durationMs ?? 0)),
          recordedAt: typeof a.recordedAt === "string" ? a.recordedAt : "",
          peaks: typeof a.peaks === "string" ? a.peaks : "",
          raw,
        },
        content: blocks.length ? blocks : [paragraph("")],
      };
    }
    if (!node.content) return node;
    return { ...node, content: node.content.map(swap) };
  };

  const next = swap(doc);
  if (!found) return null;
  // Room to keep writing below a note that ends the document.
  const top = next.content ?? [];
  if (top.length && top[top.length - 1].type === "voiceNote") {
    next.content = [...top, { type: "paragraph" }];
  }
  return next;
}
