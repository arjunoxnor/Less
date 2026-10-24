import type { ScriptLine } from "@/types/screenplay";
import { ensureParentheticalParens } from "./flatten";
import { graphemes } from "./layout";
import { charStyles, isPlainStyle, sameStyle, type CharStyle } from "./styleRuns";

/**
 * Formatting for the PDF, found after the pages are laid out. Pagination
 * works on plain text (so a bold word can never move a page break); each
 * printed row says which source line it came from (DrawOp.src), and its words
 * are matched, in order, against that line's words to find their styles. A
 * word the layout supplied itself (CONT'D) matches nothing and prints plain.
 */

export interface StyledPiece {
  text: string;
  /** Columns from the row's start. */
  col: number;
  /** Columns wide. */
  cols: number;
  style: CharStyle;
}

interface Word {
  word: string;
  styles: (CharStyle | undefined)[];
}

/**
 * A function from (source line, row text) to the row cut into styled pieces,
 * or null when the row is plain. Rows of one line must be asked in print
 * order, which is the order the pages hold them.
 */
export function makeRowStyler(
  lines: readonly ScriptLine[],
  clean: (text: string) => string
): (src: number, row: string) => StyledPiece[] | null {
  const queues = new Map<number, { words: Word[]; i: number; off: number }>();
  const queueFor = (src: number) => {
    let q = queues.get(src);
    if (q) return q;
    q = { words: [], i: 0, off: 0 };
    queues.set(src, q);
    const line = lines[src];
    if (!line?.marks?.length) return q;
    // The line as the paginator printed it: brackets supplied, then cleaned
    // one character at a time so every printed character keeps its style.
    const printed = line.element === "parenthetical" ? ensureParentheticalParens(line.text) : line.text;
    if (printed !== line.text) return q; // the styles no longer line up: print it plain
    const styles = charStyles(printed.length, line.marks);
    let text = "";
    const out: (CharStyle | undefined)[] = [];
    let at = 0;
    for (const ch of printed) {
      const piece = clean(ch);
      text += piece;
      for (let k = 0; k < piece.length; k++) out.push(styles[at]);
      at += ch.length;
    }
    for (const m of text.matchAll(/\S+/g)) {
      q.words.push({ word: m[0], styles: out.slice(m.index!, m.index! + m[0].length) });
    }
    return q;
  };

  return (src, row) => {
    const q = queueFor(src);
    if (q.words.length === 0) return null;
    const styles: (CharStyle | undefined)[] = new Array(row.length).fill(undefined);
    let any = false;
    for (const m of row.matchAll(/\S+/g)) {
      const word = q.words[q.i];
      if (!word) break;
      const rest = word.word.slice(q.off);
      const token = m[0];
      if (!rest.startsWith(token)) continue; // supplied by the layout
      for (let k = 0; k < token.length; k++) {
        const s = word.styles[q.off + k];
        styles[m.index! + k] = s;
        if (!isPlainStyle(s)) any = true;
      }
      if (token.length === rest.length) {
        q.i++;
        q.off = 0;
      } else {
        q.off += token.length;
      }
    }
    if (!any) return null;
    // An underline or a highlight carries across the space between two words
    // that share it, as one stroke (bold and italic have nothing to show there).
    for (let k = 0; k < row.length; k++) {
      if (styles[k] || !/\s/.test(row[k])) continue;
      const before = styles[k - 1];
      let j = k;
      while (j < row.length && /\s/.test(row[j])) j++;
      const after = styles[j];
      if (!before || !after) continue;
      const span: CharStyle = {};
      if (before.underline && after.underline) span.underline = true;
      if (before.highlight && before.highlight === after.highlight) span.highlight = before.highlight;
      if (!isPlainStyle(span)) for (let x = k; x < j; x++) styles[x] = span;
    }
    return piecesOf(row, styles);
  };
}

/** A row cut where its style changes, measured in columns (graphemes). */
export function piecesOf(row: string, styles: readonly (CharStyle | undefined)[]): StyledPiece[] {
  const pieces: StyledPiece[] = [];
  let at = 0;
  let col = 0;
  for (const g of graphemes(row)) {
    const style = styles[at] ?? {};
    const last = pieces[pieces.length - 1];
    if (last && sameStyle(last.style, style)) {
      last.text += g;
      last.cols++;
    } else {
      pieces.push({ text: g, col, cols: 1, style });
    }
    at += g.length;
    col++;
  }
  return pieces;
}
