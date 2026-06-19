"use client";

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { debounce } from "@/lib/storage/localStore";
import { buildOutline, EMPTY_OUTLINE } from "./outline";
import type { Outline } from "@/types/screenplay";

/**
 * One shared, debounced subscription that re-derives the whole outline whenever
 * the document changes. All navigation panels read from this single snapshot
 * instead of each attaching its own editor listener. Re-deriving from the live
 * doc keeps scene jump positions current.
 */
export function useOutline(editor: Editor | null): Outline {
  const [outline, setOutline] = useState<Outline>(EMPTY_OUTLINE);

  useEffect(() => {
    if (!editor) return;
    const recompute = () => setOutline(buildOutline(editor.state.doc));
    const debounced = debounce(recompute, 120);
    recompute(); // immediate, covers the already-created editor
    editor.on("update", debounced);
    editor.on("create", debounced);
    return () => {
      debounced.cancel();
      editor.off("update", debounced);
      editor.off("create", debounced);
    };
  }, [editor]);

  return outline;
}
