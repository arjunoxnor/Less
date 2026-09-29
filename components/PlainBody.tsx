"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import type { CloudUser as User } from "@/lib/cloud/client";

import { buildPlainExtensions } from "@/lib/editor/buildPlainExtensions";
import {
  DocPagination,
  docPageAtPos,
  requestDocPagination,
} from "@/lib/editor/docPagination";
import { PAGE_H, STRIDE } from "@/lib/editor/pagination";
import { TYPING_SCROLL_MARGIN } from "@/lib/editor/scrollComfort";
import { derivePlainTitle } from "@/lib/editor/plainDocUtils";
import { debounce, type Prefs } from "@/lib/storage/localStore";
import {
  EMPTY_PLAIN_DOC,
  getProjectMeta,
  listProjects,
  loadProjectDoc,
  saveProjectDoc,
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
  patchProjectMeta,
  type ProjectStatus,
  type ProjectType,
} from "@/lib/storage/projects";
import { isCloudConfigured } from "@/lib/cloud/client";
import { signOut } from "@/lib/cloud/auth";
import { showToast } from "./ui/Toast";
import { useCloudSync } from "@/lib/storage/useCloudSync";
import { exportPlain, type PlainExportFormat } from "@/lib/export/plainExport";
import { modKeyLabel } from "@/lib/platform";
import { EditorShell, type PanelId, type RailItem } from "./chrome/EditorShell";
import { PlainToolbar } from "./PlainToolbar";
import { BoardTools } from "./BoardTools";
import { insertImages, type PlacedImage } from "@/lib/editor/boardNodes";
import { imageFilesFrom, uploadImage } from "@/lib/cloud/assets";
import { VoiceStrip } from "./VoiceStrip";
import { AuthModal } from "./AuthModal";
import { DocsPanel } from "./DocsPanel";
import { HistoryPanel } from "./HistoryPanel";
import { Modal } from "./ui/Modal";
import type { MenuItem } from "./ui/Menu";
import { listFolders } from "@/lib/storage/folders";
import { cardForProject } from "@/lib/storage/library";
import { PageBackdrop } from "./PageBackdrop";
import { useCalmPending } from "@/lib/ui/useCalmPending";
import { MicGlyph, RecordingBar } from "./RecordingBar";
import { canRecord, newVoiceId, VoiceRecording } from "@/lib/voicenote/recorder";
import { encodePeaks, formatDuration } from "@/lib/voicenote/waveform";
import { flushUploads } from "@/lib/voicenote/upload";
import { rememberLocalRecording } from "@/lib/voicenote/player";
import {
  ensureVoicePending,
  formatRecordedAt,
  insertVoicePending,
  removeVoicePending,
  type OriginalTranscript,
} from "@/lib/editor/voiceNodes";

