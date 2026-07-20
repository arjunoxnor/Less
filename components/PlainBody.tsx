"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import type { CloudUser as User } from "@/lib/cloud/client";

import { buildPlainExtensions } from "@/lib/editor/buildPlainExtensions";
import { derivePlainTitle } from "@/lib/editor/plainDocUtils";
import { debounce, type Prefs } from "@/lib/storage/localStore";
import {
  EMPTY_PLAIN_DOC,
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
  type ProjectStatus,
} from "@/lib/storage/projects";
import { isCloudConfigured } from "@/lib/cloud/client";
import { signOut } from "@/lib/cloud/auth";
import { useCloudSync } from "@/lib/storage/useCloudSync";
import { exportPlain, type PlainExportFormat } from "@/lib/export/plainExport";
import { modKeyLabel } from "@/lib/platform";
import { EditorShell, type PanelId, type RailItem } from "./chrome/EditorShell";
import { PlainToolbar } from "./PlainToolbar";
import { PageBackdrop } from "./PageBackdrop";
import { Pagination, STRIDE, PAGE_H } from "@/lib/editor/pagination";
import { AuthModal } from "./AuthModal";
import { HistoryPanel } from "./HistoryPanel";
import { Modal } from "./ui/Modal";
import type { MenuItem } from "./ui/Menu";

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
}) {
  const initialContent = useMemo(
    () => loadProjectDoc(projectId) ?? EMPTY_PLAIN_DOC,
    [projectId]
  );

  const [words, setWords] = useState(0);
  const [chars, setChars] = useState(0);
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

  const debouncedSave = useMemo(
    () =>
      debounce(
        (doc: JSONContent) => {
          const ok = saveProjectDoc(projectId, doc);
          setSaveError(!ok);
          if (ok) setSaved(true);
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

  const [pages, setPages] = useState(1);
  const extensions = useMemo(
    () => [...buildPlainExtensions(), Pagination.configure({ onPages: setPages })],
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
      setSaved(false);
      debouncedSave(editor.getJSON());
      measure(editor);
    },
  });

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
      getTitle: () => titleRef.current,
      saveLocalDoc: (d: JSONContent) => saveProjectDoc(projectId, d),
      loadLocalTitlePage: () => null,
      saveLocalTitlePage: () => {},
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

  const { status: syncStatus, pulledTick, getVersions, restoreVersion, flush, flushBeacon } =
    useCloudSync(editor, user, syncOpts);

  const flushRef = useRef(flush);
  flushRef.current = flush;
  const flushBeaconRef = useRef(flushBeacon);
  flushBeaconRef.current = flushBeacon;
  useEffect(() => {
    return () => {
      debouncedSave.cancel();
      const ed = editorRef.current;
      if (ed) saveProjectDoc(projectId, ed.getJSON());
      flushRef.current();
    };
  }, [projectId, debouncedSave]);

  // Tab close / refresh / backgrounding does not run the unmount cleanup, so
  // force the pending edit to localStorage on hide/close and best-effort push
  // to the cloud while the page is still alive.
  useEffect(() => {
    const flushLocal = () => {
      const ed = editorRef.current;
      if (!ed) return;
      debouncedSave.cancel();
      const ok = saveProjectDoc(projectId, ed.getJSON());
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
      setSaved(true);
    }
  }, [pulledTick, editor, measure, debouncedSave]);

  const handleExport = useCallback(
    (format: PlainExportFormat) => {
      if (editor) exportPlain(editor.getJSON(), format, title);
    },
    [editor, title]
  );

  const signOutAndFlush = async () => {
    // Land any pending edit before sign-out clears the local cloud copy.
    await flushRef.current();
    void signOut();
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
    { kind: "radio", group: "theme", label: "Light", checked: prefs.theme === "light", onSelect: () => onPrefsChange({ theme: "light" }) },
    { kind: "radio", group: "theme", label: "Dark", checked: prefs.theme === "dark", onSelect: () => onPrefsChange({ theme: "dark" }) },
    { kind: "radio", group: "theme", label: "System", checked: prefs.theme === "system", onSelect: () => onPrefsChange({ theme: "system" }) },
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
    { kind: "panel", id: "history", label: "History" },
    { kind: "divider" },
  ];

  const dockPanel =
    activePanel === "history" ? (
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
