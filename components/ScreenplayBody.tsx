"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import type { User } from "@supabase/supabase-js";

import { buildExtensions } from "@/lib/editor/buildExtensions";
import { docToLines } from "@/lib/export/flatten";
import { paginate } from "@/lib/export/paginate";
import { capturePageLock, type PageLock } from "@/lib/export/pageLock";
import { deriveTitle } from "@/lib/editor/docUtils";
import { currentElementType } from "@/lib/editor/keymap";
import {
  ELEMENT_CYCLE,
  ELEMENT_LABELS,
  type ElementType,
} from "@/lib/editor/elements";
import { useOutline } from "@/lib/editor/useOutline";
import { EMPTY_OUTLINE } from "@/lib/editor/outline";
import { acceptAutocomplete, type AcState } from "@/lib/editor/autocomplete";
import { getSpeller } from "@/lib/editor/spellEngine";
import { rescanSpelling, type SpellState } from "@/lib/editor/spellcheck";
import { rescanContd } from "@/lib/editor/contd";
import { rescanBreakdown } from "@/lib/editor/breakdownMarks";
import { breakdownToText, BREAKDOWN_CATEGORIES, type BreakdownItem } from "@/lib/editor/breakdown";
import { useBreakdown } from "@/lib/editor/useBreakdown";
import { downloadBlob, safeFilename } from "@/lib/export/download";
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
import { renameLocationEverywhere } from "@/lib/editor/renameLocation";
import type { Outline } from "@/types/screenplay";
import { debounce, type Prefs } from "@/lib/storage/localStore";
import {
  EMPTY_SCREENPLAY,
  getProjectMeta,
  loadProjectDoc,
  saveProjectDoc,
  loadProjectTitlePage,
  saveProjectTitlePage,
  loadPageLock,
  savePageLock,
  loadBreakdown,
  saveBreakdown,
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
import { BreakdownPanel } from "./BreakdownPanel";
import { FindReplacePanel, type FindInputs } from "./FindReplacePanel";
import { AutocompleteMenu } from "./AutocompleteMenu";
import { SpellMenu } from "./SpellMenu";
import { TitlePageModal } from "./TitlePageModal";
import { CommandPalette, type PaletteCommand } from "./CommandPalette";

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
  const pageTarget = useMemo(() => getProjectMeta(projectId)?.pageTarget, [projectId]);

  const [currentElement, setCurrentElement] = useState<ElementType>("action");
  const [pageCount, setPageCount] = useState(1);
  const [wordCount, setWordCount] = useState(0);
  const [saved, setSaved] = useState(true);
  const [saveError, setSaveError] = useState(false);
  const [mod, setMod] = useState("Ctrl");
  const [showAuth, setShowAuth] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showScenes, setShowScenes] = useState(false);
  const [showCast, setShowCast] = useState(false);
  const [showReports, setShowReports] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showFind, setShowFind] = useState(false);
  const [showTitlePage, setShowTitlePage] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [caretLine, setCaretLine] = useState(0);
  const [findState, setFindState] = useState<FindInputs>({
    query: "",
    replace: "",
    caseSensitive: false,
    wholeWord: false,
    element: "all",
  });
  const [findMeta, setFindMeta] = useState({ matchCount: 0, activeIndex: 0 });
  const [acState, setAcState] = useState<AcState | null>(null);
  const [spellState, setSpellState] = useState<SpellState | null>(null);
  const [renameFrom, setRenameFrom] = useState<string | null>(null);
  const [renameTick, setRenameTick] = useState(0);
  const [dualActive, setDualActive] = useState(false);
  const [pageLock, setPageLock] = useState<PageLock | null>(() => loadPageLock(projectId));
  const [breakdownItems, setBreakdownItems] = useState<BreakdownItem[]>(() => loadBreakdown(projectId));
  const [hasSelection, setHasSelection] = useState(false);

  const outlineRef = useRef<Outline>(EMPTY_OUTLINE);
  const spellEnabledRef = useRef(prefs.spellCheck);
  const revisionEnabledRef = useRef(prefs.revisionMode);
  const contdEnabledRef = useRef(prefs.autoContd);
  const breakdownItemsRef = useRef<BreakdownItem[]>(breakdownItems);
  const breakdownEnabledRef = useRef(prefs.breakdownHighlight);
  const editorRef = useRef<Editor | null>(null);

  const debouncedSave = useMemo(
    () =>
      debounce(
        (doc: JSONContent) => {
          const ok = saveProjectDoc(projectId, doc);
          setSaveError(!ok);
          if (ok) setSaved(true);
        },
        600,
        // Flush at least every 2.5s during continuous typing, so a crash mid-burst
        // can never lose more than a couple of seconds of work.
        2500
      ),
    [projectId]
  );

  const measure = useCallback((ed: Editor) => {
    const text = ed.getText({ blockSeparator: "\n" }).trim();
    setWordCount(text ? text.split(/\s+/).length : 0);
  }, []);

  const computePageCount = useCallback((doc: JSONContent) => {
    setPageCount(paginate(docToLines(doc), { autoContd: contdEnabledRef.current }).pageCount);
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
        isRevisionEnabled: () => revisionEnabledRef.current,
        isContdEnabled: () => contdEnabledRef.current,
        getBreakdownItems: () => breakdownItemsRef.current,
        isBreakdownEnabled: () => breakdownEnabledRef.current,
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

  // The unmount cleanup above does NOT run when the tab is closed, refreshed, or
  // backgrounded. These handlers force the pending edit to localStorage (a
  // synchronous, reliable write) on hide/close so the last few keystrokes are
  // never lost, and best-effort push to the cloud while the page is still alive.
  useEffect(() => {
    const flushLocal = () => {
      const ed = editorRef.current;
      if (!ed) return;
      debouncedSave.cancel();
      const ok = saveProjectDoc(projectId, ed.getJSON());
      setSaveError(!ok);
    };
    const onPageHide = () => flushLocal();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        flushLocal();
        flushRef.current();
      }
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
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

  useEffect(() => {
    revisionEnabledRef.current = prefs.revisionMode;
  }, [prefs.revisionMode]);

  useEffect(() => {
    contdEnabledRef.current = prefs.autoContd;
    if (editor) {
      rescanContd(editor.view);
      computePageCount(editor.getJSON());
    }
  }, [prefs.autoContd, editor, computePageCount]);

  // Keep the breakdown highlight plugin's live reads current, and repaint when
  // the catalog or the toggle changes.
  useEffect(() => {
    breakdownItemsRef.current = breakdownItems;
    if (editor) rescanBreakdown(editor.view);
  }, [breakdownItems, editor]);

  useEffect(() => {
    breakdownEnabledRef.current = prefs.breakdownHighlight;
    if (editor) rescanBreakdown(editor.view);
  }, [prefs.breakdownHighlight, editor]);

  // Track whether there is a non-empty selection (enables "Tag selection").
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const { from, to } = editor.state.selection;
      setHasSelection(to > from);
    };
    update();
    editor.on("selectionUpdate", update);
    editor.on("update", update);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("update", update);
    };
  }, [editor]);

  const breakdownResult = useBreakdown(editor, breakdownItems, showBreakdown);

  const addBreakdownItem = useCallback(
    (category: string, name: string) => {
      const clean = name.trim();
      if (!clean) return;
      setBreakdownItems((prev) => {
        // Dedupe on category + case-insensitive name so the same tag is not
        // added twice from the selection and the manual field.
        const exists = prev.some(
          (it) => it.category === category && it.name.toLowerCase() === clean.toLowerCase()
        );
        const next = exists
          ? prev
          : [...prev, { id: crypto.randomUUID(), category, name: clean }];
        saveBreakdown(projectId, next);
        return next;
      });
    },
    [projectId]
  );

  const removeBreakdownItem = useCallback(
    (id: string) => {
      setBreakdownItems((prev) => {
        const next = prev.filter((it) => it.id !== id);
        saveBreakdown(projectId, next);
        return next;
      });
    },
    [projectId]
  );

  const tagSelection = useCallback(
    (category: string) => {
      if (!editor) return;
      const { from, to } = editor.state.selection;
      if (to <= from) return;
      const text = editor.state.doc.textBetween(from, to, " ").trim();
      if (text) addBreakdownItem(category, text);
    },
    [editor, addBreakdownItem]
  );

  const exportBreakdown = useCallback(() => {
    downloadBlob(
      breakdownToText(breakdownResult, title),
      safeFilename(title + " breakdown", "txt"),
      "text/plain;charset=utf-8"
    );
  }, [breakdownResult, title]);

  const clearRevisions = useCallback(() => {
    editor?.chain().focus().clearRevisions().run();
  }, [editor]);

  const handleExport = useCallback(
    (format: ExportFormat) => {
      if (editor) {
        void exportDoc(editor.getJSON(), format, titlePage ?? undefined, {
          sceneNumbers: prefs.sceneNumbers,
          autoContd: prefs.autoContd,
          lock: pageLock,
        });
      }
    },
    [editor, titlePage, prefs.sceneNumbers, prefs.autoContd, pageLock]
  );

  // Lock the current pagination: page numbers freeze and later insertions take
  // A-page letters. Capturing uses the same options the PDF will export with.
  const lockPages = useCallback(() => {
    if (!editor) return;
    const lines = docToLines(editor.getJSON());
    const { pages } = paginate(lines, {
      sceneNumbers: prefs.sceneNumbers,
      autoContd: prefs.autoContd,
    });
    const lock = capturePageLock(pages, lines, { lockedAt: new Date().toISOString() });
    savePageLock(projectId, lock);
    setPageLock(lock);
  }, [editor, projectId, prefs.sceneNumbers, prefs.autoContd]);

  const unlockPages = useCallback(() => {
    savePageLock(projectId, null);
    setPageLock(null);
  }, [projectId]);

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

  const jumpToSceneNumber = useCallback(
    (n: number) => {
      const pos = outlineRef.current.scenes.find((s) => s.number === n)?.pos;
      if (pos != null) jumpToScene(pos);
    },
    [jumpToScene]
  );

  useEffect(() => {
    if (!editor) return;
    if (showFind) {
      setFindQuery(editor.view, {
        query: findState.query,
        caseSensitive: findState.caseSensitive,
        wholeWord: findState.wholeWord,
        element: findState.element,
      });
    } else {
      setFindQuery(editor.view, { query: "" });
    }
  }, [
    editor,
    showFind,
    findState.query,
    findState.caseSensitive,
    findState.wholeWord,
    findState.element,
  ]);

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

  // Inline rename from the Cast and Locations panel: cue-only / heading-only,
  // one undo step, no mention rewriting (the Find panel covers that case).
  const onRenameCharacter = useCallback(
    (from: string, to: string) => {
      if (editor) renameCharacterEverywhere(editor.view, from, to, { includeMentions: false });
    },
    [editor]
  );
  const onRenameLocation = useCallback(
    (from: string, to: string) => {
      if (editor) renameLocationEverywhere(editor.view, from, to);
    },
    [editor]
  );

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

  // Cmd/Ctrl+K opens the command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowPalette((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const commands = useMemo<PaletteCommand[]>(() => {
    const cmds: PaletteCommand[] = [];
    for (const t of ELEMENT_CYCLE) {
      cmds.push({
        id: "el-" + t,
        group: "Format",
        label: "Set element: " + ELEMENT_LABELS[t],
        run: () => editor?.chain().focus().setElement(t).run(),
      });
    }
    cmds.push({ id: "dual", group: "Format", label: "Toggle dual dialogue", run: toggleDual });
    cmds.push({ id: "scenes", group: "Panel", label: "Open Scenes", run: () => setShowScenes(true) });
    cmds.push({
      id: "find",
      group: "Panel",
      label: "Find and replace",
      run: () => {
        setRenameFrom(null);
        setShowFind(true);
      },
    });
    cmds.push({ id: "cast", group: "Panel", label: "Cast and Locations", run: () => setShowCast(true) });
    cmds.push({ id: "reports", group: "Panel", label: "Reports", run: () => setShowReports(true) });
    cmds.push({ id: "notes", group: "Panel", label: "Notes", run: () => setShowNotes(true) });
    cmds.push({ id: "breakdown", group: "Panel", label: "Breakdown", run: () => setShowBreakdown(true) });
    cmds.push({ id: "titlepage", group: "Panel", label: "Title page", run: () => setShowTitlePage(true) });
    if (user) {
      cmds.push({ id: "history", group: "Panel", label: "Version history", run: () => setShowHistory(true) });
    }
    cmds.push({ id: "exp-pdf", group: "Export", label: "Export PDF", run: () => handleExport("pdf") });
    cmds.push({ id: "exp-fountain", group: "Export", label: "Export Fountain", run: () => handleExport("fountain") });
    cmds.push({ id: "exp-fdx", group: "Export", label: "Export Final Draft (FDX)", run: () => handleExport("fdx") });
    cmds.push({ id: "t-spell", group: "Toggle", label: (prefs.spellCheck ? "Turn off" : "Turn on") + " spell check", run: () => onPrefsChange({ spellCheck: !prefs.spellCheck }) });
    cmds.push({ id: "t-scenenum", group: "Toggle", label: (prefs.sceneNumbers ? "Hide" : "Show") + " scene numbers", run: () => onPrefsChange({ sceneNumbers: !prefs.sceneNumbers }) });
    cmds.push({ id: "t-rev", group: "Toggle", label: (prefs.revisionMode ? "Turn off" : "Turn on") + " revision mode", run: () => onPrefsChange({ revisionMode: !prefs.revisionMode }) });
    cmds.push({ id: "t-contd", group: "Toggle", label: (prefs.autoContd ? "Turn off" : "Turn on") + " auto (CONT'D)", run: () => onPrefsChange({ autoContd: !prefs.autoContd }) });
    cmds.push({ id: "t-focus", group: "Toggle", label: "Focus mode", run: () => onPrefsChange({ focusMode: !prefs.focusMode }) });
    cmds.push({ id: "t-bd", group: "Toggle", label: (prefs.breakdownHighlight ? "Hide" : "Show") + " breakdown highlights", run: () => onPrefsChange({ breakdownHighlight: !prefs.breakdownHighlight }) });
    if (hasSelection) {
      for (const c of BREAKDOWN_CATEGORIES) {
        cmds.push({ id: "tag-" + c.id, group: "Tag", label: "Tag selection: " + c.label, run: () => tagSelection(c.id) });
      }
    }
    if (pageLock) {
      cmds.push({ id: "unlock", group: "Pages", label: "Unlock pages (resume normal numbering)", run: unlockPages });
    } else {
      cmds.push({ id: "lock", group: "Pages", label: "Lock pages (freeze numbers, A-pages on revision)", run: lockPages });
    }
    cmds.push({ id: "go-home", group: "Go", label: "Back to projects", run: onBack });
    for (const s of outline.scenes) {
      cmds.push({
        id: "scene-" + s.number,
        group: "Scene",
        label: s.number + ". " + (s.heading || "(untitled scene)"),
        run: () => jumpToScene(s.pos),
      });
    }
    return cmds;
  }, [editor, prefs, user, outline.scenes, toggleDual, handleExport, onPrefsChange, onBack, jumpToScene, pageLock, lockPages, unlockPages, hasSelection, tagSelection]);

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
          onBreakdownClick={() => setShowBreakdown((v) => !v)}
          onTitlePageClick={() => setShowTitlePage(true)}
          onToggleSpell={() => onPrefsChange({ spellCheck: !prefs.spellCheck })}
          onToggleSceneNumbers={() => onPrefsChange({ sceneNumbers: !prefs.sceneNumbers })}
          onToggleRevisions={() => onPrefsChange({ revisionMode: !prefs.revisionMode })}
          onClearRevisions={clearRevisions}
          onToggleContd={() => onPrefsChange({ autoContd: !prefs.autoContd })}
          onToggleDual={toggleDual}
          dualActive={dualActive}
          sceneNumbersOn={prefs.sceneNumbers}
          revisionModeOn={prefs.revisionMode}
          contdOn={prefs.autoContd}
          scenesOpen={showScenes}
          findOpen={showFind}
          castOpen={showCast}
          reportsOpen={showReports}
          notesOpen={showNotes}
          breakdownOpen={showBreakdown}
        />
      </EditorChrome>

      <div className="page-scroll">
        <div className="page-wrap">
          <EditorContent editor={editor} className="sp-editor" />
        </div>
      </div>

      <StatusBar
        pageCount={pageCount}
        pageTarget={pageTarget}
        wordCount={wordCount}
        currentElement={currentElement}
        saved={saved}
        saveError={saveError}
        locked={pageLock != null}
        lockRevision={pageLock?.revision}
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
          locations={outline.locations}
          onJump={jumpToScene}
          onRenameCharacter={onRenameCharacter}
          onRenameLocation={onRenameLocation}
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

      {showBreakdown && (
        <BreakdownPanel
          result={breakdownResult}
          items={breakdownItems}
          highlightOn={prefs.breakdownHighlight}
          hasSelection={hasSelection}
          onAdd={addBreakdownItem}
          onTagSelection={tagSelection}
          onRemove={removeBreakdownItem}
          onToggleHighlight={() => onPrefsChange({ breakdownHighlight: !prefs.breakdownHighlight })}
          onJumpScene={jumpToSceneNumber}
          onExport={exportBreakdown}
          onClose={() => setShowBreakdown(false)}
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

      {showPalette && (
        <CommandPalette commands={commands} onClose={() => setShowPalette(false)} />
      )}
    </div>
  );
}
