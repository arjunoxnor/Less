import type { JSONContent } from "@tiptap/core";
import { isElementType } from "@/lib/export/flatten";
import type { ElementType } from "./elements";

/**
 * What changed between two versions of a script, line by line, the way a
 * writer reads a revision: lines cut, lines added, and lines reworded (with
 * the words that changed inside them). Pure and synchronous.
 */

export interface DiffLine {
  element: ElementType;
  text: string;
}

export interface WordPart {
  kind: "same" | "added" | "removed";
  text: string;
}

export type DiffRow =
  | { kind: "same"; line: DiffLine }
  | { kind: "added"; line: DiffLine }
  | { kind: "removed"; line: DiffLine }
  | { kind: "changed"; before: DiffLine; after: DiffLine; words: WordPart[] };

export interface DiffSummary {
  added: number;
  removed: number;
  changed: number;
  /** Scenes (in the newer version) that hold any change. */
  scenesChanged: number;
}

/** The lines of a stored document, in order. */
export function linesFromDoc(doc: JSONContent | null | undefined): DiffLine[] {
  const out: DiffLine[] = [];
  for (const node of doc?.content ?? []) {
    const raw = (node.attrs as { element?: unknown } | undefined)?.element;
    const element: ElementType = isElementType(raw) ? raw : "action";
    let text = "";
    const walk = (n: JSONContent) => {
      if (n.type === "text" && n.text) text += n.text;
      else if (n.type === "hardBreak") text += "\n";
      n.content?.forEach(walk);
    };
    walk(node);
    out.push({ element, text });
  }
  return out;
}

type Op = "same" | "added" | "removed";

/**
 * Myers' shortest edit script over two sequences compared by key. Common
 * starts and ends are peeled off first (most revisions touch a small part of
 * a script). Returns null when the edit distance passes `limit`: two scripts
 * that different are shown as one replaced by the other.
 */
function editScript(a: string[], b: string[], limit: number): Op[] | null {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const A = a.slice(start, endA);
  const B = b.slice(start, endB);
  const n = A.length;
  const m = B.length;
  const middle: Op[] = [];
  if (n === 0 || m === 0) {
    for (let i = 0; i < n; i++) middle.push("removed");
    for (let j = 0; j < m; j++) middle.push("added");
  } else {
    // rounds[d][k + d] is the furthest x reached on diagonal k after d edits.
    // Only diagonals -d..d exist after d edits, so each round keeps just those:
    // memory grows with the square of the edit count, not with script length.
    const rounds: Int32Array[] = [];
    let found = -1;
    for (let d = 0; d <= limit && found < 0; d++) {
      const prev = rounds[d - 1];
      const cur = new Int32Array(2 * d + 1);
      for (let k = -d; k <= d; k += 2) {
        let x: number;
        if (d === 0) x = 0;
        else if (k === -d || (k !== d && prev[k - 1 + d - 1] < prev[k + 1 + d - 1])) {
          x = prev[k + 1 + d - 1];
        } else {
          x = prev[k - 1 + d - 1] + 1;
        }
        let y = x - k;
        while (x < n && y < m && A[x] === B[y]) {
          x++;
          y++;
        }
        cur[k + d] = x;
        if (x >= n && y >= m) {
          found = d;
          break;
        }
      }
      rounds.push(cur);
    }
    if (found < 0) return null;
    // Walk back from the end to the start, one edit per round.
    let x = n;
    let y = m;
    const back: Op[] = [];
    for (let d = found; d > 0; d--) {
      const prev = rounds[d - 1];
      const k = x - y;
      const prevK =
        k === -d || (k !== d && prev[k - 1 + d - 1] < prev[k + 1 + d - 1]) ? k + 1 : k - 1;
      const prevX = prev[prevK + d - 1];
      const prevY = prevX - prevK;
      while (x > prevX && y > prevY) {
        back.push("same");
        x--;
        y--;
      }
      back.push(x === prevX ? "added" : "removed");
      x = prevX;
      y = prevY;
    }
    while (x > 0 && y > 0) {
      back.push("same");
      x--;
      y--;
    }
    middle.push(...back.reverse());
  }
  const ops: Op[] = [];
  for (let i = 0; i < start; i++) ops.push("same");
  ops.push(...middle);
  for (let i = endA; i < a.length; i++) ops.push("same");
  return ops;
}

