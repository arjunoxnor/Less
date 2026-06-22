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
  getLastSavedAt as projGetLastSavedAt,
  setLastSavedAt as projSetLastSavedAt,
  type ProjectStatus,
} from "@/lib/storage/projects";
import { isCloudConfigured } from "@/lib/cloud/client";
import { signOut } from "@/lib/cloud/auth";
import { useCloudSync } from "@/lib/storage/useCloudSync";
import { exportPlain, type PlainExportFormat } from "@/lib/export/plainExport";
import { EditorChrome } from "./EditorChrome";
import { PlainToolbar } from "./PlainToolbar";
import { PageBackdrop } from "./PageBackdrop";
import { Pagination, STRIDE, PAGE_H } from "@/lib/editor/pagination";
import { AuthModal } from "./AuthModal";
import { HistoryPanel } from "./HistoryPanel";

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
    () => loadProjectDoc(projectId) ?? EMPTY_PLAIN_DOC,
    [projectId]
  );

  const [words, setWords] = useState(0);
  const [chars, setChars] = useState(0);
  const [saved, setSaved] = useState(true);
  const [saveError, setSaveError] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
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

  return (
    <div
      className={"app" + ` docfont-${prefs.docFont}` + (prefs.focusMode ? " focus-mode" : "")}
      style={{ ["--doc-font-size" as string]: `${prefs.docFontSize ?? 16}px` }}
    >
      <EditorChrome
        onBack={onBack}
        title={title}
        onRename={onRename}
        status={status}
        onStatusChange={onStatusChange}
        prefs={prefs}
        onPrefsChange={onPrefsChange}
        fontValue={prefs.docFont}
        fontOptions={[
          { value: "calibri", label: "Calibri" },
          { value: "arial", label: "Arial" },
          { value: "times", label: "Times New Roman" },
          { value: "georgia", label: "Georgia" },
          { value: "verdana", label: "Verdana" },
          { value: "proxima", label: "Proxima Nova" },
          { value: "futura", label: "Futura" },
          { value: "courier-prime", label: "Courier Prime" },
        ]}
        onFontChange={(v) => onPrefsChange({ docFont: v as Prefs["docFont"] })}
        fontSizeValue={prefs.docFontSize ?? 16}
        fontSizeOptions={[11, 12, 13, 14, 16, 18, 20, 24, 28, 32]}
        onFontSizeChange={(v) => onPrefsChange({ docFontSize: v })}
        cloudConfigured={isCloudConfigured}
        user={user}
        syncStatus={syncStatus}
        onSignInClick={() => setShowAuth(true)}
        onSignOutClick={() => void signOut()}
        onHistoryClick={() => setShowHistory(true)}
      >
        <PlainToolbar editor={editor} onExport={handleExport} />
      </EditorChrome>

      <div className="page-scroll">
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

      <div className="status-bar">
        <span className="status-spacer" />
        <span className="status-item">{words.toLocaleString()} words</span>
        <span className="status-item">{chars.toLocaleString()} characters</span>
        <span
          className={"status-item status-saved" + (saveError ? " status-save-error" : "")}
          title={
            saveError
              ? "This device's storage is full, so the latest changes could not be saved locally. Sign in to save to the cloud, or free up space."
              : undefined
          }
        >
          {saveError ? "Not saved (storage full)" : saved ? "Saved" : "Saving…"}
        </span>
      </div>

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
            if (
              !window.confirm(
                "Restore this version? It replaces your current text (a snapshot of the current version is saved first so you can undo)."
              )
            ) {
              return;
            }
            restoreVersion(content, tp);
            setShowHistory(false);
          }}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  );
}
