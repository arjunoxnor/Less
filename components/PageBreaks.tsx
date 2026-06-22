"use client";

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";

/**
 * Visual page-break markers drawn over an editor page. The editor itself stays a
 * single continuous sheet (true reflow-pagination is not done), but a labeled
 * line is drawn at each US-Letter page boundary so the writer can see where the
 * printed pages break. Measured from the editable's height: one page of text is
 * 9in (the 11in sheet minus 1in top and bottom margins).
 *
 * The screenplay page uses exactly 54 lines per page (matching the paginate
 * engine), which at the 16px screen line-height is the same 9in / 864px, so the
 * markers line up with the real page count.
 */
export function PageBreaks({
  editor,
  pageHeight = 864, // 9in of text at 96dpi
  topOffset = 96, // 1in top margin
}: {
  editor: Editor | null;
  pageHeight?: number;
  topOffset?: number;
}) {
  const [tops, setTops] = useState<number[]>([]);

  useEffect(() => {
    const dom = editor?.view?.dom as HTMLElement | undefined;
    if (!dom) return;
    const measure = () => {
      const h = dom.scrollHeight;
      const out: number[] = [];
      for (let y = topOffset + pageHeight; y < h - 8; y += pageHeight) out.push(y);
      setTops(out);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(dom);
    const onUpdate = () => measure();
    editor?.on("update", onUpdate);
    measure();
    return () => {
      ro.disconnect();
      editor?.off("update", onUpdate);
    };
  }, [editor, pageHeight, topOffset]);

  return (
    <div className="page-breaks" aria-hidden="true">
      {tops.map((t, i) => (
        <div className="page-break" key={i} style={{ top: t }}>
          <span className="page-break-label">Page {i + 2}</span>
        </div>
      ))}
    </div>
  );
}
