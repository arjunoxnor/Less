"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import type { User } from "@supabase/supabase-js";

import { buildExtensions } from "@/lib/editor/buildExtensions";
import { docToLines } from "@/lib/export/flatten";
import { paginate } from "@/lib/export/paginate";
import { deriveTitle } from "@/lib/editor/docUtils";
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
import { debounce, type Prefs } from "@/lib/storage/localStore";
import {
  EMPTY_SCREENPLAY,
  loadProjectDoc,
  saveProjectDoc,
  loadProjectTitlePage,
  saveProjectTitlePage,
  markCloudCreated,
  isDirty as projIsDirty,
  setDirty as projSetDirty,
  getLastSavedAt as projGetLastSavedAt,
  setLastSavedAt as projSetLastSavedAt,
  type ProjectStatus,
} from "@/lib/storage/projects";
import { modKeyLabel } from "@/lib/platform";
import { isCloudConfigured } from "@/lib/supabase/client";
import { signOut } from "@/lib/supabase/auth";
import { useCloudSync } from "@/lib/storage/useCloudSync";
import {
  exportDoc,
  importFile,
  type ExportFormat,
  type ImportFormat,
} from "@/lib/export";
import { EditorChrome } from "./EditorChrome";
import { ScreenplayToolbar } from "./ScreenplayToolbar";
import { StatusBar } from "./StatusBar";
import { AuthModal } from "./AuthModal";
import { HistoryPanel } from "./HistoryPanel";
import { SceneNavigatorPanel } from "./SceneNavigatorPanel";
import { CastListPanel } from "./CastListPanel";
import { ReportsPanel } from "./ReportsPanel";
import { NotesPanel } from "./NotesPanel";
import { FindReplacePanel, type FindInputs } from "./FindReplacePanel";
import { AutocompleteMenu } from "./AutocompleteMenu";
import { SpellMenu } from "./SpellMenu";
import { TitlePageModal } from "./TitlePageModal";

