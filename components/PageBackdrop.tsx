"use client";

import { memo } from "react";
import { PAGE_H, STRIDE } from "@/lib/editor/pagination";

/**
 * The white page sheets drawn behind the editor text. The pagination plugin
 * inserts spacers so the text lands within these sheets and the gaps between
 * them stay empty.
 *
 * A screenplay numbers its pages the way the printed script does: "2." at the
 * top right, in the script's own 12pt Courier, half an inch down and aligned
 * to the right margin, with no number on page 1. A document keeps a quiet
 * number in the bottom corner.
 */
export const PageBackdrop = memo(function PageBackdrop({
  pages,
  variant = "document",
}: {
  pages: number;
  variant?: "screenplay" | "document";
}) {
  const n = Number.isFinite(pages) ? Math.max(1, Math.ceil(pages)) : 1;
  return (
    <div className={"page-backdrop page-backdrop-" + variant} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <div className="page-sheet" key={i} style={{ top: i * STRIDE, height: PAGE_H }}>
          {variant === "screenplay" ? (
            i > 0 && <span className="page-sheet-num">{i + 1}.</span>
          ) : (
            <span className="page-sheet-num">{i + 1}</span>
          )}
        </div>
      ))}
    </div>
  );
});
