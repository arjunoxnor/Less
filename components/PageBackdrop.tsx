"use client";

import { PAGE_H, STRIDE } from "@/lib/editor/pagination";

/**
 * The white page sheets drawn behind the editor text. Each sheet is a US-Letter
 * page with a soft shadow and a subtle page number in the bottom corner. The
 * pagination plugin inserts spacers so the text lands within these sheets and
 * the gaps between them stay empty.
 */
export function PageBackdrop({ pages }: { pages: number }) {
  const n = Math.max(1, pages);
  return (
    <div className="page-backdrop" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <div className="page-sheet" key={i} style={{ top: i * STRIDE, height: PAGE_H }}>
          <span className="page-sheet-num">{i + 1}</span>
        </div>
      ))}
    </div>
  );
}
