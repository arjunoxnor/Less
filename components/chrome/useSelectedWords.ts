"use client";

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";

/** How many words are selected, or null with nothing selected. */
export function useSelectedWords(editor: Editor | null): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const sync = () => {
      if (editor.isDestroyed) return;
      const { from, to, empty } = editor.state.selection;
      if (empty) return setCount(null);
      const text = editor.state.doc.textBetween(from, to, " ", " ").trim();
      setCount(text ? text.split(/\s+/).length : 0);
    };
    sync();
    editor.on("selectionUpdate", sync);
    editor.on("update", sync);
    return () => {
      editor.off("selectionUpdate", sync);
      editor.off("update", sync);
    };
  }, [editor]);
  return count;
}
