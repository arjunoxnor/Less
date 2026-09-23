"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
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
  ELEMENT_NUMBER,
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
  listProjects,
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
  getSyncedPrint as projGetSyncedPrint,
  setSyncedPrint as projSetSyncedPrint,
  hasPendingCloudWork,
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
import {
  Pagination,
  STRIDE,
  PAGE_H,
  pageAtPos,
  benchmarkPaginationPass,
} from "@/lib/editor/pagination";
import { TYPING_SCROLL_MARGIN, centerCaret } from "@/lib/editor/scrollComfort";
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
import {
  clearProjectShare,
  clearDuetDocumentCache,
  colorForName,
  createDuetSession,
  createProjectShare,
  duetAllowsLocalCloudSync,
  duetCloudSyncProjectId,
  subscribeProjectShare,
  loadDuetDisplayName,
  makeGuestName,
  revokeDuetRoom,
  renameSharedOrLocalTitle,
  saveDuetDisplayName,
  type DuetConnectionStatus,
  type DuetParticipant,
  type DuetSession,
  type DuetShareRecord,
} from "@/lib/collab/duet";
import {
  duetCopyHasText,
  duetCopyType,
  duetMirrorsToLibrary,
  planDuetCopy,
  readDuetCopyRecord,
  writeDuetCopyRecord,
  type DuetCopyPlan,
  type SaveDuetCopy,
} from "@/lib/collab/duetCopy";
import { DuetShareModal } from "./DuetShareModal";
import { DuetSaveCopyModal } from "./DuetSaveCopyModal";

export interface DuetAccess {
  token: string;
  owner: boolean;
  ownerKey?: string;
}

interface ScreenplayBodyProps {
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
  duet?: DuetAccess;
  /** Duet stage 3: file a guest's snapshot of the room in their own library. */
  onSaveDuetCopy?: SaveDuetCopy;
}