const WORDS = /(\s+)/;

/** The words that changed inside a reworded line. */
export function diffWords(before: string, after: string): WordPart[] {
  const a = before.split(WORDS).filter((t) => t !== "");
  const b = after.split(WORDS).filter((t) => t !== "");
  const ops = editScript(a, b, 400) ?? [
    ...a.map((): Op => "removed"),
    ...b.map((): Op => "added"),
  ];
  const parts: WordPart[] = [];
  let i = 0;
  let j = 0;
  for (const op of ops) {
    const text = op === "added" ? b[j++] : op === "removed" ? a[i++] : (j++, a[i++]);
    const last = parts[parts.length - 1];
    if (last && last.kind === op) last.text += text;
    else parts.push({ kind: op, text });
  }
  return parts;
}

/** How alike two lines are, 0 to 1, by the words they share. */
function similarity(a: string, b: string): number {
  const wa = a.toLowerCase().split(/\s+/).filter(Boolean);
  const wb = b.toLowerCase().split(/\s+/).filter(Boolean);
  if (!wa.length || !wb.length) return a.trim() === b.trim() ? 1 : 0;
  const pool = new Map<string, number>();
  for (const w of wa) pool.set(w, (pool.get(w) ?? 0) + 1);
  let shared = 0;
  for (const w of wb) {
    const left = pool.get(w) ?? 0;
    if (left > 0) {
      shared++;
      pool.set(w, left - 1);
    }
  }
  return (2 * shared) / (wa.length + wb.length);
}

const key = (line: DiffLine) => line.element + "\u0001" + line.text;

/** Compare two versions of a script, older first. */
export function diffScripts(before: DiffLine[], after: DiffLine[]): DiffRow[] {
  const ops = editScript(before.map(key), after.map(key), 2000) ?? [
    ...before.map((): Op => "removed"),
    ...after.map((): Op => "added"),
  ];
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  let k = 0;
  while (k < ops.length) {
    if (ops[k] === "same") {
      rows.push({ kind: "same", line: after[j] });
      i++;
      j++;
      k++;
      continue;
    }
    // A run of cuts and additions between two unchanged lines: pair a cut line
    // with the added line of the same kind that reads most like it, in order,
    // so a reworded line shows as one line with its changed words.
    const removed: DiffLine[] = [];
    const added: DiffLine[] = [];
    while (k < ops.length && ops[k] !== "same") {
      if (ops[k] === "removed") removed.push(before[i++]);
      else added.push(after[j++]);
      k++;
    }
    let nextAdded = 0;
    const pairOf = new Map<number, number>(); // added index -> removed index
    removed.forEach((line, r) => {
      for (let x = nextAdded; x < added.length; x++) {
        if (added[x].element === line.element && similarity(line.text, added[x].text) >= 0.35) {
          pairOf.set(x, r);
          nextAdded = x + 1;
          return;
        }
      }
    });
    // Interleave so each cut sits just before the addition that replaced it.
    let r = 0;
    for (let x = 0; x < added.length; x++) {
      const pairedWith = pairOf.get(x);
      if (pairedWith !== undefined) {
        while (r < pairedWith) rows.push({ kind: "removed", line: removed[r++] });
        rows.push({
          kind: "changed",
          before: removed[r],
          after: added[x],
          words: diffWords(removed[r].text, added[x].text),
        });
        r++;
      } else {
        rows.push({ kind: "added", line: added[x] });
      }
    }
    while (r < removed.length) rows.push({ kind: "removed", line: removed[r++] });
  }
  return rows;
}

/** Counts for the comparison header. */
export function summarize(rows: DiffRow[]): DiffSummary {
  let added = 0;
  let removed = 0;
  let changed = 0;
  let scenesChanged = 0;
  let sceneHasChange = false;
  const close = () => {
    if (sceneHasChange) scenesChanged++;
    sceneHasChange = false;
  };
  for (const row of rows) {
    const line = row.kind === "changed" ? row.after : row.line;
    if (line.element === "scene_heading" && row.kind !== "removed") close();
    if (row.kind === "added") added++;
    else if (row.kind === "removed") removed++;
    else if (row.kind === "changed") changed++;
    if (row.kind !== "same") sceneHasChange = true;
  }
  close();
  return { added, removed, changed, scenesChanged };
}
