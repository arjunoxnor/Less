"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";

import { buildExtensions } from "@/lib/editor/buildExtensions";
import { SAMPLE_SCRIPT } from "@/lib/editor/sampleScript";
import { currentElementType } from "@/lib/editor/keymap";
import type { ElementType } from "@/lib/editor/elements";
import {
  DEFAULT_PREFS,
  debounce,
  loadDoc,
  loadPrefs,
  saveDoc,
  savePrefs,
  type Prefs,
} from "@/lib/storage/localStore";
import { modKeyLabel } from "@/lib/platform";
import { Toolbar } from "./Toolbar";
import { StatusBar } from "./StatusBar";

// Page geometry for the live page-count estimate. US Letter at 96 CSS px/inch:
// the page is 11in tall with 1in top + 1in bottom margins, leaving 9in of
// printable content per page. (Real, rule-aware pagination — no orphaned cues,
// (MORE)/(CONT'D) splits — is a later sub-phase; this is the honest estimate.)
const PX_PER_IN = 96;
const PAGE_CONTENT_PX = 9 * PX_PER_IN;
const PAGE_MARGINS_PX = 2 * PX_PER_IN;

export function ScreenplayEditor() {
  // Read any saved script synchronously on the client; fall back to the sample.
  // (On the server this returns the sample, but the editor only instantiates on
  // the client — immediatelyRender:false — so there's no hydration mismatch.)
  const initialContent = useMemo(() => loadDoc() ?? SAMPLE_SCRIPT, []);

  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [currentElement, setCurrentElement] = useState<ElementType>("action");
  const [pageCount, setPageCount] = useState(1);
  const [wordCount, setWordCount] = useState(0);
  const [saved, setSaved] = useState(true);
  const [mod, setMod] = useState("Ctrl");

  // Debounced autosave. Local storage is the source of truth for this session;
  // we write 600ms after the writer pauses so we're never the reason work is lost.
  const debouncedSave = useMemo(
    () =>
      debounce((doc: object) => {
        saveDoc(doc);
        setSaved(true);
      }, 600),
    []
  );

  // Recompute word count and the page estimate from the live document.
  const measure = useCallback((ed: Editor) => {
    const text = ed.getText({ blockSeparator: "\n" }).trim();
    setWordCount(text ? text.split(/\s+/).length : 0);

    const dom = ed.view.dom as HTMLElement;
    const contentH = Math.max(0, dom.scrollHeight - PAGE_MARGINS_PX);
    setPageCount(Math.max(1, Math.ceil(contentH / PAGE_CONTENT_PX)));
  }, []);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: buildExtensions(),
    content: initialContent,
    editorProps: {
      attributes: { class: "sp-prose", spellcheck: "true" },
    },
    onCreate: ({ editor }) => {
      setCurrentElement(currentElementType(editor.state));
      measure(editor);
      // Dev-only handle for debugging in the browser console. Stripped from
      // production builds.
      if (process.env.NODE_ENV !== "production") {
        (window as unknown as { __lessEditor?: Editor }).__lessEditor = editor;
      }
    },
    onUpdate: ({ editor }) => {
      setSaved(false);
      debouncedSave(editor.getJSON());
      measure(editor);
    },
    onSelectionUpdate: ({ editor }) => {
      setCurrentElement(currentElementType(editor.state));
    },
  });

  // After mount: load preferences and resolve the platform shortcut symbol.
  useEffect(() => {
    setPrefs(loadPrefs());
    setMod(modKeyLabel());
  }, []);

  // Persist prefs and apply the theme to the document root (so the whole page,
  // including the gutters around the script, follows light/dark mode).
  useEffect(() => {
    savePrefs(prefs);
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = prefs.theme;
    }
  }, [prefs]);

  // The font choice changes line metrics, which changes the page count, so
  // re-measure whenever the editor's rendered height changes.
  useEffect(() => {
    if (!editor) return;
    const ro = new ResizeObserver(() => measure(editor));
    ro.observe(editor.view.dom);
    return () => ro.disconnect();
  }, [editor, measure]);

  // Escape leaves focus mode.
  useEffect(() => {
    if (!prefs.focusMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPrefs((p) => ({ ...p, focusMode: false }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prefs.focusMode]);

  const onPrefsChange = useCallback((next: Partial<Prefs>) => {
    setPrefs((p) => ({ ...p, ...next }));
  }, []);

  return (
    <div
      className={
        "app" +
        ` font-${prefs.font}` +
        (prefs.focusMode ? " focus-mode" : "")
      }
    >
      <Toolbar
        editor={editor}
        currentElement={currentElement}
        prefs={prefs}
        onPrefsChange={onPrefsChange}
        mod={mod}
      />

      <div className="page-scroll">
        <div className="page-wrap">
          <EditorContent editor={editor} className="sp-editor" />
        </div>
      </div>

      <StatusBar
        pageCount={pageCount}
        wordCount={wordCount}
        currentElement={currentElement}
        saved={saved}
      />

      {prefs.focusMode && (
        <button
          type="button"
          className="focus-exit"
          onClick={() => onPrefsChange({ focusMode: false })}
        >
          Exit focus (Esc)
        </button>
      )}
    </div>
  );
}
