/**
 * Where a paragraph may break across a page boundary.
 *
 * Final Draft and Arc Studio break dialogue (and action) only at the end of a
 * sentence, never in the middle of one. The sentence that ends the page may end
 * part way along a line: the line simply stops there, and the next sentence
 * starts a fresh line on the next page, wrapped from its own first word. At
 * least two lines must stay on each side of the break.
 *
 * Measured against Arjun's own 81-page script exported from Arc Studio
 * (lib/export/fixtures/arc-gooa.json): with these rules, and the rest of the
 * engine's, every page starts on exactly the line Arc Studio starts it on.
 *
 * Pure and shared: the PDF engine (lib/export/paginate.ts) feeds it rows from
 * its monospace wrap, and the on-screen engine (lib/editor/pagination.ts) feeds
 * it rows measured the same way, so the two always agree on where a speech
 * breaks.
 */

/** A legal place to break: `before` rows stay on this page, `after` rows carry
    to the next, and the carried text starts at `offset`. */
export interface SplitOption {
  before: number;
  after: number;
  offset: number;
}

/** Rows each side of a break must keep (a lone line is a widow or an orphan). */
export const MIN_SPLIT_LINES = 2;

/*
 * The end of a sentence: terminal punctuation (and any closing quotes or
 * brackets after it), an ellipsis, or a dash, followed by whitespace. An
 * abbreviation such as "Mr." also qualifies; Final Draft makes the same call.
 */
const SENTENCE_END = /[.!?…]+["'”’)\]]*(?=\s)|(?:--|–|—)(?=\s)/g;
const SPACE = /\s/;

/**
 * Offsets where a continuation could start: just past the whitespace that
 * follows the end of each sentence. The end of the text is never included
 * (nothing would carry), and neither is a break with only spaces after it.
 */
export function sentenceBreaks(text: string): number[] {
  const out: number[] = [];
  SENTENCE_END.lastIndex = 0;
  for (let m = SENTENCE_END.exec(text); m; m = SENTENCE_END.exec(text)) {
    let i = m.index + m[0].length;
    while (i < text.length && SPACE.test(text[i])) i++;
    if (i < text.length && out[out.length - 1] !== i) out.push(i);
  }
  return out;
}

/**
 * Every sentence break in `text` with the rows it would leave on each side,
 * given a function that counts the rows a piece of text wraps to.
 */
export function splitOptions(text: string, rowsOf: (piece: string) => number): SplitOption[] {
  return sentenceBreaks(text).map((offset) => ({
    before: rowsOf(text.slice(0, offset)),
    after: rowsOf(text.slice(offset)),
    offset,
  }));
}

/**
 * The best legal break that fits in `room` rows: the one that keeps the most
 * text on this page (the latest sentence among those on the same last line),
 * with at least MIN_SPLIT_LINES rows on each side. Null when none fits.
 */
export function chooseSplit(options: SplitOption[], room: number): SplitOption | null {
  let best: SplitOption | null = null;
  for (const o of options) {
    if (o.before < MIN_SPLIT_LINES || o.after < MIN_SPLIT_LINES || o.before > room) continue;
    if (!best || o.before > best.before || (o.before === best.before && o.offset > best.offset)) {
      best = o;
    }
  }
  return best;
}

/**
 * The fewest rows a split could leave on the first page, or null when the text
 * cannot legally split at all. A character cue reserves this much room for its
 * speech below it, so a cue is never stranded above a speech that cannot start
 * on the same page.
 */
export function firstSplitRows(options: SplitOption[]): number | null {
  let min: number | null = null;
  for (const o of options) {
    if (o.before < MIN_SPLIT_LINES || o.after < MIN_SPLIT_LINES) continue;
    if (min == null || o.before < min) min = o.before;
  }
  return min;
}
