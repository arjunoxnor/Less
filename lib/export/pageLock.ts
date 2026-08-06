import type { ScriptLine } from "@/types/screenplay";
import type { Page } from "./paginate";

/**
 * Page locking and A-pages.
 *
 * In film production a script is "locked" once it goes out to the crew, so that
 * a reference like "the fight on page 42" stays meaningful for everyone even as
 * later revisions add or cut material. After a lock, new material does NOT
 * renumber the whole script: instead the overflow gets a lettered page number
 * (42, 42A, 42B, 43...). Locking freezes the NUMBERS, never the layout.
 *
 * We implement this without persistent per-line identity: at lock time we
 * fingerprint the first source line of every page, plus a short context, and
 * remember that page's locked number. On later pagination we relabel the fresh
 * pages by walking those anchors in order. A page that matches an anchor keeps
 * that locked number; an inserted page takes the previous number plus a letter.
 */

/** One frozen page: its locked number, opening line, and optional context. */
export interface PageAnchor {
  page: number;
  sig: string;
  /** A few following source lines, used to disambiguate repeated page starts. */
  contextSig?: string;
}

export interface PageLock {
  /** ISO timestamp the lock was taken (the caller supplies it). */
  lockedAt: string;
  /** Optional colored-revision label for this lock ("Blue", "Pink", ...). */
  revision?: string;
  /** One anchor per locked page, in page order. */
  anchors: PageAnchor[];
}

/** A stable-ish fingerprint of a line: its element plus normalized text. */
export function lineSignature(line: ScriptLine): string {
  const t = (line.text ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return line.element + "|" + t;
}

/**
 * 1 -> "A", 26 -> "Z", 27 -> "AA", 28 -> "AB", ... Bijective base-26, the
 * convention used for A-pages (and spreadsheet columns).
 */
export function numberToLetters(n: number): string {
  let s = "";
  while (n > 0) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

/** Capture the current pagination as a lock: one anchor per page. */
export function capturePageLock(
  pages: Page[],
  lines: ScriptLine[],
  meta: { lockedAt: string; revision?: string }
): PageLock {
  const anchors: PageAnchor[] = [];
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (p.startLine == null) continue;
    const line = lines[p.startLine];
    if (!line) continue;
    const nextStart = pages[i + 1]?.startLine ?? lines.length;
    anchors.push({
      page: p.number,
      sig: lineSignature(line),
      contextSig: contextSignature(lines, p.startLine, nextStart),
    });
  }
  return { lockedAt: meta.lockedAt, revision: meta.revision, anchors };
}

function contextSignature(lines: ScriptLine[], start: number, end: number): string {
  return lines
    .slice(start, Math.min(end, start + 4))
    .map(lineSignature)
    .join("\n");
}

/**
 * Map each freshly-paginated page number to its display label under a lock.
 * Pure: pages and lines describe the CURRENT document; lock is the snapshot.
 */
export function labelLockedPages(
  pages: Page[],
  lines: ScriptLine[],
  lock: PageLock
): Map<number, string> {
  const labels = new Map<number, string>();
  const anchors = lock.anchors;
  let ai = 0; // next unconsumed locked anchor (monotonic)
  let base = 0; // current locked base page number
  let letter = 0; // A-page letters issued since the last matched anchor
  let started = false;

  for (let pi = 0; pi < pages.length; pi++) {
    const p = pages[pi];
    const line = p.startLine != null ? lines[p.startLine] : undefined;
    const sig = line ? lineSignature(line) : null;

    // Match the next anchor, or look ahead to recover from cut locked pages.
    // Context separates repeated opening lines where possible.
    let matchedIdx = -1;
    if (sig) {
      const candidates: number[] = [];
      for (let k = ai; k < anchors.length; k++) {
        if (anchors[k].sig === sig) {
          candidates.push(k);
        }
      }
      matchedIdx = candidates[0] ?? -1;
      if (candidates.length > 1 && p.startLine != null) {
        const nextStart = pages[pi + 1]?.startLine ?? lines.length;
        const context = contextSignature(lines, p.startLine, nextStart);
        const exact = candidates.find((k) => anchors[k].contextSig === context);
        if (exact !== undefined) matchedIdx = exact;
      }
    }

    if (matchedIdx >= 0) {
      base = anchors[matchedIdx].page;
      ai = matchedIdx + 1;
      letter = 0;
      started = true;
      labels.set(p.number, String(base));
    } else if (!started) {
      // Pages before the first matched anchor (rare): fall back to raw number.
      labels.set(p.number, String(p.number));
    } else {
      letter++;
      labels.set(p.number, String(base) + numberToLetters(letter));
    }
  }
  return labels;
}
