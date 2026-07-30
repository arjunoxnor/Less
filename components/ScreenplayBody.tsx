"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import type { CloudUser as User } from "@/lib/cloud/client";

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
import {
  acceptAutocomplete,
  rescanAutocomplete,
  type AcState,
} from "@/lib/editor/autocomplete";
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
  scrollPosToCenter,
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
  patchProjectMeta,
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
  isTitlePageDirty as projIsTpDirty,
  setTitlePageDirty as projSetTpDirty,
  isTitleDirty as projIsTitleDirty,
  setTitleDirty as projSetTitleDirty,
  getLastSavedAt as projGetLastSavedAt,
  setLastSavedAt as projSetLastSavedAt,
  type ProjectStatus,
} from "@/lib/storage/projects";
import { modKeyLabel } from "@/lib/platform";
import { isCloudConfigured } from "@/lib/cloud/client";
import { signOut } from "@/lib/cloud/auth";
import { useCloudSync } from "@/lib/storage/useCloudSync";
import {
  exportDoc,
  importFile,
  IMPORT_ACCEPT,
  type ExportFormat,
} from "@/lib/export";
import { PageBackdrop } from "./PageBackdrop";
import { Pagination, STRIDE, PAGE_H, pageAtPos } from "@/lib/editor/pagination";
import { EditorShell, type PanelId, type RailItem } from "./chrome/EditorShell";
import { EditorStatusBar } from "./chrome/EditorStatusBar";
import { HintCard } from "./chrome/HintCard";
import { ShortcutsModal } from "./chrome/ShortcutsModal";
import type { MenuItem } from "./ui/Menu";
import { AuthModal } from "./AuthModal";
import { DocsPanel } from "./DocsPanel";
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
import { Modal } from "./ui/Modal";
import { showToast } from "./ui/Toast";
import type { TitlePage } from "@/lib/export/titlePage";

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
  sessionExpired,
  onImportAsNew,
  onOpenProject,
  autoFocusTitle,
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
  sessionExpired?: boolean;
  onImportAsNew?: (file: File) => Promise<{ imported: number; failed: string[] }>;
  /** Save-and-switch to a sibling project (the Docs panel's jump). */
  onOpenProject?: (id: string) => void;
  /** Focus and select the title on mount (instant-create flow, 2C). */
  autoFocusTitle?: boolean;
}) {
  const initialContent = useMemo(
    () => loadProjectDoc(projectId) ?? EMPTY_SCREENPLAY,
    [projectId]
  );
  const [pageTarget, setPageTarget] = useState<number | undefined>(
    () => getProjectMeta(projectId)?.pageTarget
  );
  // A brand-new empty screenplay gets the onboarding ghost line (2D.3).
  const showGhostHint = useMemo(() => {
    const c = initialContent.content;
    return !c || (c.length === 1 && (c[0]?.content?.length ?? 0) === 0);
  }, [initialContent]);

  const [currentElement, setCurrentElement] = useState<ElementType>("action");
  const [wordCount, setWordCount] = useState(0);
  const [saved, setSaved] = useState(true);
  const [saveError, setSaveError] = useState(false);
  const [mod, setMod] = useState("Ctrl");
  const [showAuth, setShowAuth] = useState(false);
  // ONE dock panel at a time (2B.3): replaces the old per-panel booleans.
  const [activePanel, setActivePanel] = useState<PanelId | null>(null);
  const [showTitlePage, setShowTitlePage] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showPageTarget, setShowPageTarget] = useState(false);
  const [pageTargetDraft, setPageTargetDraft] = useState("");
  const [caretLine, setCaretLine] = useState(0);
  const [caretPage, setCaretPage] = useState(1);
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
  const [dualActive, setDualActive] = useState(false);
  const [pageLock, setPageLock] = useState<PageLock | null>(() => loadPageLock(projectId));
  const [breakdownItems, setBreakdownItems] = useState<BreakdownItem[]>(() => loadBreakdown(projectId));
  const [hasSelection, setHasSelection] = useState(false);
  // A parsed import waiting on the Replace-or-Add choice (D9), and the chosen
  // radio; a history restore waiting on its confirm.
  const [importPending, setImportPending] = useState<{
    doc: JSONContent;
    titlePage: TitlePage | null;
    file: File;
  } | null>(null);
  const [importMode, setImportMode] = useState<"replace" | "new">("replace");
  const [confirmRestore, setConfirmRestore] = useState<{
    content: JSONContent;
    titlePage?: TitlePage | null;
  } | null>(null);

  const outlineRef = useRef<Outline>(EMPTY_OUTLINE);
  const spellEnabledRef = useRef(prefs.spellCheck);
  const revisionEnabledRef = useRef(prefs.revisionMode);
  const contdEnabledRef = useRef(prefs.autoContd);
  const breakdownItemsRef = useRef<BreakdownItem[]>(breakdownItems);
  const breakdownEnabledRef = useRef(prefs.breakdownHighlight);
  const editorRef = useRef<Editor | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  // True only while an edit is newer than the last successful write. The
  // unmount/pagehide flushes check it so that merely OPENING a script never
  // re-saves it (a save stamps updatedAt, and the home orders films by that
  // clock: reading must not reshuffle the library).
  const unsavedRef = useRef(false);

  const debouncedSave = useMemo(
    () =>
      debounce(
        (doc: JSONContent) => {
          const ok = saveProjectDoc(projectId, doc);
          setSaveError(!ok);
          if (ok) {
            unsavedRef.current = false;
            setSaved(true);
            // Cache the visual page count on the index (additive, optional
            // field) so the dashboard can show "12 pp" without parsing bodies.
            const cached = getProjectMeta(projectId)?.pageCount;
            if (cached !== pagesRef.current) {
              patchProjectMeta(projectId, { pageCount: pagesRef.current });
            }
          }
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

  // The page count shown to the writer is the SAME one the page sheets use (the
  // visual Pagination engine, via onPages below). We no longer run the export
  // paginator on every keystroke: it duplicated work and could disagree with the
  // pages actually on screen (F17/F37).
  const [pages, setPages] = useState(1);
  // Ref mirror for the debounced save (memoized on projectId only).
  const pagesRef = useRef(1);
  pagesRef.current = pages;
  const extensions = useMemo(
    () => [
      ...buildExtensions({
        getOutline: () => outlineRef.current,
        onAutocompleteState: setAcState,
        getSpeller,
        isSpellEnabled: () => spellEnabledRef.current,
        onSpellState: setSpellState,
        isRevisionEnabled: () => revisionEnabledRef.current,
        isContdEnabled: () => contdEnabledRef.current,
        getBreakdownItems: () => breakdownItemsRef.current,
        isBreakdownEnabled: () => breakdownEnabledRef.current,
        showGhostHint,
      }),
      Pagination.configure({ onPages: setPages }),
    ],
    [showGhostHint]
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
      if (process.env.NODE_ENV !== "production") {
        (window as unknown as { __lessEditor?: Editor }).__lessEditor = editor;
      }
    },
    onUpdate: ({ editor }) => {
      unsavedRef.current = true;
      setSaved(false);
      debouncedSave(editor.getJSON());
      measure(editor);
      // Retyping a line (setElement) changes the doc without moving the
      // selection, so the element pill must refresh here too, not only on
      // selection updates.
      setCurrentElement(currentElementType(editor.state));
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
  useEffect(() => {
    if (editor) rescanAutocomplete(editor.view);
  }, [editor, outline]);

  const currentSceneNumber = useMemo(() => {
    let n: number | null = null;
    for (const s of outline.scenes) {
      if (s.lineIndex <= caretLine) n = s.number;
      else break;
    }
    return n;
  }, [outline.scenes, caretLine]);

  // The live project title, read through a ref so the memoized sync opts always
  // see the current value (e.g. after a rename) without re-creating.
  const titleRef = useRef(title);
  titleRef.current = title;

  const syncOpts = useMemo(
    () => ({
      projectId,
      type: "screenplay" as const,
      status,
      deriveTitle,
      getTitle: () => titleRef.current,
      saveLocalDoc: (d: JSONContent) => saveProjectDoc(projectId, d),
      loadLocalTitlePage: () => loadProjectTitlePage(projectId),
      saveLocalTitlePage: (tp: ReturnType<typeof loadProjectTitlePage>) =>
        saveProjectTitlePage(projectId, tp),
      isDirty: () => projIsDirty(projectId),
      setDirty: (b: boolean) => projSetDirty(projectId, b),
      isTitlePageDirty: () => projIsTpDirty(projectId),
      setTitlePageDirty: (b: boolean) => projSetTpDirty(projectId, b),
      isTitleDirty: () => projIsTitleDirty(projectId),
      setTitleDirty: (b: boolean) => projSetTitleDirty(projectId, b),
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
    flushBeacon,
  } = useCloudSync(editor, user, syncOpts);

  // Flush local + cloud on the way out of this project.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  const flushBeaconRef = useRef(flushBeacon);
  flushBeaconRef.current = flushBeacon;
  useEffect(() => {
    return () => {
      debouncedSave.cancel();
      const ed = editorRef.current;
      // Only a real pending edit gets written on the way out; see unsavedRef.
      if (ed && unsavedRef.current) saveProjectDoc(projectId, ed.getJSON());
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
      if (!ed || !unsavedRef.current) return;
      debouncedSave.cancel();
      const ok = saveProjectDoc(projectId, ed.getJSON());
      if (ok) unsavedRef.current = false;
      setSaveError(!ok);
    };
    const onPageHide = () => {
      flushLocal();
      // keepalive cloud push so the last burst survives tab close; the
      // synchronous local write above is the actual no-loss guarantee.
      flushBeaconRef.current();
    };
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
      measure(editor);
      setSaved(true);
      // The content was just replaced from the cloud. Re-persist it and reflect
      // the REAL result: this clears a stale "not saved" after a recovered pull,
      // but does not hide a genuine storage-full that also affects this write.
      const ok = saveProjectDoc(projectId, editor.getJSON());
      if (ok) unsavedRef.current = false;
      setSaveError(!ok);
    }
  }, [pulledTick, editor, measure, debouncedSave]);

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
    }
  }, [prefs.autoContd, editor]);

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

  const breakdownResult = useBreakdown(editor, breakdownItems, activePanel === "breakdown");

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
    async (file: File) => {
      try {
        const { doc, titlePage: importedTp } = await importFile(file);
        // Importing can replace the open screenplay. If there is anything to
        // lose, ask Replace-or-Add first; otherwise a misclick wipes the
        // current script. An empty document just takes the file directly.
        const hasContent = (editor?.getText({ blockSeparator: "\n" }).trim().length ?? 0) > 0;
        if (hasContent) {
          setImportMode("replace");
          setImportPending({ doc, titlePage: importedTp, file });
          return;
        }
        // Pass undefined (not null) when the file has no title block, so an
        // import never wipes an existing title page.
        importContent(doc, importedTp ?? undefined);
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Could not import that file.", {
          variant: "danger",
        });
      }
    },
    [editor, importContent]
  );

  const runPendingImport = useCallback(async () => {
    const pending = importPending;
    if (!pending) return;
    setImportPending(null);
    if (importMode === "replace" || !onImportAsNew) {
      importContent(pending.doc, pending.titlePage ?? undefined);
      return;
    }
    try {
      const { imported, failed } = await onImportAsNew(pending.file);
      if (imported > 0) {
        showToast("Imported as a new project.");
      } else {
        showToast(
          failed.length ? "Could not import that file." : "Nothing was imported.",
          { variant: "danger" }
        );
      }
    } catch {
      showToast("Could not import that file.", { variant: "danger" });
    }
  }, [importPending, importMode, importContent, onImportAsNew]);

  const jumpToScene = useCallback(
    (pos: number) => {
      if (!editor) return;
      editor.chain().focus().setTextSelection(pos).scrollIntoView().run();
      // Belt-and-suspenders: the paginated overlay doesn't always honor PM's
      // transaction scrollIntoView, so scroll the target into view explicitly.
      scrollPosToCenter(editor.view, pos);
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

  const showFind = activePanel === "find";
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

  // Cmd/Ctrl+F opens the find panel in the dock. Escape is handled by the
  // shell's single ordered handler (dock first, then focus mode).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setActivePanel("find");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Track which visual page the caret is on, from the pagination engine's own
  // decorations, so the status bar always matches the sheets on screen.
  useEffect(() => {
    if (!editor) return;
    const sync = () => {
      setCaretPage(pageAtPos(editor.state, editor.state.selection.head));
    };
    sync();
    editor.on("transaction", sync);
    return () => {
      editor.off("transaction", sync);
    };
  }, [editor]);

  // Typewriter scrolling (2F): keep the caret line vertically centered while
  // the pref is on, throttled to 120ms.
  useEffect(() => {
    if (!editor || !prefs.focusTypewriter) return;
    let last = 0;
    const center = () => {
      const now = Date.now();
      if (now - last < 120) return;
      last = now;
      const { head } = editor.state.selection;
      const dom = editor.view.domAtPos(head).node;
      const el = dom.nodeType === 1 ? (dom as HTMLElement) : dom.parentElement;
      el?.closest(".sp-line")?.scrollIntoView({ block: "center", inline: "nearest" });
    };
    editor.on("selectionUpdate", center);
    return () => {
      editor.off("selectionUpdate", center);
    };
  }, [editor, prefs.focusTypewriter]);

  // "?" outside editable contexts opens the shortcuts overlay (2D.4).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest("input, textarea, select, [contenteditable]")) return;
      e.preventDefault();
      setShowShortcuts(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
    cmds.push({ id: "scenes", group: "Panel", label: "Open scenes", run: () => setActivePanel("scenes") });
    cmds.push({
      id: "find",
      group: "Panel",
      label: "Find and replace",
      run: () => setActivePanel("find"),
    });
    cmds.push({ id: "cast", group: "Panel", label: "Cast and locations", run: () => setActivePanel("cast") });
    cmds.push({ id: "reports", group: "Panel", label: "Reports", run: () => setActivePanel("reports") });
    cmds.push({ id: "notes", group: "Panel", label: "Notes", run: () => setActivePanel("notes") });
    cmds.push({ id: "breakdown", group: "Panel", label: "Breakdown", run: () => setActivePanel("breakdown") });
    cmds.push({ id: "history", group: "Panel", label: "Version history", run: () => setActivePanel("history") });
    cmds.push({ id: "titlepage", group: "Panel", label: "Title page", run: () => setShowTitlePage(true) });
    cmds.push({ id: "shortcuts", group: "Help", label: "Keyboard shortcuts", run: () => setShowShortcuts(true) });
    cmds.push({ id: "exp-pdf", group: "Export", label: "Export PDF", run: () => handleExport("pdf") });
    cmds.push({ id: "exp-fountain", group: "Export", label: "Export Fountain", run: () => handleExport("fountain") });
    cmds.push({ id: "exp-fdx", group: "Export", label: "Export Final Draft (FDX)", run: () => handleExport("fdx") });
    cmds.push({ id: "t-spell", group: "Toggle", label: (prefs.spellCheck ? "Turn off" : "Turn on") + " spell check", run: () => onPrefsChange({ spellCheck: !prefs.spellCheck }) });
    cmds.push({ id: "t-scenenum", group: "Toggle", label: (prefs.sceneNumbers ? "Hide" : "Show") + " scene numbers", run: () => onPrefsChange({ sceneNumbers: !prefs.sceneNumbers }) });
    cmds.push({ id: "t-rev", group: "Toggle", label: (prefs.revisionMode ? "Turn off" : "Turn on") + " revision mode", run: () => onPrefsChange({ revisionMode: !prefs.revisionMode }) });
    cmds.push({ id: "t-contd", group: "Toggle", label: (prefs.autoContd ? "Turn off" : "Turn on") + " auto (CONT'D)", run: () => onPrefsChange({ autoContd: !prefs.autoContd }) });
    cmds.push({ id: "t-focus", group: "Toggle", label: "Focus mode", run: () => onPrefsChange({ focusMode: !prefs.focusMode }) });
    cmds.push({ id: "t-typewriter", group: "Toggle", label: (prefs.focusTypewriter ? "Turn off" : "Turn on") + " typewriter scrolling", run: () => onPrefsChange({ focusTypewriter: !prefs.focusTypewriter }) });
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

  // ---- Chrome wiring (Part 2B): menus, rail, dock content ------------------

  const signOutAndFlush = async () => {
    // Land any pending edit in the cloud before sign-out wipes the local
    // cloud-backed copy (the reconcile effect clears it on identity change).
    await flushRef.current();
    void signOut();
  };

  const exportItems: MenuItem[] = [
    { label: "PDF", onSelect: () => handleExport("pdf") },
    { label: "Fountain", onSelect: () => handleExport("fountain") },
    { label: "Final Draft", onSelect: () => handleExport("fdx") },
  ];

  const STATUS_ROWS: { value: ProjectStatus; label: string }[] = [
    { value: "not_started", label: "Idea" },
    { value: "writing", label: "Writing" },
    { value: "done", label: "Done" },
  ];

  // The overflow menu, exactly the 2B.1 groups and order.
  const overflowItems: MenuItem[] = [
    { label: "Import into this project…", onSelect: () => importInputRef.current?.click() },
    { label: "Title page…", onSelect: () => setShowTitlePage(true) },
    { kind: "divider" },
    { kind: "checkbox", label: "Spell check", checked: prefs.spellCheck, onToggle: () => onPrefsChange({ spellCheck: !prefs.spellCheck }) },
    { kind: "checkbox", label: "Scene numbers", checked: prefs.sceneNumbers, onToggle: () => onPrefsChange({ sceneNumbers: !prefs.sceneNumbers }) },
    { kind: "checkbox", label: "Auto (CONT'D)", checked: prefs.autoContd, onToggle: () => onPrefsChange({ autoContd: !prefs.autoContd }) },
    { kind: "checkbox", label: "Revision mode", checked: prefs.revisionMode, onToggle: () => onPrefsChange({ revisionMode: !prefs.revisionMode }) },
    ...(prefs.revisionMode
      ? [{ label: "Clear revision marks", danger: true, onSelect: clearRevisions } as MenuItem]
      : []),
    { kind: "checkbox", label: "Focus: typewriter", checked: prefs.focusTypewriter, onToggle: () => onPrefsChange({ focusTypewriter: !prefs.focusTypewriter }) },
    { kind: "divider" },
    { kind: "radio", group: "font", label: "Courier Prime", checked: prefs.font === "courier-prime", onSelect: () => onPrefsChange({ font: "courier-prime" }) },
    { kind: "radio", group: "font", label: "Courier", checked: prefs.font === "courier", onSelect: () => onPrefsChange({ font: "courier" }) },
    { kind: "radio", group: "theme", label: "Light", checked: prefs.theme === "light", onSelect: () => onPrefsChange({ theme: "light" }) },
    { kind: "radio", group: "theme", label: "Dark", checked: prefs.theme === "dark", onSelect: () => onPrefsChange({ theme: "dark" }) },
    { kind: "radio", group: "theme", label: "System", checked: prefs.theme === "system", onSelect: () => onPrefsChange({ theme: "system" }) },
    {
      label: "Page target…",
      onSelect: () => {
        setPageTargetDraft(pageTarget ? String(pageTarget) : "");
        setShowPageTarget(true);
      },
    },
    pageLock
      ? { label: "Unlock pages", onSelect: unlockPages }
      : { label: "Lock pages", onSelect: lockPages },
    { kind: "divider" },
    ...STATUS_ROWS.map(
      (s): MenuItem => ({
        kind: "radio",
        group: "status",
        label: s.label,
        checked: status === s.value,
        onSelect: () => onStatusChange(s.value),
      })
    ),
    { kind: "divider" },
    ...(isCloudConfigured
      ? user
        ? [
            { label: user.email ?? "Signed in", onSelect: () => {}, disabled: true } as MenuItem,
            { label: "Sign out", onSelect: () => void signOutAndFlush() } as MenuItem,
          ]
        : [{ label: "Sign in", onSelect: () => setShowAuth(true) } as MenuItem]
      : []),
    { label: "Back to projects", onSelect: onBack },
  ];

  const railItems: RailItem[] = [
    { kind: "panel", id: "scenes", label: "Scenes" },
    // The film's other drafts and documents (Altitude 3). An implicit film
    // (a loose screenplay) still shows it, with just its drafts group.
    { kind: "panel", id: "docs", label: "Docs" },
    { kind: "panel", id: "cast", label: "Cast and locations" },
    { kind: "panel", id: "notes", label: "Notes" },
    { kind: "panel", id: "breakdown", label: "Breakdown" },
    { kind: "panel", id: "reports", label: "Reports" },
    { kind: "panel", id: "history", label: "History" },
    { kind: "divider" },
    { kind: "panel", id: "find", label: "Find", shortcut: mod + "F" },
  ];

  const closePanel = () => setActivePanel(null);
  const dockPanel =
    activePanel === "scenes" ? (
      <SceneNavigatorPanel
        scenes={outline.scenes}
        currentSceneNumber={currentSceneNumber}
        onJump={jumpToScene}
        onClose={closePanel}
      />
    ) : activePanel === "docs" ? (
      <DocsPanel
        projectId={projectId}
        onOpen={(id) => onOpenProject?.(id)}
        onClose={closePanel}
      />
    ) : activePanel === "cast" ? (
      <CastListPanel
        cast={outline.cast}
        locations={outline.locations}
        onJump={jumpToScene}
        onRenameCharacter={onRenameCharacter}
        onRenameLocation={onRenameLocation}
        onClose={closePanel}
      />
    ) : activePanel === "notes" ? (
      <NotesPanel
        notes={outline.notes}
        onJump={jumpToScene}
        onAddToCurrent={addNoteToCurrent}
        onRemove={removeNote}
        onClose={closePanel}
      />
    ) : activePanel === "breakdown" ? (
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
        onClose={closePanel}
      />
    ) : activePanel === "reports" ? (
      <ReportsPanel
        outline={outline}
        pageCount={pages}
        wordCount={wordCount}
        title={title}
        onJump={jumpToScene}
        onClose={closePanel}
      />
    ) : activePanel === "history" ? (
      <HistoryPanel
        getVersions={getVersions}
        onRestore={(content, tp) => {
          // Replacing the live document is destructive; confirm first. A
          // snapshot of the current doc is taken inside restoreVersion so this
          // is recoverable either way.
          setConfirmRestore({ content, titlePage: tp });
        }}
        onClose={closePanel}
      />
    ) : activePanel === "find" ? (
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
        onClose={closePanel}
      />
    ) : null;

  return (
    <>
      <EditorShell
        rootClassName={
          `app font-${prefs.font}` + (prefs.sceneNumbers ? " show-scene-numbers" : "")
        }
        focusMode={prefs.focusMode}
        onExitFocus={() => onPrefsChange({ focusMode: false })}
        onEnterFocus={() => onPrefsChange({ focusMode: true })}
        autoFocusTitle={autoFocusTitle}
        title={title}
        onRename={onRename}
        onBack={onBack}
        cloudConfigured={isCloudConfigured}
        user={user}
        syncStatus={syncStatus}
        sessionExpired={!!sessionExpired}
        onSignIn={() => setShowAuth(true)}
        modLabel={mod}
        onOpenPalette={() => setShowPalette(true)}
        exportItems={exportItems}
        overflowItems={overflowItems}
        railItems={railItems}
        activePanel={activePanel}
        onPanelChange={setActivePanel}
        dockPanel={dockPanel}
        statusBar={
          <EditorStatusBar
            currentElement={currentElement}
            onSetElement={(t) => editor?.chain().focus().setElement(t).run()}
            mod={mod}
            dualVisible={
              currentElement === "character" ||
              currentElement === "dialogue" ||
              currentElement === "parenthetical"
            }
            dualActive={dualActive}
            onToggleDual={toggleDual}
            caretPage={caretPage}
            pageCount={pages}
            pageTarget={pageTarget}
            wordCount={wordCount}
            saved={saved}
            saveError={saveError}
            locked={pageLock != null}
            lockRevision={pageLock?.revision}
          />
        }
      >
        <div className="page-scroll">
          <div className="page-wrap">
            <div
              className="page-host page-host-sp"
              style={{ minHeight: (Math.max(1, pages) - 1) * STRIDE + PAGE_H }}
            >
              <PageBackdrop pages={pages} />
              <EditorContent editor={editor} className="sp-editor" />
            </div>
          </div>
        </div>
        <HintCard modLabel={mod} />
      </EditorShell>

      <input
        ref={importInputRef}
        type="file"
        accept={IMPORT_ACCEPT}
        className="tb-file-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleImport(f);
          e.target.value = "";
        }}
      />

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}

      {confirmRestore && (
        <Modal
          title="Restore this version"
          onClose={() => setConfirmRestore(null)}
          actions={[
            { label: "Cancel", onClick: () => setConfirmRestore(null) },
            {
              label: "Restore this version",
              variant: "solid",
              onClick: () => {
                restoreVersion(confirmRestore.content, confirmRestore.titlePage ?? undefined);
                setConfirmRestore(null);
                setActivePanel(null);
              },
            },
          ]}
        >
          <p>This replaces your current text with the selected version.</p>
          <p className="ui-modal-note">
            A snapshot of the current text is kept in History, so you can come back.
          </p>
        </Modal>
      )}

      {importPending && (
        <Modal
          title="Import file"
          onClose={() => setImportPending(null)}
          actions={[
            { label: "Cancel", onClick: () => setImportPending(null) },
            {
              label: "Import",
              variant: importMode === "replace" ? "danger" : "solid",
              onClick: () => void runPendingImport(),
            },
          ]}
        >
          <p>This screenplay already has text. Where should the file go?</p>
          <div className="ui-choice" role="radiogroup" aria-label="Import destination">
            <label>
              <input
                type="radio"
                name="import-mode"
                checked={importMode === "replace"}
                onChange={() => setImportMode("replace")}
              />
              <span>
                Replace this script
                <span className="ui-choice-sub">
                  The file&apos;s contents take over this screenplay.
                </span>
              </span>
            </label>
            {onImportAsNew && (
              <label>
                <input
                  type="radio"
                  name="import-mode"
                  checked={importMode === "new"}
                  onChange={() => setImportMode("new")}
                />
                <span>
                  Add as a new project
                  <span className="ui-choice-sub">
                    This screenplay stays as it is; the file opens from your projects.
                  </span>
                </span>
              </label>
            )}
          </div>
          <p className="ui-modal-note">
            A snapshot of the current text is kept in History either way.
          </p>
        </Modal>
      )}

      {showPageTarget && (
        <Modal
          title="Page target"
          onClose={() => setShowPageTarget(false)}
          actions={[
            { label: "Cancel", onClick: () => setShowPageTarget(false) },
            {
              label: "Set target",
              variant: "solid",
              onClick: () => {
                const n = parseInt(pageTargetDraft, 10);
                const next = Number.isFinite(n) && n > 0 ? n : undefined;
                patchProjectMeta(projectId, { pageTarget: next });
                setPageTarget(next);
                setShowPageTarget(false);
              },
            },
          ]}
        >
          <p>Aim for about this many pages. Leave it empty to clear the target.</p>
          <label className="field">
            <span>Pages</span>
            <input
              type="number"
              min={1}
              max={999}
              value={pageTargetDraft}
              onChange={(e) => setPageTargetDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const n = parseInt(pageTargetDraft, 10);
                  const next = Number.isFinite(n) && n > 0 ? n : undefined;
                  patchProjectMeta(projectId, { pageTarget: next });
                  setPageTarget(next);
                  setShowPageTarget(false);
                }
              }}
            />
          </label>
        </Modal>
      )}

      {showShortcuts && <ShortcutsModal mod={mod} onClose={() => setShowShortcuts(false)} />}

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
    </>
  );
}