export function ScreenplayBody({ duet, onSaveDuetCopy, ...props }: ScreenplayBodyProps) {
  const [access, setAccess] = useState<DuetAccess | null>(() => duet ?? null);
  const [session, setSession] = useState<DuetSession | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [showShare, setShowShare] = useState(false);
  const [copyPlan, setCopyPlan] = useState<DuetCopyPlan | null>(null);
  const [savingCopy, setSavingCopy] = useState(false);
  const [participants, setParticipants] = useState<DuetParticipant[]>([]);
  const [duetStatus, setDuetStatus] = useState<DuetConnectionStatus>("reconnecting");
  const [duetReady, setDuetReady] = useState(false);
  const guestFallback = useRef(makeGuestName());
  const [displayName, setDisplayName] = useState(() =>
    duet?.owner
      ? props.user?.name?.trim() || "You"
      : loadDuetDisplayName() || guestFallback.current
  );

  useEffect(() => {
    if (duet && !duet.owner) return;
    return subscribeProjectShare(props.projectId, (record) => {
      setAccess(
        record
          ? { token: record.token, owner: true, ownerKey: record.ownerKey }
          : null
      );
    });
  }, [duet, props.projectId]);

  useEffect(() => {
    if (!access) {
      setSession(null);
      setParticipants([]);
      setDuetReady(false);
      return;
    }
    let created: DuetSession | null = null;
    try {
      const cleanName = displayName.trim() || (access.owner ? "You" : guestFallback.current);
      created = createDuetSession({
        projectId: props.projectId,
        token: access.token,
        owner: access.owner,
        ownerKey: access.ownerKey,
        user: { name: cleanName, color: colorForName(cleanName) },
      });
      setSessionError(null);
      setDuetReady(false);
      setSession(created);
    } catch {
      setSessionError("This shared script could not connect just now.");
      setSession(null);
    }
    return () => created?.destroy();
    // A name change updates awareness below and must not replace the document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access?.token, access?.owner, access?.ownerKey, props.projectId]);

  useEffect(() => {
    if (!session) return;
    const cleanName = displayName.trim() || (session.owner ? "You" : guestFallback.current);
    session.setUser({ name: cleanName, color: colorForName(cleanName) });
    if (!session.owner) saveDuetDisplayName(displayName);
  }, [displayName, session]);

  useEffect(() => {
    if (!session) return;
    const offPresence = session.subscribePresence(setParticipants);
    const offStatus = session.subscribeStatus(setDuetStatus);
    const offReady = session.subscribeReady(setDuetReady);
    const offFatal = session.subscribeFatal((reason) => {
      if (reason) showToast(reason, { variant: "danger" });
    });
    return () => {
      offPresence();
      offStatus();
      offReady();
      offFatal();
    };
  }, [session]);

  const openShare = async () => {
    if (!access) {
      try {
        const record = await createProjectShare(props.projectId);
        setAccess({ token: record.token, owner: true, ownerKey: record.ownerKey });
      } catch (cause) {
        showToast(cause instanceof Error ? cause.message : "Sharing could not start.", {
          variant: "danger",
        });
        return;
      }
    }
    setShowShare(true);
  };

  // Duet stage 3. The room is only READ here: the snapshot becomes an ordinary
  // project with a fresh id, so nobody else's session is touched and the copy
  // never syncs back over the shared document.
  const openSaveCopy = () => {
    if (!session || session.owner || !onSaveDuetCopy) return;
    const content = session.getContent();
    if (!duetCopyHasText(content)) {
      showToast("Nothing has loaded from this shared script yet, so there is nothing to save.");
      return;
    }
    setCopyPlan(
      planDuetCopy({
        content,
        sharedTitle: session.getTitle(),
        existingTitles: listProjects().map((project) => project.title),
        previous: readDuetCopyRecord(session.token, (id) => getProjectMeta(id) !== null),
      })
    );
  };

  const saveCopy = (title: string) => {
    if (!copyPlan || !session || !onSaveDuetCopy || savingCopy) return;
    setSavingCopy(true);
    try {
      // Snapshot at the moment of saving, not at the moment the dialog opened,
      // so "as it is right now" is true even if the room moved on meanwhile.
      const live = session.getContent();
      const content = duetCopyHasText(live) ? live : copyPlan.content;
      const saved = onSaveDuetCopy({ type: duetCopyType(content), title, content });
      writeDuetCopyRecord(session.token, {
        projectId: saved.id,
        title: saved.title,
        savedAt: new Date().toISOString(),
      });
      setCopyPlan(null);
      showToast("Saved to your library. You are editing your own copy now, not the shared script.");
    } catch (cause) {
      showToast(
        cause instanceof Error ? cause.message : "The copy could not be saved on this device.",
        { variant: "danger" }
      );
    } finally {
      setSavingCopy(false);
    }
  };

  const stopSharing = async () => {
    if (!access?.owner || !access.ownerKey || !session) return;
    const shared = session.getContent();
    const safeShared = shared.content?.length ? shared : EMPTY_SCREENPLAY;
    if (!saveProjectDoc(props.projectId, safeShared)) {
      throw new Error(
        "The latest shared text could not be saved on this device, so sharing was left on."
      );
    }
    // The local copy must win the first post-Duet cloud reconcile. Otherwise a
    // stale LWW row could replace text that was written in the shared room.
    projSetDirty(props.projectId, true);
    const record: DuetShareRecord = { token: access.token, ownerKey: access.ownerKey };
    await revokeDuetRoom(record, session);
    const finalShared = session.getContent();
    const safeFinal = finalShared.content?.length ? finalShared : EMPTY_SCREENPLAY;
    if (!saveProjectDoc(props.projectId, safeFinal)) {
      throw new Error(
        "The link was stopped, but the final shared text could not be saved on this device. Free some storage, then try again."
      );
    }
    const finalTitle = session.getTitle()?.trim();
    if (finalTitle && finalTitle !== props.title) props.onRename(finalTitle);
    clearProjectShare(props.projectId);
    clearDuetDocumentCache(access.token);
    setShowShare(false);
    setSession(null);
    setAccess(null);
  };

  const modal =
    showShare && access ? (
      <DuetShareModal
        record={{ token: access.token, ownerKey: access.ownerKey ?? "" }}
        owner={access.owner}
        displayName={displayName}
        onDisplayNameChange={setDisplayName}
        onStop={stopSharing}
        onClose={() => setShowShare(false)}
      />
    ) : null;

  const copyModal = copyPlan ? (
    <DuetSaveCopyModal
      plan={copyPlan}
      saving={savingCopy}
      onSave={saveCopy}
      onClose={() => setCopyPlan(null)}
    />
  ) : null;

  if (access && !session && sessionError) {
    return (
      <>
        <div className="host-hydrate">
          <p>{sessionError ?? "Opening the shared script…"}</p>
          {sessionError && (
            <button type="button" className="tb-btn" onClick={props.onBack}>
              Back to projects
            </button>
          )}
        </div>
        {modal}
      </>
    );
  }

  return (
    <>
      <ScreenplayEditor
        key={session ? `duet:${session.token}` : "local"}
        {...props}
        duetSession={session}
        duetStatus={duetStatus}
        participants={participants}
        duetReady={duetReady}
        duetPending={access !== null && session === null}
        duetAccess={access}
        onOpenShare={openShare}
        onSaveCopy={
          session && !session.owner && onSaveDuetCopy ? openSaveCopy : undefined
        }
      />
      {modal}
      {copyModal}
    </>
  );
}

function ScreenplayEditor({
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
  duetSession,
  duetStatus,
  participants,
  duetReady,
  duetPending,
  duetAccess,
  onOpenShare,
  onSaveCopy,
}: Omit<ScreenplayBodyProps, "duet" | "onSaveDuetCopy"> & {
  duetSession: DuetSession | null;
  duetStatus: DuetConnectionStatus;
  participants: DuetParticipant[];
  duetReady: boolean;
  duetPending: boolean;
  /** The room this editor is bound to, owned or joined by link. */
  duetAccess: DuetAccess | null;
  onOpenShare: () => void;
  /** Guest-only (stage 3): keep a snapshot of the room as your own project. */
  onSaveCopy?: () => void;
}) {
  const initialContent = useMemo(
    () => loadProjectDoc(projectId) ?? EMPTY_SCREENPLAY,
    [projectId]
  );
  const [sharedTitle, setSharedTitle] = useState<string | null>(
    () => duetSession?.getTitle() ?? null
  );
  const activeTitle = duetSession ? sharedTitle || title : title;
  const duetActive = duetSession !== null || duetPending;
  const localCloudSyncAllowed = duetAllowsLocalCloudSync(duetSession, duetPending);
  const cloudSyncProjectId = duetCloudSyncProjectId(projectId, duetPending);
  // A guest's room has no project row here, so every local mirror of it would
  // be filed as a phantom recovered-conflict project. Their crash backup is the
  // room's own Y.Doc cache; "Save a copy" is the deliberate way to keep it.
  const mirrorsToLibrary = duetMirrorsToLibrary(duetAccess);
  const renameActiveTitle = useCallback(
    (next: string) => {
      renameSharedOrLocalTitle(duetSession, onRename, next);
    },
    [duetSession, onRename]
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

  // Takes a getter, not a document: serializing a feature-length script on
  // every keystroke only to throw all but the last copy away was the single
  // biggest cost of a keypress. The document is read once, when the save runs.
  const debouncedSave = useMemo(
    () =>
      debounce(
        (read: () => JSONContent) => {
          const doc = read();
          if (!mirrorsToLibrary) {
            unsavedRef.current = false;
            setSaved(true);
            setSaveError(duetSession?.localBackupFailed() === true);
            return;
          }
          const ok = saveProjectDoc(projectId, doc);
          setSaveError(!ok || duetSession?.localBackupFailed() === true);
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
    [projectId, duetSession, mirrorsToLibrary]
  );

  const measure = useCallback((ed: Editor) => {
    if (ed.isDestroyed) return;
    const text = ed.getText({ blockSeparator: "\n" }).trim();
    setWordCount(text ? text.split(/\s+/).length : 0);
  }, []);
  // The word count trails typing by a moment instead of walking the whole
  // script (and re-rendering the whole editor) on every keystroke.
  const measureSoon = useMemo(() => debounce((ed: Editor) => measure(ed), 400), [measure]);
  useEffect(() => () => measureSoon.cancel(), [measureSoon]);

  // The page count shown to the writer is the SAME one the page sheets use (the
  // visual Pagination engine, via onPages below). We no longer run the export
  // paginator on every keystroke: it duplicated work and could disagree with the
  // pages actually on screen (F17/F37).
  const [pages, setPages] = useState(1);
  const [paginationTick, setPaginationTick] = useState(0);
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
        collaboration: duetSession ?? undefined,
      }),
      Pagination.configure({
        // Synchronous: the pass runs just before the browser paints, and the
        // sheets behind the text must change in that same frame, or a new
        // page's text shows for a frame on the bare desk.
        onPages: (n: number) => flushSync(() => setPages(n)),
        onLayout: () => setPaginationTick((tick) => tick + 1),
      }),
    ],
    [showGhostHint, duetSession]
  );

  // Read by editorProps.handleScrollToSelection (see the typewriter effect).
  const typewriterRef = useRef(prefs.focusTypewriter);
  typewriterRef.current = prefs.focusTypewriter;

  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    editable: !duetActive,
    // A Yjs-bound editor must never also receive content. Doing both imports
    // the local script into the shared fragment and duplicates whole drafts.
    ...(duetActive ? {} : { content: initialContent }),
    editorProps: {
      attributes: { class: "sp-prose", spellcheck: "false" },
      scrollMargin: TYPING_SCROLL_MARGIN,
      scrollThreshold: TYPING_SCROLL_MARGIN,
      handleScrollToSelection: (view) => {
        if (!typewriterRef.current) return false;
        centerCaret(view);
        return true;
      },
    },
    onCreate: ({ editor }) => {
      editorRef.current = editor;
      setCurrentElement(currentElementType(editor.state));
      setCaretLine(editor.state.selection.$from.index(0));
      setDualActive(editor.state.selection.$from.parent.attrs?.dual === true);
      measure(editor);
      if (process.env.NODE_ENV !== "production") {
        (window as unknown as { __lessEditor?: Editor }).__lessEditor = editor;
        // Development-only: time a real pagination pass on this script, and
        // read the PDF engine's page starts to compare with the screen.
        (window as unknown as { __lessPaginationBench?: () => unknown }).__lessPaginationBench =
          () => benchmarkPaginationPass(editor.view);
        (window as unknown as { __lessExportStarts?: () => unknown }).__lessExportStarts = () =>
          paginate(docToLines(editor.getJSON())).pages.map((p) => p.startLine);
      }
    },
    onUpdate: ({ editor }) => {
      if (!duetSession) {
        unsavedRef.current = true;
        setSaved(false);
        debouncedSave(() => editor.getJSON());
      }
      measureSoon(editor);
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

  useEffect(() => {
    if (!editor || !duetSession) return;
    duetSession.seedWhenSynced(editor.schema, initialContent, title);
  }, [editor, duetSession, initialContent, title]);

  useEffect(() => {
    if (editor) editor.setEditable(!duetActive || (duetSession !== null && duetReady));
  }, [editor, duetSession, duetReady, duetActive]);

  useEffect(() => {
    if (!duetSession) {
      setSharedTitle(null);
      return;
    }
    return duetSession.subscribeTitle(setSharedTitle);
  }, [duetSession]);

  useEffect(() => {
    if (!duetSession) return;
    // Offline typing stays in the Y.Doc and merges on reconnect. The local
    // autosave is a mirror of that state, never a second source writing back.
    return duetSession.subscribeDocument(() => {
      const shared = duetSession.getContent();
      const safeShared = shared.content?.length ? shared : EMPTY_SCREENPLAY;
      unsavedRef.current = true;
      setSaved(false);
      debouncedSave(() => safeShared);
    });
  }, [duetSession, debouncedSave]);

  const rawOutline = useOutline(editor);
  // Replace the outline's cheap headless estimate with the page decorations
  // that actually draw the editor whenever layout settles.
  const outline = useMemo<Outline>(
    () =>
      editor
        ? {
            ...rawOutline,
            scenes: rawOutline.scenes.map((scene) => ({
              ...scene,
              page: pageAtPos(editor.state, scene.pos),
            })),
          }
        : rawOutline,
    [rawOutline, editor, paginationTick]
  );
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
  const titleRef = useRef(activeTitle);
  titleRef.current = activeTitle;

  const syncOpts = useMemo(
    () => ({
      disabled: !localCloudSyncAllowed,
      projectId: cloudSyncProjectId,
      type: "screenplay" as const,
      status,
      deriveTitle,
      getTitle: () => getProjectMeta(projectId)?.title ?? titleRef.current,
      // A restore or import pulls content through here even with cloud sync
      // off, so it needs the same guard as the autosave: a guest's room has no
      // project row to write to.
      saveLocalDoc: (d: JSONContent) =>
        mirrorsToLibrary ? saveProjectDoc(projectId, d) : true,
      loadLocalTitlePage: () => loadProjectTitlePage(projectId),
      saveLocalTitlePage: (tp: ReturnType<typeof loadProjectTitlePage>) =>
        saveProjectTitlePage(projectId, tp),
      hasUnsavedLocalEdits: () => unsavedRef.current,
      isDirty: () => projIsDirty(projectId),
      setDirty: (b: boolean) => projSetDirty(projectId, b),
      isTitlePageDirty: () => projIsTpDirty(projectId),
      setTitlePageDirty: (b: boolean) => projSetTpDirty(projectId, b),
      isTitleDirty: () => projIsTitleDirty(projectId),
      setTitleDirty: (b: boolean) => projSetTitleDirty(projectId, b),
      getLastSavedAt: () => projGetLastSavedAt(projectId),
      setLastSavedAt: (iso: string | null) => projSetLastSavedAt(projectId, iso),
      getSyncedPrint: () => projGetSyncedPrint(projectId),
      setSyncedPrint: (print: string | null) => projSetSyncedPrint(projectId, print),
      onRemoteUpdate: (kind: "pulled" | "conflict") =>
        showToast(
          kind === "conflict"
            ? "This was changed somewhere else, so that version is showing. Your unsaved edits are in History."
            : "Updated with changes made somewhere else."
        ),
      onCloudCreated: (id: string) => markCloudCreated(id),
      setCloudCreatePending: (pending: boolean) =>
        patchProjectMeta(projectId, { cloudCreatePending: pending }),
    }),
    [projectId, cloudSyncProjectId, status, localCloudSyncAllowed, mirrorsToLibrary]
  );

  const {
    status: syncStatus,
    pulledTick,
    pulledSaveOk,
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
      if (ed && unsavedRef.current && mirrorsToLibrary) {
        const current = duetSession?.getContent() ?? ed.getJSON();
        saveProjectDoc(projectId, current.content?.length ? current : EMPTY_SCREENPLAY);
      }
      flushRef.current();
    };
  }, [projectId, debouncedSave, duetSession, mirrorsToLibrary]);

  // The unmount cleanup above does NOT run when the tab is closed, refreshed, or
  // backgrounded. These handlers force the pending edit to localStorage (a
  // synchronous, reliable write) on hide/close so the last few keystrokes are
  // never lost, and best-effort push to the cloud while the page is still alive.
  useEffect(() => {
    const flushLocal = () => {
      const ed = editorRef.current;
      if (!ed || !unsavedRef.current || !mirrorsToLibrary) return;
      debouncedSave.cancel();
      const current = duetSession?.getContent() ?? ed.getJSON();
      const ok = saveProjectDoc(
        projectId,
        current.content?.length ? current : EMPTY_SCREENPLAY
      );
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
  }, [projectId, debouncedSave, duetSession, mirrorsToLibrary]);

  useEffect(() => {
    if (editor && pulledTick > 0) {
      debouncedSave.cancel();
      measure(editor);
      setSaved(pulledSaveOk);
      if (pulledSaveOk) unsavedRef.current = false;
      setSaveError(!pulledSaveOk);
    }
  }, [pulledTick, pulledSaveOk, editor, measure, debouncedSave]);

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
      const prev = breakdownItemsRef.current;
      // Dedupe on category + case-insensitive name so the same tag is not
      // added twice from the selection and the manual field.
      const exists = prev.some(
        (it) => it.category === category && it.name.toLowerCase() === clean.toLowerCase()
      );
      if (exists) return;
      const next = [...prev, { id: crypto.randomUUID(), category, name: clean }];
      breakdownItemsRef.current = next;
      setBreakdownItems(next);
      saveBreakdown(projectId, next);
    },
    [projectId]
  );

  const removeBreakdownItem = useCallback(
    (id: string) => {
      const next = breakdownItemsRef.current.filter((it) => it.id !== id);
      breakdownItemsRef.current = next;
      setBreakdownItems(next);
      saveBreakdown(projectId, next);
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
      breakdownToText(breakdownResult, activeTitle),
      safeFilename(activeTitle + " breakdown", "txt"),
      "text/plain;charset=utf-8"
    );
  }, [breakdownResult, activeTitle]);

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
      if (n === 0) {
        jumpToScene(1);
        return;
      }
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

  // Typewriter scrolling (2F): while the pref is on, typing keeps the caret's
  // line at a fixed height in the view instead of drifting down the window.
  // ProseMirror asks before every scroll it makes for the writer's own input
  // (handleScrollToSelection in editorProps reads this ref), and the arrow and
  // page keys, which the browser moves the caret for, centre on the next frame.
  // Remote updates, pagination passes and clicks never scroll the view.
  useEffect(() => {
    if (!editor || !prefs.focusTypewriter) return;
    const dom = editor.view.dom;
    let frame = 0;
    const onKey = (e: KeyboardEvent) => {
      if (!/^(ArrowUp|ArrowDown|PageUp|PageDown)$/.test(e.key)) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => centerCaret(editor.view));
    };
    dom.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      dom.removeEventListener("keydown", onKey);
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
        hint: mod + ELEMENT_NUMBER[t],
        run: () => editor?.chain().focus().setElement(t).run(),
      });
    }
    cmds.push({ id: "dual", group: "Format", label: "Toggle dual dialogue", hint: mod + "D", run: toggleDual });
    cmds.push({ id: "scenes", group: "Panel", label: "Open scenes", run: () => setActivePanel("scenes") });
    cmds.push({
      id: "find",
      group: "Panel",
      label: "Find and replace",
      hint: mod + "F",
      run: () => setActivePanel("find"),
    });
    cmds.push({ id: "cast", group: "Panel", label: "Cast and locations", run: () => setActivePanel("cast") });
    cmds.push({ id: "reports", group: "Panel", label: "Reports", run: () => setActivePanel("reports") });
    cmds.push({ id: "notes", group: "Panel", label: "Notes", run: () => setActivePanel("notes") });
    cmds.push({ id: "breakdown", group: "Panel", label: "Breakdown", run: () => setActivePanel("breakdown") });
    cmds.push({ id: "history", group: "Panel", label: "Version history", run: () => setActivePanel("history") });
    cmds.push({ id: "titlepage", group: "Panel", label: "Title page", run: () => setShowTitlePage(true) });
    cmds.push({ id: "shortcuts", group: "Help", label: "Keyboard shortcuts", hint: "?", run: () => setShowShortcuts(true) });
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
  }, [editor, prefs, user, outline.scenes, toggleDual, handleExport, onPrefsChange, onBack, jumpToScene, pageLock, lockPages, unlockPages, hasSelection, tagSelection, mod]);

  // ---- Chrome wiring (Part 2B): menus, rail, dock content ------------------

  const signOutAndFlush = async () => {
    // Land any pending edit in the cloud before sign-out wipes the local
    // cloud-backed copy (the reconcile effect clears it on identity change).
    await flushRef.current();
    if (hasPendingCloudWork()) {
      showToast("Some changes have not synced. Reconnect and sync before signing out.", {
        variant: "danger",
      });
      return;
    }
    await signOut();
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

  // The overflow menu, grouped under small labels so twenty rows read at a
  // glance: the script's own actions first, then what the page shows, the
  // script face, page numbering, the project's status, and the account.
  const overflowItems: MenuItem[] = [
    { label: "Share…", onSelect: onOpenShare },
    // Guests only. The owner already has this script in their library, and the
    // shared text writes back into it, so a copy action would only confuse.
    ...(onSaveCopy
      ? [{ label: "Save a copy to my library…", onSelect: onSaveCopy } as MenuItem]
      : []),
    { label: "Title page…", onSelect: () => setShowTitlePage(true) },
    { label: "Import into this project…", onSelect: () => importInputRef.current?.click() },
    { kind: "divider" },
    { kind: "label", label: "View" },
    { kind: "checkbox", label: "Spell check", checked: prefs.spellCheck, onToggle: () => onPrefsChange({ spellCheck: !prefs.spellCheck }) },
    { kind: "checkbox", label: "Scene numbers", checked: prefs.sceneNumbers, onToggle: () => onPrefsChange({ sceneNumbers: !prefs.sceneNumbers }) },
    { kind: "checkbox", label: "Auto (CONT'D)", checked: prefs.autoContd, onToggle: () => onPrefsChange({ autoContd: !prefs.autoContd }) },
    { kind: "checkbox", label: "Revision mode", checked: prefs.revisionMode, onToggle: () => onPrefsChange({ revisionMode: !prefs.revisionMode }) },
    ...(prefs.revisionMode
      ? [{ label: "Clear revision marks", danger: true, onSelect: clearRevisions } as MenuItem]
      : []),
    { kind: "checkbox", label: "Typewriter scrolling", checked: prefs.focusTypewriter, onToggle: () => onPrefsChange({ focusTypewriter: !prefs.focusTypewriter }) },
    { label: "Use system theme", onSelect: () => onPrefsChange({ theme: "system" }) },
    { kind: "divider" },
    { kind: "label", label: "Script font" },
    { kind: "radio", group: "font", label: "Courier Prime", checked: prefs.font === "courier-prime", onSelect: () => onPrefsChange({ font: "courier-prime" }) },
    { kind: "radio", group: "font", label: "Courier", checked: prefs.font === "courier", onSelect: () => onPrefsChange({ font: "courier" }) },
    { kind: "divider" },
    { kind: "label", label: "Pages" },
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
    ...(!localCloudSyncAllowed
      ? []
      : [
          { kind: "divider" } as MenuItem,
          { kind: "label", label: "Status" } as MenuItem,
          ...STATUS_ROWS.map(
            (s): MenuItem => ({
              kind: "radio",
              group: "status",
              label: s.label,
              checked: status === s.value,
              onSelect: () => onStatusChange(s.value),
            })
          ),
        ]),
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
        title={activeTitle}
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
        title={activeTitle}
        onRename={renameActiveTitle}
        onBack={onBack}
        cloudConfigured={isCloudConfigured}
        user={user}
        syncStatus={syncStatus}
        collaborationStatus={duetSession ? duetStatus : undefined}
        participants={duetSession ? participants : undefined}
        sessionExpired={!!sessionExpired}
        onSignIn={() => setShowAuth(true)}
        modLabel={mod}
        onOpenPalette={() => setShowPalette(true)}
        exportItems={exportItems}
        overflowItems={overflowItems}
        theme={prefs.theme}
        onThemeChange={(theme) => onPrefsChange({ theme })}
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
            collaborative={duetActive}
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
              <PageBackdrop pages={pages} variant="screenplay" />
              {duetActive && !duetReady && (
                <div className="duet-editor-loading" role="status">
                  Connecting to the shared script…
                </div>
              )}
              <EditorContent editor={editor} className="sp-editor" />
            </div>
          </div>
        </div>
        <HintCard modLabel={mod} />
      </EditorShell>

      {duetActive && !duetReady && (
        <div className="duet-initializing-overlay" role="status">
          <div>
            <p>Connecting before the shared script opens…</p>
            <button type="button" className="ui-btn ui-btn-text" onClick={onBack}>
              Back to projects
            </button>
          </div>
        </div>
      )}

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
                restoreVersion(confirmRestore.content, confirmRestore.titlePage);
                setConfirmRestore(null);
                setActivePanel(null);
              },
            },
          ]}
        >
          <p>This replaces your current text and title page with the selected version.</p>
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
