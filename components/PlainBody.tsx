"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  hasPendingCloudWork,
  patchProjectMeta,
  type ProjectStatus,
} from "@/lib/storage/projects";
import { isCloudConfigured } from "@/lib/cloud/client";
import { signOut } from "@/lib/cloud/auth";
import { showToast } from "./ui/Toast";
import { useCloudSync } from "@/lib/storage/useCloudSync";
import { exportPlain, type PlainExportFormat } from "@/lib/export/plainExport";
import { modKeyLabel } from "@/lib/platform";
import { EditorShell, type PanelId, type RailItem } from "./chrome/EditorShell";
import { PlainToolbar } from "./PlainToolbar";
import { AuthModal } from "./AuthModal";
import { DocsPanel } from "./DocsPanel";
import { HistoryPanel } from "./HistoryPanel";
import { Modal } from "./ui/Modal";
import type { MenuItem } from "./ui/Menu";
import { listFolders } from "@/lib/storage/folders";
import { cardForProject } from "@/lib/storage/library";
import { PageBackdrop } from "./PageBackdrop";

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
}) {
  const initialContent = useMemo(
    () => loadProjectDoc(projectId) ?? EMPTY_PLAIN_DOC,
    [projectId]
  );

  const [words, setWords] = useState(0);
  const [chars, setChars] = useState(0);
  const [pages, setPages] = useState(1);
  const [caretPage, setCaretPage] = useState(1);
  const [saved, setSaved] = useState(true);
  const [saveError, setSaveError] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  // Plain documents get one dock panel: History (2B.3).
  const [activePanel, setActivePanel] = useState<PanelId | null>(null);
  // A history restore waiting on its confirm modal (D9: no native dialogs).
  const [confirmRestore, setConfirmRestore] = useState<{
    content: JSONContent;
  } | null>(null);
  const editorRef = useRef<Editor | null>(null);

  // True only while an edit is newer than the last successful write, so the
  // exit flushes below never re-save an untouched document (a save stamps
  // updatedAt, and the home orders by that clock: reading must not reorder).
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
          }
        },
        600,
        2500
      ),
    [projectId]
  );

  const measure = useCallback((ed: Editor) => {
    const text = ed.getText({ blockSeparator: "\n" });
    const trimmed = text.trim();
    setWords(trimmed ? trimmed.split(/\s+/).length : 0);
    setChars(text.length);
  }, []);

  const extensions = useMemo(
    () => [...buildPlainExtensions(), DocPagination.configure({ onPages: setPages })],
    []
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    content: initialContent,
    editorProps: { attributes: { class: "pl-prose", spellcheck: "true" } },
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
      debouncedSave(editor.getJSON());
      measure(editor);
    },
  });

  // The status bar reads the same decoration set that places the text, so its
  // current page cannot disagree with the visible sheets.
  useEffect(() => {
    if (!editor) return;
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
    if (!editor) return;
    requestDocPagination(editor);
  }, [editor, prefs.docFont, prefs.docFontSize, prefs.focusMode, activePanel]);

  // Live title via a ref so an explicit document title is never overwritten by
  // its first line on save.
  const titleRef = useRef(title);
  titleRef.current = title;

  const syncOpts = useMemo(
    () => ({
      projectId,
      type: "plain" as const,
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
      onCloudCreated: (id: string) => markCloudCreated(id),
      setCloudCreatePending: (pending: boolean) =>
        patchProjectMeta(projectId, { cloudCreatePending: pending }),
    }),
    [projectId, status]
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
            <PlainToolbar editor={editor} />
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
            <span className="status-item">Page {caretPage} of {pages}</span>
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
              {saveError ? "Not saved" : saved ? "Saved" : "Saving…"}
            </span>
          </div>
        }
      >
        <div
          className="page-scroll"
          style={{ ["--doc-font-size" as string]: `${prefs.docFontSize ?? 16}px` }}
        >
          <div className="page-wrap">
            <div
              className="page-host page-host-pl"
              style={{ minHeight: (Math.max(1, pages) - 1) * STRIDE + PAGE_H }}
            >
              <PageBackdrop pages={pages} />
              <EditorContent editor={editor} className="pl-doc" />
            </div>
          </div>
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
    </>
  );
}
