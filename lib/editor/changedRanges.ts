import { getChangedRanges } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";

/** Changed ranges mapped into the final document of an appendTransaction batch. */
export function finalChangedRanges(
  transactions: readonly Transaction[],
  include: (transaction: Transaction) => boolean = () => true
): [number, number][] {
  const ranges: [number, number][] = [];
  for (let i = 0; i < transactions.length; i++) {
    const transaction = transactions[i];
    if (!include(transaction)) continue;
    for (const change of getChangedRanges(transaction)) {
      let from = change.newRange.from;
      let to = change.newRange.to;
      for (let j = i + 1; j < transactions.length; j++) {
        from = transactions[j].mapping.map(from, -1);
        to = transactions[j].mapping.map(to, 1);
      }
      ranges.push([from, to]);
    }
  }
  return ranges;
}

/** Whether a final-document node span intersects a changed range. */
export function rangeTouches(
  start: number,
  end: number,
  ranges: readonly [number, number][]
): boolean {
  return ranges.some(([from, to]) =>
    from === to
      ? from >= start && from <= end
      : from < end && to > start
  );
}

/** Top-level nodes intersecting the changed ranges, without walking the script. */
export function changedTopLevelNodes(
  doc: PMNode,
  ranges: readonly [number, number][]
): { node: PMNode; pos: number }[] {
  const found = new Map<number, PMNode>();
  for (const [rawFrom, rawTo] of ranges) {
    const from = Math.max(0, Math.min(rawFrom, doc.content.size));
    const to = Math.max(from, Math.min(rawTo, doc.content.size));
    const scanFrom = Math.max(0, from - 1);
    const scanTo = Math.min(doc.content.size, Math.max(to, from + 1));
    if (scanTo > scanFrom) {
      doc.nodesBetween(scanFrom, scanTo, (node, pos, parent) => {
        if (parent !== doc) return true;
        if (rangeTouches(pos, pos + node.nodeSize, [[from, to]])) {
          found.set(pos, node);
        }
        return false;
      });
    }
    if (from === doc.content.size && doc.lastChild) {
      const pos = doc.content.size - doc.lastChild.nodeSize;
      if (rangeTouches(pos, pos + doc.lastChild.nodeSize, [[from, to]])) {
        found.set(pos, doc.lastChild);
      }
    }
  }
  return [...found.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([pos, node]) => ({ pos, node }));
}
