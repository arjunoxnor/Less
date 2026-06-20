"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";

import { buildExtensions } from "@/lib/editor/buildExtensions";
import { docToLines } from "@/lib/export/flatten";
import { paginate } from "@/lib/export/paginate";
import { SAMPLE_SCRIPT } from "@/lib/editor/sampleScript";
import { currentElementType } from "@/lib/editor/keymap";
import type { ElementType } from "@/lib/editor/elements";
import { useOutline } from "@/lib/editor/useOutline";
import { EMPTY_OUTLINE } from "@/lib/editor/outline";
import { acceptAutocomplete, type AcState } from "@/lib/editor/autocomplete";
import { getSpeller } from "@/lib/editor/spellEngine";
import { rescanSpelling, type SpellState } from "@/lib/editor/spellcheck";
import {
  findPluginKey,
  setFindQuery,
  gotoMatch,
  replaceOne,
  replaceAll,
} from "@/lib/editor/findPlugin";
import {
  previewRename,
  renameCharacterEverywhere,
} from "@/lib/editor/renameCharacter";
import type { Outline } from "@/types/screenplay";
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
import { isCloudConfigured } from "@/lib/supabase/client";
import { useAuth, signOut } from "@/lib/supabase/auth";
import { useCloudSync } from "@/lib/storage/useCloudSync";
import {
  exportDoc,
  importFile,
  type ExportFormat,
  type ImportFormat,
} from "@/lib/export";
import { Toolbar } from "./Toolbar";
import { StatusBar } from "./StatusBar";
import { AuthModal } from "./AuthModal";
import { HistoryPanel } from "./HistoryPanel";
import { SceneNavigatorPanel } from "./SceneNavigatorPanel";
import { CastListPanel } from "./CastListPanel";
import { FindReplacePanel, type FindInputs } from "./FindReplacePanel";
import { AutocompleteMenu } from "./AutocompleteMenu";
import { SpellMenu } from "./SpellMenu";
import { TitlePageModal } from "./TitlePageModal";

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
  const [showAuth, setShowAuth] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Phase 4 navigation state, all owned here (like the other panels above).
  const [showScenes, setShowScenes] = useState(false);
  const [showCast, setShowCast] = useState(false);
  const [showFind, setShowFind] = useState(false);
  const [caretLine, setCaretLine] = useState(0);
  const [findState, setFindState] = useState<FindInputs>({
    query: "",
    replace: "",
    caseSensitive: false,
  });
  const [findMeta, setFindMeta] = useState({ matchCount: 0, activeIndex: 0 });
  const [acState, setAcState] = useState<AcState | null>(null);
  const [spellState, setSpellState] = useState<SpellState | null>(null);
  const [renameFrom, setRenameFrom] = useState<string | null>(null);
  const [renameTick, setRenameTick] = useState(0);
  const [dualActive, setDualActive] = useState(false);

  // The latest outline, read lazily by the autocomplete plugin (built once).
  const outlineRef = useRef<Outline>(EMPTY_OUTLINE);
  // Live read of the Spelling toggle, so the once-built spell plugin always sees
  // the current setting without being reconfigured.
  const spellEnabledRef = useRef(DEFAULT_PREFS.spellCheck);

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

  // Word count is cheap and synchronous on every change.
  const measure = useCallback((ed: Editor) => {
    const text = ed.getText({ blockSeparator: "\n" }).trim();
    setWordCount(text ? text.split(/\s+/).length : 0);
  }, []);

  // The page count comes from the real pagination engine, so the number on
  // screen equals the number of pages in the exported PDF. The engine is pure
  // O(rows) array work; debounce it so a long script is not re-paginated on
  // every keystroke. (It assumes monospace Courier 10cpi, which is what the two
  // shipped fonts are; a proportional font would reflect print, not screen wrap.)
  const computePageCount = useCallback((doc: JSONContent) => {
    setPageCount(paginate(docToLines(doc)).pageCount);
  }, []);
  const debouncedPageCount = useMemo(
    () => debounce((doc: JSONContent) => computePageCount(doc), 300),
    [computePageCount]
  );

  // Built once. outlineRef and setAcState are stable, so the extension list (and
  // the editor) never needs to be reconfigured on re-render. Recreating it each
  // render would reconfigure the plugins, which (with the autocomplete plugin
  // pushing state back to React) would loop.
  const extensions = useMemo(
    () =>
      buildExtensions({
        getOutline: () => outlineRef.current,
        onAutocompleteState: setAcState,
        getSpeller,
        isSpellEnabled: () => spellEnabledRef.current,
        onSpellState: setSpellState,
      }),
    []
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    content: initialContent,
    editorProps: {
      // The nspell engine owns spelling, so the native browser checker is off
      // (it cannot be made screenplay-aware or styled). Native stays the silent
      // fallback only if the dictionary fails to load.
      attributes: { class: "sp-prose", spellcheck: "false" },
    },
    onCreate: ({ editor }) => {
      setCurrentElement(currentElementType(editor.state));
      setCaretLine(editor.state.selection.$from.index(0));
      setDualActive(editor.state.selection.$from.parent.attrs?.dual === true);
      measure(editor);
      computePageCount(editor.getJSON()); // immediate, so the first count is right
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
      debouncedPageCount(editor.getJSON());
      setCaretLine(editor.state.selection.$from.index(0));
      setDualActive(editor.state.selection.$from.parent.attrs?.dual === true);
    },
    onSelectionUpdate: ({ editor }) => {
      setCurrentElement(currentElementType(editor.state));
      setCaretLine(editor.state.selection.$from.index(0));
      setDualActive(editor.state.selection.$from.parent.attrs?.dual === true);
    },
  });

  // Live outline, shared by all navigation panels. Keep the ref fresh so the
  // autocomplete plugin (built once) always reads the current candidates.
  const outline = useOutline(editor);
  outlineRef.current = outline;

  // The scene the caret currently sits in: the last heading at or above it.
  const currentSceneNumber = useMemo(() => {
    let n: number | null = null;
    for (const s of outline.scenes) {
      if (s.lineIndex <= caretLine) n = s.number;
      else break;
    }
    return n;
  }, [outline.scenes, caretLine]);

  // Auth + cloud sync. Both no-op gracefully when Supabase isn't configured,
  // so the editor always works local-first regardless.
  const { user } = useAuth();
  const {
    status: syncStatus,
    pulledTick,
    getVersions,
    restoreVersion,
    importContent,
    titlePage,
    setTitlePage,
  } = useCloudSync(editor, user);
  const [showTitlePage, setShowTitlePage] = useState(false);

  // When sync loads new content into the editor (a cross-device pull, a version
  // restore, an import, or a sign-out reset), the 'update' event is suppressed.
  // Cancel any pending autosave first: it was queued with the OLD document and
  // would otherwise fire 600ms later and overwrite the freshly loaded content
  // in local storage. Then recompute counts and refresh the saved indicator.
  useEffect(() => {
    if (editor && pulledTick > 0) {
      debouncedSave.cancel();
      debouncedPageCount.cancel();
      measure(editor);
      computePageCount(editor.getJSON());
      setSaved(true);
    }
  }, [pulledTick, editor, measure, debouncedSave, debouncedPageCount, computePageCount]);

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

  // Keep the spell plugin's live toggle in sync and rescan immediately when the
  // writer flips Spelling on or off (a pref change does not dispatch an editor
  // transaction, so the plugin would not otherwise notice).
  useEffect(() => {
    spellEnabledRef.current = prefs.spellCheck;
    if (editor) rescanSpelling(editor.view);
  }, [prefs.spellCheck, editor]);

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

  // Export the live document (and its title page) to a downloaded file.
  const handleExport = useCallback(
    (format: ExportFormat) => {
      if (editor) void exportDoc(editor.getJSON(), format, titlePage ?? undefined);
    },
    [editor, titlePage]
  );

  // Import a picked file. importFile routes by extension, so the format arg is
  // only used by the Toolbar to label the picker. On failure we surface the
  // plain-English message and leave the current document untouched.
  const handleImport = useCallback(
    async (_format: ImportFormat, file: File) => {
      try {
        const { doc, titlePage: importedTp } = await importFile(file);
        importContent(doc, importedTp);
      } catch (e) {
        window.alert(
          e instanceof Error ? e.message : "Could not import that file."
        );
      }
    },
    [importContent]
  );

  // Move the caret into a line and scroll it into view (scenes + cast jumps).
  const jumpToScene = useCallback(
    (pos: number) => {
      editor?.chain().focus().setTextSelection(pos).scrollIntoView().run();
    },
    [editor]
  );

  // Push the current search into the find plugin; clear highlights when the
  // panel is closed so they never linger over the page.
  useEffect(() => {
    if (!editor) return;
    if (showFind) {
      setFindQuery(editor.view, {
        query: findState.query,
        caseSensitive: findState.caseSensitive,
      });
    } else {
      setFindQuery(editor.view, { query: "" });
    }
  }, [editor, showFind, findState.query, findState.caseSensitive]);

  // Mirror the plugin's match count / active index into React for the panel.
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

  // Mod+F opens find; Escape closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setRenameFrom(null);
        setShowFind(true);
      } else if (e.key === "Escape" && showFind) {
        setShowFind(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showFind]);

  const activeFindIndex = () =>
    editor ? findPluginKey.getState(editor.state)?.active ?? 0 : 0;

  const onFindPrev = useCallback(() => {
    if (editor) gotoMatch(editor.view, activeFindIndex() - 1);
  }, [editor]);
  const onFindNext = useCallback(() => {
    if (editor) gotoMatch(editor.view, activeFindIndex() + 1);
  }, [editor]);
  const onReplaceOne = useCallback(() => {
    if (editor) replaceOne(editor.view, findState.replace);
  }, [editor, findState.replace]);
  const onReplaceAll = useCallback(
    () => (editor ? replaceAll(editor.view, findState.replace) : 0),
    [editor, findState.replace]
  );

  const onRename = useCallback(
    (from: string, to: string, includeMentions: boolean) =>
      editor
        ? renameCharacterEverywhere(editor.view, from, to, { includeMentions })
        : { cues: 0, mentions: 0 },
    [editor]
  );
  const getRenamePreview = useCallback(
    (from: string, to: string, includeMentions: boolean) =>
      editor
        ? previewRename(editor.state.doc, from, to, { includeMentions })
        : { cues: 0, mentions: 0 },
    [editor]
  );

  const handleFindClick = useCallback(() => {
    setRenameFrom(null);
    setShowFind((v) => !v);
  }, []);
  const onCastRename = useCallback((name: string) => {
    setRenameFrom(name);
    setRenameTick((t) => t + 1);
    setShowFind(true);
  }, []);

  const toggleDual = useCallback(() => {
    editor?.chain().focus().toggleDual().run();
  }, [editor]);

  const setFindPatch = useCallback(
    (patch: Partial<FindInputs>) => setFindState((s) => ({ ...s, ...patch })),
    []
  );

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
        cloudConfigured={isCloudConfigured}
        user={user}
        syncStatus={syncStatus}
        onSignInClick={() => setShowAuth(true)}
        onSignOutClick={() => void signOut()}
        onHistoryClick={() => setShowHistory(true)}
        onExport={handleExport}
        onImport={(format, file) => void handleImport(format, file)}
        onScenesClick={() => setShowScenes((v) => !v)}
        onFindClick={handleFindClick}
        onCastClick={() => setShowCast((v) => !v)}
        onTitlePageClick={() => setShowTitlePage(true)}
        onToggleSpell={() => onPrefsChange({ spellCheck: !prefs.spellCheck })}
        onToggleDual={toggleDual}
        dualActive={dualActive}
        scenesOpen={showScenes}
        findOpen={showFind}
        castOpen={showCast}
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

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}

      {showHistory && (
        <HistoryPanel
          getVersions={getVersions}
          onRestore={(content, tp) => {
            restoreVersion(content, tp);
            setShowHistory(false);
          }}
          onClose={() => setShowHistory(false)}
        />
      )}

      {showScenes && (
        <SceneNavigatorPanel
          scenes={outline.scenes}
          currentSceneNumber={currentSceneNumber}
          onJump={jumpToScene}
          onClose={() => setShowScenes(false)}
        />
      )}

      {showCast && (
        <CastListPanel
          cast={outline.cast}
          onJump={jumpToScene}
          onRename={onCastRename}
          onClose={() => setShowCast(false)}
        />
      )}

      {showFind && (
        <FindReplacePanel
          findState={findState}
          setFindState={setFindPatch}
          matchCount={findMeta.matchCount}
          activeIndex={findMeta.activeIndex}
          cast={outline.cast}
          onPrev={onFindPrev}
          onNext={onFindNext}
          onReplaceOne={onReplaceOne}
          onReplaceAll={onReplaceAll}
          onRename={onRename}
          getPreview={getRenamePreview}
          initialRenameFrom={renameFrom}
          renameTick={renameTick}
          onClose={() => setShowFind(false)}
        />
      )}

      {showTitlePage && (
        <TitlePageModal
          value={titlePage ?? {}}
          onSave={(tp) => {
            setTitlePage(tp);
            setShowTitlePage(false);
          }}
          onClose={() => setShowTitlePage(false)}
        />
      )}

      {acState?.open && acState.items.length > 0 && acState.coords && (
        <AutocompleteMenu
          items={acState.items}
          active={acState.active}
          coords={acState.coords}
          onPick={(i) => {
            if (editor) acceptAutocomplete(editor.view, i);
          }}
        />
      )}

      {spellState?.open && editor && (
        <SpellMenu
          state={spellState}
          view={editor.view}
          onClose={() => setSpellState(null)}
        />
      )}
    </div>
  );
}
