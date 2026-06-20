"use client";

import { ELEMENT_LABELS, type ElementType } from "@/lib/editor/elements";

/**
 * The thin bar along the bottom: live page count (1 page ≈ 1 minute of screen
 * time), word count, and which element the cursor is currently in.
 */
export function StatusBar({
  pageCount,
  pageTarget,
  wordCount,
  currentElement,
  saved,
  locked,
  lockRevision,
}: {
  pageCount: number;
  pageTarget?: number;
  wordCount: number;
  currentElement: ElementType;
  saved: boolean;
  locked?: boolean;
  lockRevision?: string;
}) {
  return (
    <div className="status-bar">
      <span className="status-item status-element">
        {ELEMENT_LABELS[currentElement]}
      </span>
      {locked && (
        <span className="status-item status-locked" title="Page numbers are locked. Inserted material takes A-page letters.">
          {lockRevision ? `Pages locked · ${lockRevision}` : "Pages locked"}
        </span>
      )}
      <span className="status-spacer" />
      <span className="status-item">{wordCount.toLocaleString()} words</span>
      <span className="status-item">
        {pageTarget ? (
          <>
            {pageCount} / {pageTarget} {pageTarget === 1 ? "page" : "pages"}
          </>
        ) : (
          <>
            {pageCount} {pageCount === 1 ? "page" : "pages"}
            <span className="status-sub"> · ~{pageCount} min</span>
          </>
        )}
      </span>
      <span className="status-item status-saved">
        {saved ? "Saved" : "Saving…"}
      </span>
    </div>
  );
}
