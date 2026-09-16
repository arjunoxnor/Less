import type { JSONContent } from "@tiptap/core";

/**
 * The voice-script state machine, encoded as plain lines inside the document.
 *
 * Why in the document and not a column: the cloud row shape is fixed (the Pages
 * Function in `functions/api/**` is frozen), and `content` is the one field that
 * already round-trips through every save, sync and conflict path we have. So the
 * document IS the state. That buys three things:
 *
 *  1. No migration, no API change, no new endpoint.
 *  2. The writer can SEE the state. A stuck job looks like a line of text saying
 *     what it is waiting for, not a spinner with no explanation.
 *  3. Failure is legible. If the worker dies mid-job the document still reads as
 *     ordinary prose with a marker in it, and nothing is lost.
 *
 * A marker is a whole line beginning with "/// ". Screenplay prose never starts
 * that way, and the writer can type one by hand if a button ever fails them.
 */

export const MARKER_PREFIX = "/// ";
export const PROCESS = "/// PROCESS";
export const WORKING = "/// WORKING";
export const PROCESSED_PREFIX = "/// PROCESSED ";
export const RAW = "/// RAW";
export const ERROR_PREFIX = "/// ERROR ";

/**
 * idle    nothing asked for; the writer is still talking.
 * pending the writer pressed Process. The worker has not picked it up yet.
 * working the worker has it. This is the liveness signal: if the Mac is asleep,
 *         "pending" never becomes "working" and the UI can say so honestly.
 * error   the worker failed and said why, in the document.
 */
export type VoiceState = "idle" | "pending" | "working" | "error";

export interface VoiceDoc {
  state: VoiceState;
  /** The words waiting to be structured: everything after the last PROCESSED
      boundary, with control markers removed. */
  pending: string[];
  /** Line index of the live control marker (PROCESS / WORKING / ERROR), else -1. */
  controlLine: number;
  errorMessage?: string;
}

export function isMarker(line: string): boolean {
  return line.startsWith(MARKER_PREFIX) || line.trim() === MARKER_PREFIX.trim();
}

/** A plain document is a flat list of paragraphs, so a line maps to a block. */
export function docToLines(doc: JSONContent): string[] {
  const read = (node?: JSONContent): string => {
    if (!node) return "";
    if (node.type === "text") return node.text ?? "";
    if (node.type === "hardBreak") return "\n";
    return (node.content ?? []).map(read).join("");
  };
  const out: string[] = [];
  for (const block of doc.content ?? []) {
    // A hard break inside one paragraph is still a new line to the writer.
    out.push(...read(block).split("\n"));
  }
  return out;
}

export function linesToDoc(lines: string[]): JSONContent {
  return {
    type: "doc",
    content: lines.map((line) =>
      line.length
        ? { type: "paragraph", content: [{ type: "text", text: line }] }
        : { type: "paragraph" }
    ),
  };
}

/**
 * A boundary only counts if the worker could plausibly have written it: the
 * payload must be a strict ISO instant.
 *
 * Without this check, a "/// PROCESSED 1999" line anywhere in the writer's own
 * text (pasted from an old note, or dictated as a joke) would be read as the
 * real boundary, and every word ABOVE it would be silently treated as already
 * done and never processed. Losing words without saying so is the one failure
 * this feature cannot have.
 */
export function isBoundary(line: string): boolean {
  if (!line.startsWith(PROCESSED_PREFIX)) return false;
  const stamp = line.slice(PROCESSED_PREFIX.length).trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(stamp)) return false;
  return !Number.isNaN(Date.parse(stamp));
}

/** Index of the last genuine PROCESSED boundary, or -1 when nothing has run. */
function lastBoundary(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isBoundary(lines[i])) return i;
  }
  return -1;
}

export function readVoiceDoc(lines: string[]): VoiceDoc {
  const start = lastBoundary(lines) + 1;
  const region = lines.slice(start);

  let state: VoiceState = "idle";
  let controlLine = -1;
  let errorMessage: string | undefined;

  // The newest control marker wins, so a re-press after an error is honoured.
  for (let i = region.length - 1; i >= 0; i--) {
    const line = region[i];
    if (line === WORKING) {
      state = "working";
      controlLine = start + i;
      break;
    }
    if (line === PROCESS) {
      state = "pending";
      controlLine = start + i;
      break;
    }
    if (line.startsWith(ERROR_PREFIX)) {
      state = "error";
      controlLine = start + i;
      errorMessage = line.slice(ERROR_PREFIX.length).trim();
      break;
    }
  }

  const pending = region.filter((l) => !isMarker(l));
  // Blank paragraphs bracketing the region are spacing left by the previous
  // result and the writer's own cursor, not words anyone dictated.
  while (pending.length && !pending[pending.length - 1].trim()) pending.pop();
  while (pending.length && !pending[0].trim()) pending.shift();

  return { state, pending, controlLine, errorMessage };
}

/** Append a Process request. A no-op when one is already in flight, so a double
    tap cannot queue the same words twice. */
export function requestProcess(lines: string[]): string[] {
  const { state } = readVoiceDoc(lines);
  if (state === "pending" || state === "working") return lines;
  const out = lines.slice();
  while (out.length && !out[out.length - 1].trim()) out.pop();
  out.push(PROCESS);
  return out;
}

/** Claim the job. Replacing PROCESS with WORKING in the document is what tells
    the writer, on another machine, that this Mac is actually awake. */
export function markWorking(lines: string[]): string[] {
  const { state, controlLine } = readVoiceDoc(lines);
  if (state !== "pending" || controlLine < 0) return lines;
  const out = lines.slice();
  out[controlLine] = WORKING;
  return out;
}

/** Marker-looking text in the writer's own words would corrupt the state, so it
    is nudged one space right. Their words are kept, exactly. */
function defuse(line: string): string {
  return isMarker(line) ? " " + line : line;
}

/**
 * Replace the unprocessed region with the formatted result, keeping the writer's
 * original words underneath it. Nothing they said is ever discarded: the raw
 * block is the receipt they can check the formatting against.
 */
export function applyResult(
  lines: string[],
  formatted: string[],
  raw: string[],
  at: string
): string[] {
  const start = lastBoundary(lines) + 1;
  const kept = lines.slice(0, start);
  return [
    ...kept,
    ...formatted,
    "",
    RAW,
    ...raw.map(defuse),
    `${PROCESSED_PREFIX}${at}`,
    "",
  ];
}

/** Record a failure where the writer will see it, leaving their words untouched
    so pressing Process again retries the same input. */
export function markError(lines: string[], message: string): string[] {
  const { controlLine } = readVoiceDoc(lines);
  const clean = message.replace(/\s+/g, " ").trim().slice(0, 200);
  const out = lines.slice();
  if (controlLine >= 0) out[controlLine] = `${ERROR_PREFIX}${clean}`;
  else out.push(`${ERROR_PREFIX}${clean}`);
  return out;
}