export function PlainBody({
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
  onOpenProject,
  autoFocusTitle,
  type = "plain",
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
  /** Save-and-switch to a sibling project (the Docs panel's jump). */
  onOpenProject?: (id: string) => void;
  /** Focus and select the title on mount (instant-create flow, 2C). */
  autoFocusTitle?: boolean;
  /** Which plain-schema type this is. A voice note must keep pushing its own
      type on every save, or the cloud row reverts to a plain document and the
      structuring worker stops recognising it. */
  type?: ProjectType;
}) {
  const initialContent = useMemo(
    () => loadProjectDoc(projectId) ?? EMPTY_PLAIN_DOC,
    [projectId]
  );
  // A board is the same document on a wide, unpaginated page, with images.
  const isBoard = type === "board";
  // "Show only what I liked" hides the rest with a class. It never edits.
  const [likedOnly, setLikedOnly] = useState(false);

  const [words, setWords] = useState(0);
  const [chars, setChars] = useState(0);
  const [pages, setPages] = useState(1);
  const [caretPage, setCaretPage] = useState(1);
  const [saved, setSaved] = useState(true);
  const [saveError, setSaveError] = useState(false);
  // Only a save that is actually slow gets a word (see useCalmPending).
  const showSaving = useCalmPending(!saved && !saveError, 3000);
  const [showAuth, setShowAuth] = useState(false);
  // Plain documents get one dock panel: History (2B.3).
  const [activePanel, setActivePanel] = useState<PanelId | null>(null);
  // A history restore waiting on its confirm modal (D9: no native dialogs).
  const [confirmRestore, setConfirmRestore] = useState<{
    content: JSONContent;
  } | null>(null);
  const editorRef = useRef<Editor | null>(null);

  // Voice notes: record into an ordinary document (lib/voicenote,
  // lib/editor/voiceNodes.ts). Transcription happens later, on the Mac.
  const canVoice = type === "plain";
  const [recording, setRecording] = useState<VoiceRecording | null>(null);
  const [micStarting, setMicStarting] = useState(false);
  const recordingRef = useRef<VoiceRecording | null>(null);
  const [originalNote, setOriginalNote] = useState<OriginalTranscript | null>(null);
  const showOriginalRef = useRef<(note: OriginalTranscript) => void>(() => {});
  showOriginalRef.current = setOriginalNote;

  // True only while an edit is newer than the last successful write, so the
  // exit flushes below never re-save an untouched document (a save stamps
  // updatedAt, and the home orders by that clock: reading must not reorder).
  const unsavedRef = useRef(false);

  // Takes a getter: the document is serialized once, when the save runs, not
  // on every keystroke (see ScreenplayBody).
  const debouncedSave = useMemo(
    () =>
      debounce(
        (read: () => JSONContent) => {
          const ok = saveProjectDoc(projectId, read());
          setSaveError(!ok);
          if (ok) {
            unsavedRef.current = false;
            setSaved(true);
          }
        },
        600,
        2500
      ),
    [projectId]
  );

  const measure = useCallback((ed: Editor) => {
    if (ed.isDestroyed) return;
    const text = ed.getText({ blockSeparator: "\n" });
    const trimmed = text.trim();
    setWords(trimmed ? trimmed.split(/\s+/).length : 0);
    setChars(text.length);
  }, []);
  // Counts trail typing by a moment instead of re-walking the document and
  // re-rendering the editor on every keystroke.
  const measureSoon = useMemo(() => debounce((ed: Editor) => measure(ed), 400), [measure]);
  useEffect(() => () => measureSoon.cancel(), [measureSoon]);

  const extensions = useMemo(
    () => [
      ...buildPlainExtensions(
        type === "voice"
          ? {
              placeholder: "Talk, or type. Then press Process.",
              onOriginalTranscript: (note) => showOriginalRef.current(note),
            }
          : isBoard
            ? { board: true, placeholder: "Drop images here, or start typing." }
            : { onOriginalTranscript: (note) => showOriginalRef.current(note) }
      ),
      // A board has no sheets: pictures do not break across pages.
      // flushSync: the sheets behind the text change in the same frame as the
      // pass that moved the text (see ScreenplayBody).
      ...(isBoard
        ? []
        : [DocPagination.configure({ onPages: (n: number) => flushSync(() => setPages(n)) })]),
    ],
    []
  );

  // Upload dropped, pasted, or picked images, then place them. Read through a
  // ref because the editor's props are fixed at creation and `user` is not.
  const addImages = async (files: File[], pos?: number) => {
    const ed = editorRef.current;
    if (!ed || files.length === 0) return;
    if (!user || sessionExpired) {
      showToast("Sign in to add images.");
      return;
    }
    showToast(files.length === 1 ? "Adding image" : `Adding ${files.length} images`);
    const placed: PlacedImage[] = [];
    for (const file of files) {
      try {
        const up = await uploadImage(file);
        placed.push({ src: up.url, width: up.width, height: up.height });
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Could not add the image.", {
          variant: "danger",
        });
      }
    }
    if (placed.length) insertImages(ed, placed, pos);
  };
  const addImagesRef = useRef(addImages);
  addImagesRef.current = addImages;

  /** The card gets its length and shape the moment recording stops. The audio
   *  file is finished and kept on the device a beat later (VoiceRecording.stop). */
  const finishCard = (rec: VoiceRecording) => {
    const ed = editorRef.current;
    if (!ed || ed.isDestroyed) return;
    ensureVoicePending(ed, {
      id: rec.id,
      mime: rec.mime,
      recordedAt: rec.recordedAt,
      duration: rec.elapsedMs(),
      peaks: encodePeaks(rec.samples),
      state: "saved",
    });
  };
  const finishCardRef = useRef(finishCard);
  finishCardRef.current = finishCard;

  const stopRecording = () => {
    const rec = recordingRef.current;
    if (!rec) return;
    recordingRef.current = null;
    setRecording(null);
    finishCard(rec);
    void rec.stop().then((done) => {
      rememberLocalRecording(rec.id, done.blob);
      return flushUploads();
    });
  };
  const stopRecordingRef = useRef(stopRecording);
  stopRecordingRef.current = stopRecording;

  const startRecording = async () => {
    if (!editorRef.current || recordingRef.current || micStarting) return;
    if (!canRecord()) {
      showToast("This browser cannot record audio.", { variant: "danger" });
      return;
    }
    setMicStarting(true);
    let rec: VoiceRecording;
    try {
      rec = await VoiceRecording.start(newVoiceId());
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Recording could not start.", { variant: "danger" });
      return;
    } finally {
      setMicStarting(false);
    }
    // The document may have closed while the browser asked for the microphone.
    const ed = editorRef.current;
    if (!ed || ed.isDestroyed || recordingRef.current) {
      rec.cancel();
      return;
    }
    insertVoicePending(ed, { id: rec.id, mime: rec.mime, recordedAt: rec.recordedAt, state: "recording" });
    rec.onFull = () => {
      showToast("This note reached the longest a recording can be, so it was saved. Record another to keep going.");
      stopRecordingRef.current();
    };
    rec.onEnded = () => {
      showToast("The microphone stopped, so the recording was saved.");
      stopRecordingRef.current();
    };
    recordingRef.current = rec;
    setRecording(rec);
  };

  const discardRecording = () => {
    const rec = recordingRef.current;
    if (!rec) return;
    recordingRef.current = null;
    setRecording(null);
    rec.cancel();
    const ed = editorRef.current;
    if (ed && !ed.isDestroyed) removeVoicePending(ed, rec.id);
  };

  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    content: initialContent,
    editorProps: {
      attributes: { class: "pl-prose", spellcheck: "true" },
      scrollMargin: TYPING_SCROLL_MARGIN,
      scrollThreshold: TYPING_SCROLL_MARGIN,
      handleDrop: (view, event, _slice, moved) => {
        if (!isBoard || moved) return false; // an internal drag is ProseMirror's
        const files = imageFilesFrom(event.dataTransfer);
        if (files.length === 0) return false;
        event.preventDefault();
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        void addImagesRef.current(files, at);
        return true;
      },
      handlePaste: (_view, event) => {
        if (!isBoard) return false;
        const files = imageFilesFrom(event.clipboardData);
        if (files.length === 0) return false;
        event.preventDefault();
        void addImagesRef.current(files);
        return true;
      },
    },
    onCreate: ({ editor }) => {
      editorRef.current = editor;
      measure(editor);
      if (process.env.NODE_ENV !== "production") {
        (window as unknown as { __lessPlainEditor?: Editor }).__lessPlainEditor = editor;
      }
    },
    onUpdate: ({ editor }) => {
      unsavedRef.current = true;
      setSaved(false);
      debouncedSave(() => editor.getJSON());
      measureSoon(editor);
    },
  });

  // The status bar reads the same decoration set that places the text, so its
  // current page cannot disagree with the visible sheets.
  useEffect(() => {
    if (!editor || isBoard) return;
    const sync = () => {
      setCaretPage(docPageAtPos(editor.state, editor.state.selection.head));
    };
    sync();
    editor.on("transaction", sync);
    return () => {
      editor.off("transaction", sync);
    };
  }, [editor]);

  // Ancestor style changes do not always resize a short prose root. This
  // explicit request covers every non-content reflow named by the page spec.
  useEffect(() => {
    if (!editor || isBoard) return;
    requestDocPagination(editor);
  }, [editor, isBoard, prefs.docFont, prefs.docFontSize, prefs.focusMode, activePanel]);

  // Live title via a ref so an explicit document title is never overwritten by
  // its first line on save.
  const titleRef = useRef(title);
  titleRef.current = title;

  const syncOpts = useMemo(
    () => ({
      projectId,
      type,
      status,
      deriveTitle: derivePlainTitle,
      getTitle: () => getProjectMeta(projectId)?.title ?? titleRef.current,
      saveLocalDoc: (d: JSONContent) => saveProjectDoc(projectId, d),
      loadLocalTitlePage: () => null,
      saveLocalTitlePage: () => {},
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
    [projectId, status, type]
  );

  const {
    status: syncStatus,
    pulledTick,
    pulledSaveOk,
    getVersions,
    restoreVersion,
    flush,
    flushBeacon,
  } = useCloudSync(editor, user, syncOpts);

  const flushRef = useRef(flush);
  flushRef.current = flush;
  const flushBeaconRef = useRef(flushBeacon);
  flushBeaconRef.current = flushBeacon;
  useEffect(() => {
    return () => {
      // Closing the document mid-recording finishes the note rather than
      // losing it: its card is completed before the last save below.
      const rec = recordingRef.current;
      if (rec) {
        recordingRef.current = null;
        finishCardRef.current(rec);
        void rec.stop().then((done) => {
          rememberLocalRecording(rec.id, done.blob);
          return flushUploads();
        });
      }
      debouncedSave.cancel();
      const ed = editorRef.current;
      // Only a real pending edit gets written on the way out; see unsavedRef.
      if (ed && unsavedRef.current) saveProjectDoc(projectId, ed.getJSON());
      flushRef.current();
    };
  }, [projectId, debouncedSave]);

  // Tab close / refresh / backgrounding does not run the unmount cleanup, so
  // force the pending edit to localStorage on hide/close and best-effort push
  // to the cloud while the page is still alive.
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
      flushBeaconRef.current(); // keepalive cloud push; the local write above is the guarantee
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
      setSaveError(!pulledSaveOk);
      setSaved(pulledSaveOk);
      if (pulledSaveOk) {
        unsavedRef.current = false;
      }
    }
  }, [pulledTick, pulledSaveOk, editor, measure, debouncedSave]);

  const handleExport = useCallback(
    (format: PlainExportFormat) => {
      if (editor) exportPlain(editor.getJSON(), format, title);
    },
    [editor, title]
  );

  const signOutAndFlush = async () => {
    // Land any pending edit before sign-out clears the local cloud copy.
    await flushRef.current();
    if (hasPendingCloudWork()) {
      showToast("Some changes have not synced. Reconnect and sync before signing out.", {
        variant: "danger",
      });
      return;
    }
    await signOut();
  };

  const mod = modKeyLabel();

  const exportItems: MenuItem[] = [
    { label: "Markdown", onSelect: () => handleExport("markdown") },
    { label: "Plain text", onSelect: () => handleExport("txt") },
  ];

  const STATUS_ROWS: { value: ProjectStatus; label: string }[] = [
    { value: "not_started", label: "Idea" },
    { value: "writing", label: "Writing" },
    { value: "done", label: "Done" },
  ];

  const overflowItems: MenuItem[] = [
    { label: "Use system theme", onSelect: () => onPrefsChange({ theme: "system" }) },
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

  // A filed document belongs to a folder, so it gets the Docs panel and can
  // jump back to the script. An unfiled note has no folder, so no panel.
  // Membership is read once per mount; the panel itself re-reads on open.
  const [inFilm] = useState(
    () => cardForProject(projectId, listProjects(), listFolders()) !== null
  );

  const railItems: RailItem[] = [
    ...(inFilm ? ([{ kind: "panel", id: "docs", label: "Docs" }] as RailItem[]) : []),
    { kind: "panel", id: "history", label: "History" },
    { kind: "divider" },
  ];

  const dockPanel =
    activePanel === "docs" ? (
      <DocsPanel
        projectId={projectId}
        onOpen={(id) => onOpenProject?.(id)}
        onClose={() => setActivePanel(null)}
      />
    ) : activePanel === "history" ? (
      <HistoryPanel
        getVersions={getVersions}
        onRestore={(content) => {
          setConfirmRestore({ content });
        }}
        onClose={() => setActivePanel(null)}
      />
    ) : null;

  return (
    <>
      <EditorShell
        rootClassName={`app docfont-${prefs.docFont}`}
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
        exportItems={exportItems}
        overflowItems={overflowItems}
        theme={prefs.theme}
        onThemeChange={(theme) => onPrefsChange({ theme })}
        railItems={railItems}
        activePanel={activePanel}
        onPanelChange={setActivePanel}
        dockPanel={dockPanel}
        secondRow={
          <>
            {type === "voice" ? (
              <VoiceStrip
                editor={editor}
                onFlush={() => void flushRef.current?.()}
                signedIn={!!user && !sessionExpired}
              />
            ) : null}
            <PlainToolbar editor={editor} />
            {canVoice ? (
              <div className="toolbar-group">
                <button
                  type="button"
                  className={"tb-btn tb-record" + (recording ? " tb-record-live" : "")}
                  onClick={() => (recording ? stopRecording() : void startRecording())}
                  disabled={micStarting || !editor}
                  aria-label={recording ? "Stop recording" : "Record a voice note"}
                  title={recording ? "Stop recording" : "Record a voice note"}
                >
                  <MicGlyph />
                  <span className="tb-record-label">{recording ? "Stop" : "Record"}</span>
                </button>
              </div>
            ) : null}
            {isBoard ? (
              <BoardTools
                editor={editor}
                onAddImages={(files) => void addImagesRef.current(files)}
                likedOnly={likedOnly}
                onLikedOnlyChange={setLikedOnly}
              />
            ) : null}
            <div className="toolbar-spacer" />
            <div className="toolbar-group">
              <select
                className="tb-select"
                value={prefs.docFont}
                onChange={(e) => onPrefsChange({ docFont: e.target.value as Prefs["docFont"] })}
                title="Font"
                aria-label="Font"
              >
                {[
                  { value: "calibri", label: "Calibri" },
                  { value: "arial", label: "Arial" },
                  { value: "times", label: "Times New Roman" },
                  { value: "georgia", label: "Georgia" },
                  { value: "verdana", label: "Verdana" },
                  { value: "proxima", label: "Proxima Nova" },
                  { value: "futura", label: "Futura" },
                  { value: "courier-prime", label: "Courier Prime" },
                ].map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <select
                className="tb-select tb-select-size"
                value={prefs.docFontSize ?? 16}
                onChange={(e) => onPrefsChange({ docFontSize: Number(e.target.value) })}
                title="Font size"
                aria-label="Font size"
              >
                {[11, 12, 13, 14, 16, 18, 20, 24, 28, 32].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </>
        }
        statusBar={
          <div className="status-bar">
            <span className="status-spacer" />
            {isBoard ? null : (
              <span className="status-item">Page {caretPage} of {pages}</span>
            )}
            <span className="status-item">{words.toLocaleString()} words</span>
            <span className="status-item">{chars.toLocaleString()} characters</span>
            <span
              className={"status-item status-saved" + (saveError ? " status-save-error" : "")}
              role="status"
              aria-live="polite"
              title={
                saveError
                  ? "This device's storage is full, so the latest changes could not be saved locally. Sign in to save to the cloud, or free up space."
                  : undefined
              }
            >
              {saveError ? "Not saved" : showSaving ? "Saving…" : "Saved"}
            </span>
          </div>
        }
      >
        {recording ? (
          <RecordingBar rec={recording} onDone={stopRecording} onDiscard={discardRecording} />
        ) : null}
        <div
          className="page-scroll"
          style={{ ["--doc-font-size" as string]: `${prefs.docFontSize ?? 16}px` }}
        >
          {isBoard ? (
            <div className={"board-wrap" + (likedOnly ? " brd-liked-only" : "")}>
              <EditorContent editor={editor} className="pl-doc brd-doc" />
            </div>
          ) : (
            <div className="page-wrap">
              <div
                className="page-host page-host-pl"
                style={{ minHeight: (Math.max(1, pages) - 1) * STRIDE + PAGE_H }}
              >
                <PageBackdrop pages={pages} />
                <EditorContent editor={editor} className="pl-doc" />
              </div>
            </div>
          )}
        </div>
      </EditorShell>

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
                restoreVersion(confirmRestore.content);
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

      {originalNote && (
        <Modal
          title="Original transcript"
          onClose={() => setOriginalNote(null)}
          actions={[
            {
              label: "Copy",
              variant: "text",
              onClick: () => {
                const text = originalNote.raw;
                void navigator.clipboard?.writeText(text).then(
                  () => showToast("Copied."),
                  () => showToast("Could not copy.", { variant: "danger" })
                );
              },
            },
            { label: "Close", variant: "solid", onClick: () => setOriginalNote(null) },
          ]}
        >
          <p className="ui-modal-note">
            {[
              formatRecordedAt(originalNote.recordedAt),
              originalNote.duration ? formatDuration(originalNote.duration / 1000) : "",
            ]
              .filter(Boolean)
              .join(" · ")}
            {originalNote.recordedAt || originalNote.duration ? ". " : ""}
            Word for word, before the cleanup.
          </p>
          <div className="vn-original">
            {originalNote.raw
              .split(/\n{2,}/)
              .filter((para) => para.trim())
              .map((para, i) => (
                <p key={i}>{para}</p>
              ))}
          </div>
        </Modal>
      )}
    </>
  );
}
