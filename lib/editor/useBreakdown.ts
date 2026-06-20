"use client";

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { debounce } from "@/lib/storage/localStore";
import { docToLines } from "@/lib/export/flatten";
import { computeBreakdown, EMPTY_BREAKDOWN, type BreakdownItem, type BreakdownResult } from "./breakdown";

/**
 * Debounced breakdown report for the panel. Only scans while `enabled` (the
 * panel is open), so a closed panel costs nothing; the in-script highlighting
 * is handled separately by the decoration plugin.
 */
export function useBreakdown(
  editor: Editor | null,
  items: BreakdownItem[],
  enabled: boolean
): BreakdownResult {
  const [result, setResult] = useState<BreakdownResult>(EMPTY_BREAKDOWN);

  useEffect(() => {
    if (!editor || !enabled) {
      setResult({ ...EMPTY_BREAKDOWN, itemCount: items.length });
      return;
    }
    const recompute = () => setResult(computeBreakdown(docToLines(editor.getJSON()), items));
    const debounced = debounce(recompute, 150);
    recompute();
    editor.on("update", debounced);
    return () => {
      debounced.cancel();
      editor.off("update", debounced);
    };
  }, [editor, items, enabled]);

  return result;
}