export function ScreenplayBody({
  projectId,
  title,
  onRename,
  status,
  onStatusChange,
  onBack,
  prefs,
  onPrefsChange,
  user,
}: {
  projectId: string;
  title: string;
  onRename: (title: string) => void;
  status: ProjectStatus;
  onStatusChange: (status: ProjectStatus) => void;
  onBack: () => void;
  prefs: Prefs;
  onPrefsChange: (next: Partial<Prefs>) => void;
  user: User | null;
}) {
  const initialContent = useMemo(
    () => loadProjectDoc(projectId) ?? EMPTY_SCREENPLAY,
    [projectId]
  );

  const [currentElement, setCurrentElement] = useState<ElementType>("action");
  const [pageCount, setPageCount] = useState(1);
  const [wordCount, setWordCount] = useState(0);
  const [saved, setSaved] = useState(true);
  const [mod, setMod] = useState("Ctrl");
  const [showAuth, setShowAuth] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showScenes, setShowScenes] = useState(false);
  const [showCast, setShowCast] = useState(false);
  const [showReports, setShowReports] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [showFind, setShowFind] = useState(false);
  const [showTitlePage, setShowTitlePage] = useState(false);
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

  const outlineRef = useRef<Outline>(EMPTY_OUTLINE);
  const spellEnabledRef = useRef(prefs.spellCheck);
  const editorRef = useRef<Editor | null>(null);

  const debouncedSave = useMemo(
    () =>
      debounce((doc: JSONContent) => {
        saveProjectDoc(projectId, doc);
        setSaved(true);
      }, 600),
    [projectId]
  );

  const measure = useCallback((ed: Editor) => {
    const text = ed.getText({ blockSeparator: "\n" }).trim();
    setWordCount(text ? text.split(/\s+/).length : 0);
  }, []);

  const computePageCount = useCallback((doc: JSONContent) => {
    setPageCount(paginate(docToLines(doc)).pageCount);
  }, []);
  const debouncedPageCount = useMemo(
    () => debounce((doc: JSONContent) => computePageCount(doc), 300),
    [computePageCount]
  );

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
      attributes: { class: "sp-prose", spellcheck: "false" },
    },
    onCreate: ({ editor }) => {
      editorRef.current = editor;
      setCurrentElement(currentElementType(editor.state));
      setCaretLine(editor.state.selection.$from.index(0));
      setDualActive(editor.state.selection.$from.parent.attrs?.dual === true);
      measure(editor);
      computePageCount(editor.getJSON());
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

  const outline = useOutline(editor);
  outlineRef.current = outline;

  const currentSceneNumber = useMemo(() => {
    let n: number | null = null;
    for (const s of outline.scenes) {
      if (s.lineIndex <= caretLine) n = s.number;
      else break;
    }
    return n;
  }, [outline.scenes, caretLine]);

  const syncOpts = useMemo(
    () => ({
      projectId,
      type: "screenplay" as const,
      status,
      deriveTitle,
      saveLocalDoc: (d: JSONContent) => saveProjectDoc(projectId, d),
      loadLocalTitlePage: () => loadProjectTitlePage(projectId),
      saveLocalTitlePage: (tp: ReturnType<typeof loadProjectTitlePage>) =>
        saveProjectTitlePage(projectId, tp),
      isDirty: () => projIsDirty(projectId),
      setDirty: (b: boolean) => projSetDirty(projectId, b),
      getLastSavedAt: () => projGetLastSavedAt(projectId),
      setLastSavedAt: (iso: string | null) => projSetLastSavedAt(projectId, iso),
      onCloudCreated: (id: string) => markCloudCreated(id),
    }),
    [projectId, status]
  );

  const {
    status: syncStatus,
    pulledTick,
    getVersions,
    restoreVersion,
    importContent,
    titlePage,
    setTitlePage,
    flush,
  } = useCloudSync(editor, user, syncOpts);

  // Flush local + cloud on the way out of this project.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    return () => {
      debouncedSave.cancel();
      const ed = editorRef.current;
      if (ed) saveProjectDoc(projectId, ed.getJSON());
      flushRef.current();
    };
  }, [projectId, debouncedSave]);

  useEffect(() => {
    if (editor && pulledTick > 0) {
      debouncedSave.cancel();
      debouncedPageCount.cancel();
      measure(editor);
      computePageCount(editor.getJSON());
      setSaved(true);
    }
  }, [pulledTick, editor, measure, debouncedSave, debouncedPageCount, computePageCount]);

  useEffect(() => {
    setMod(modKeyLabel());
  }, []);

  useEffect(() => {
    spellEnabledRef.current = prefs.spellCheck;
    if (editor) rescanSpelling(editor.view);
  }, [prefs.spellCheck, editor]);

  const handleExport = useCallback(
    (format: ExportFormat) => {
      if (editor) {
        void exportDoc(editor.getJSON(), format, titlePage ?? undefined, {
          sceneNumbers: prefs.sceneNumbers,
        });
      }
    },
    [editor, titlePage, prefs.sceneNumbers]
  );

  const handleImport = useCallback(
    async (_format: ImportFormat, file: File) => {
      try {
        const { doc, titlePage: importedTp } = await importFile(file);
        importContent(doc, importedTp);
      } catch (e) {
        window.alert(e instanceof Error ? e.message : "Could not import that file.");
      }
    },
    [importContent]
  );

  const jumpToScene = useCallback(
    (pos: number) => {
      editor?.chain().focus().setTextSelection(pos).scrollIntoView().run();
    },
    [editor]
  );

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

  const onRenameChar = useCallback(
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

  const addNoteToCurrent = useCallback(
    (text: string) => {
      editor?.chain().focus().setNote(text).run();
    },
    [editor]
  );
  const removeNote = useCallback(
    (pos: number) => {
      editor?.chain().setTextSelection(pos).setNote("").run();
    },
    [editor]
  );

  const setFindPatch = useCallback(
    (patch: Partial<FindInputs>) => setFindState((s) => ({ ...s, ...patch })),
    []
  );

  return (
    <div
      className={
        "app" +
        ` font-${prefs.font}` +
        (prefs.focusMode ? " focus-mode" : "") +
        (prefs.sceneNumbers ? " show-scene-numbers" : "")
      }
    >
      <EditorChrome
        onBack={onBack}
        title={title}
        onRename={onRename}
        status={status}
        onStatusChange={onStatusChange}
        prefs={prefs}
        onPrefsChange={onPrefsChange}
        cloudConfigured={isCloudConfigured}
        user={user}
        syncStatus={syncStatus}
        onSignInClick={() => setShowAuth(true)}
        onSignOutClick={() => void signOut()}
        onHistoryClick={() => setShowHistory(true)}
      >
        <ScreenplayToolbar
          editor={editor}
          currentElement={currentElement}
          prefs={prefs}
          mod={mod}
          onExport={handleExport}
          onImport={(format, file) => void handleImport(format, file)}
          onScenesClick={() => setShowScenes((v) => !v)}
          onFindClick={handleFindClick}
          onCastClick={() => setShowCast((v) => !v)}
          onReportsClick={() => setShowReports((v) => !v)}
          onNotesClick={() => setShowNotes((v) => !v)}
          onTitlePageClick={() => setShowTitlePage(true)}
          onToggleSpell={() => onPrefsChange({ spellCheck: !prefs.spellCheck })}
          onToggleSceneNumbers={() => onPrefsChange({ sceneNumbers: !prefs.sceneNumbers })}
          onToggleDual={toggleDual}
          dualActive={dualActive}
          sceneNumbersOn={prefs.sceneNumbers}
          scenesOpen={showScenes}
          findOpen={showFind}
          castOpen={showCast}
          reportsOpen={showReports}
          notesOpen={showNotes}
        />
      </EditorChrome>

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
        <button type="button" className="focus-exit" onClick={() => onPrefsChange({ focusMode: false })}>
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

      {showReports && (
        <ReportsPanel
          outline={outline}
          pageCount={pageCount}
          wordCount={wordCount}
          title={title}
          onJump={jumpToScene}
          onClose={() => setShowReports(false)}
        />
      )}

      {showNotes && (
        <NotesPanel
          notes={outline.notes}
          onJump={jumpToScene}
          onAddToCurrent={addNoteToCurrent}
          onRemove={removeNote}
          onClose={() => setShowNotes(false)}
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
          onRename={onRenameChar}
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
        <SpellMenu state={spellState} view={editor.view} onClose={() => setSpellState(null)} />
      )}
    </div>
  );
}
