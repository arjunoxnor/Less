"use client";

import { useCallback, useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { findPluginKey, gotoMatch, replaceAll, replaceOne, setFindQuery } from "@/lib/editor/findPlugin";
import type { FindInputs } from "./FindReplacePanel";

/**
 * What the find panel needs from an editor, in a script or a document: the
 * inputs, the count and active match read back from the plugin, and the
 * actions. The matches show only while the panel is open.
 */
export function useFindReplace(editor: Editor | null, open: boolean) {
  const [findState, setFindState] = useState<FindInputs>({
    query: "",
    replace: "",
    caseSensitive: false,
    wholeWord: false,
    element: "all",
  });
  const [findMeta, setFindMeta] = useState({ matchCount: 0, activeIndex: 0 });

  useEffect(() => {
    if (!editor) return;
    if (open) {
      setFindQuery(editor.view, {
        query: findState.query,
        caseSensitive: findState.caseSensitive,
        wholeWord: findState.wholeWord,
        element: findState.element,
      });
    } else {
      setFindQuery(editor.view, { query: "" });
    }
  }, [editor, open, findState.query, findState.caseSensitive, findState.wholeWord, findState.element]);

  useEffect(() => {
    if (!editor) return;
    const sync = () => {
      const s = findPluginKey.getState(editor.state);
      if (!s) return;
      setFindMeta((prev) =>
        prev.matchCount === s.matches.length && prev.activeIndex === s.active
          ? prev
          : { matchCount: s.matches.length, activeIndex: s.active }
      );
    };
    sync();
    editor.on("transaction", sync);
    return () => {
      editor.off("transaction", sync);
    };
  }, [editor]);

  const activeIndex = useCallback(() => (editor ? findPluginKey.getState(editor.state)?.active ?? 0 : 0), [editor]);
  const onFindPrev = useCallback(() => {
    if (editor) gotoMatch(editor.view, activeIndex() - 1);
  }, [editor, activeIndex]);
  const onFindNext = useCallback(() => {
    if (editor) gotoMatch(editor.view, activeIndex() + 1);
  }, [editor, activeIndex]);
  const onReplaceOne = useCallback(() => {
    if (editor) replaceOne(editor.view, findState.replace);
  }, [editor, findState.replace]);
  const onReplaceAll = useCallback(
    () => (editor ? replaceAll(editor.view, findState.replace) : 0),
    [editor, findState.replace]
  );
  const setFindPatch = useCallback(
    (patch: Partial<FindInputs>) => setFindState((s) => ({ ...s, ...patch })),
    []
  );

  return { findState, setFindPatch, findMeta, onFindPrev, onFindNext, onReplaceOne, onReplaceAll };
}
