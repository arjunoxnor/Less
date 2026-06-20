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
 * fingerprint the first source line of every page and remember that page's
 * locked number. On any later pagination we relabel the freshly laid-out pages
 * by walking those anchors in order. A page whose opening line matches the next
 * locked anchor keeps that locked number; a page that opens with new content
 * (an inserted page) takes the previous locked number plus the next letter.
 */

/** One frozen page: the locked integer number + a fingerprint of its first line. */
export interface PageAnchor {
  page: number;
  sig: string;
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
  for (const p of pages) {
    if (p.startLine == null) continue;
    const line = lines[p.startLine];
    if (!line) continue;
    anchors.push({ page: p.number, sig: lineSignature(line) });
  }
  return { lockedAt: meta.lockedAt, revision: meta.revision, anchors };
}

// How far ahead we will look to re-sync after a locked page is deleted, so a
// small cut does not strand every following page on a runaway letter sequence.
const RESYNC_WINDOW = 4;

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

  for (const p of pages) {
    const line = p.startLine != null ? lines[p.startLine] : undefined;
    const sig = line ? lineSignature(line) : null;

    // Match the next anchor, or look a short way ahead to recover from a cut
    // locked page. We never scan backward, so numbers stay monotonic.
    let matchedIdx = -1;
    if (sig) {
      const end = Math.min(anchors.length, ai + 1 + RESYNC_WINDOW);
      for (let k = ai; k < end; k++) {
        if (anchors[k].sig === sig) {
          matchedIdx = k;
          break;
        }
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
