"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth, signOut } from "@/lib/cloud/auth";
import { isCloudConfigured } from "@/lib/cloud/client";
import {
  DEFAULT_PREFS,
  loadPrefs,
  savePrefs,
  lsGet,
  lsSet,
  type Prefs,
} from "@/lib/storage/localStore";
import { useProjects } from "@/lib/storage/useProjects";
import {
  getLastOpenedId,
  getProjectMeta,
  listProjects,
  setLastOpenedId,
  evictSyncedBodies,
  hasPendingCloudWork,
  type ProjectType,
  type ProjectStatus,
} from "@/lib/storage/projects";
import { SAMPLE_SCRIPT } from "@/lib/editor/sampleScript";
import { ProjectsHome } from "./ProjectsHome";
import { EditorHost } from "./EditorHost";
import { AuthModal } from "./AuthModal";
import { SessionExpiredBanner } from "./SessionExpiredBanner";
import { importFile } from "@/lib/export";
import { getFolder, type Stage } from "@/lib/storage/folders";
import { getProjectShare } from "@/lib/collab/duet";
import { showToast } from "./ui/Toast";

/**
 * Two places, and no third: the home, and a document. A folder is not a place
 * you travel to, it is a thing that opens on the home, so there is no page in
 * between to click through.
 */
type View =
  | { kind: "home" }
  | { kind: "duet"; token: string }
  | {
      kind: "editor";
      id: string;
      /** Instant-create hint (2C): focus-select the title on this open. Lives
       *  only in this in-memory view state, never persisted. */
      focusTitle?: boolean;
    };

/**
 * Optional sidecar that tells a bulk import how to lay the files out: which
 * folders to make (with colour + stage) and where each file goes. Any selected
 * file the manifest does not mention still imports as a loose project.
 */
type ImportManifest = {
  folders?: { key: string; name: string; color: string; stage: Stage; parentKey?: string }[];
  files?: Record<string, { folderKey?: string; status?: ProjectStatus; title?: string }>;
  order?: string[];
};

/** The routed destinations: a local project or a link-only Duet room. */
function parseHash(): { kind: "editor"; id: string } | { kind: "duet"; token: string } | null {
  if (typeof window === "undefined") return null;
  const duet = window.location.hash.match(/^#\/duet\/([A-Za-z0-9_-]{43})$/);
  if (duet) return { kind: "duet", token: duet[1] };
  const p = window.location.hash.match(/^#\/p\/(.+)$/);
  if (p) return { kind: "editor", id: decodeURIComponent(p[1]) };
  return null;
}

/** Does the hash target actually exist? Unknown ids fall back to the home. */
function resolveHash(): View | null {
  const h = parseHash();
  if (!h) return null;
  if (h.kind === "duet") return h;
  return getProjectMeta(h.id) ? h : null;
}

/**
 * The single client root for the static export. Owns the home-vs-editor view
 * (hash-routed so a project is bookmarkable and refresh-safe), the app-wide
 * theme/font/focus prefs, and the project lifecycle via useProjects.
 */
export function AppShell() {
  const { user, sessionExpired } = useAuth();
  const {
    projects,
    folders,
    refresh,
    syncNow,
    create,
    remove,
    rename,
    setStatus,
    setFolder,
    reorder,
    createFolder,
    reorderFolders,
    updateFolder,
    deleteFolder,
  } = useProjects(user);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [view, setView] = useState<View>({ kind: "home" });
  const [showAuth, setShowAuth] = useState(false);

  useEffect(() => {
    setPrefs(loadPrefs());
  }, []);

  useEffect(() => {
    // Never write the compile-time defaults over stored prefs. Until loadPrefs
    // lands, `prefs` IS the DEFAULT_PREFS object; saving it here would clobber
    // the stored theme before the load effect's state update applies (React
    // StrictMode's double-run made that a reliable reset on every reload).
    if (prefs !== DEFAULT_PREFS) savePrefs(prefs);
    if (typeof document === "undefined") return;
    const apply = () => {
      const resolved =
        prefs.theme === "system"
          ? window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light"
          : prefs.theme;
      document.documentElement.dataset.theme = resolved;
    };
    apply();
    if (prefs.theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [prefs]);

  const onPrefsChange = useCallback(
    (next: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...next })),
    []
  );

  // Escape handling for focus mode now lives in the editor shell, which owns
  // the single ordered handler (dock closes first, then focus exits).

  // Resolve the opening view from the hash once on mount (migration has run in
  // useProjects). hashchange does not fire on initial load, so do it explicitly.
  useEffect(() => {
    const v = resolveHash();
    if (v) setView(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Storage pressure: free the local bodies of safely-synced projects when a
  // write fails (quota) or usage is already high at startup. Only clean,
  // cloud-backed, not-open projects are eligible (see evictSyncedBodies); the
  // body re-loads from the cloud when that project is next opened.
  useEffect(() => {
    const onFull = () => {
      const n = evictSyncedBodies({ exceptId: getLastOpenedId(), max: 5 });
      if (n > 0) console.info(`Freed local copies of ${n} synced project(s)`);
    };
    window.addEventListener("less:storagefull", onFull);
    void (async () => {
      try {
        const est = await navigator.storage?.estimate?.();
        if (est?.usage && est?.quota && est.usage / est.quota > 0.85) onFull();
      } catch {
        /* estimate unsupported: the event path still covers real failures */
      }
    })();
    return () => window.removeEventListener("less:storagefull", onFull);
  }, []);

  // Drive the view from the hash so browser back/forward works. When the hash
  // event confirms the view we already set (openProject sets both), keep the
  // existing view object so an in-memory focusTitle hint survives the echo.
  useEffect(() => {
    const onHash = () => {
      const next = resolveHash();
      if (next?.kind === "editor") {
        const id = next.id;
        setView((v) => (v.kind === "editor" && v.id === id ? v : { kind: "editor", id }));
      } else if (next?.kind === "duet") {
        const token = next.token;
        setView((v) => (v.kind === "duet" && v.token === token ? v : next));
      } else {
        // Landing on the home via browser back must re-read the index
        // (same-tab writes do not broadcast), or times and page counts go stale.
        refresh();
        setView({ kind: "home" });
      }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [refresh]);

  const openProject = useCallback((id: string, opts?: { focusTitle?: boolean }) => {
    setLastOpenedId(id);
    if (typeof window !== "undefined") {
      window.location.hash = "#/p/" + encodeURIComponent(id);
    }
    setView({ kind: "editor", id, focusTitle: opts?.focusTitle });
  }, []);

  const goHome = useCallback(() => {
    refresh();
    if (typeof window !== "undefined") window.location.hash = "";
    setView({ kind: "home" });
  }, [refresh]);

  const signOutSafely = useCallback(async () => {
    if (hasPendingCloudWork()) {
      showToast("Some changes have not synced. Reconnect and sync before signing out.", {
        variant: "danger",
      });
      return;
    }
    await signOut();
  }, []);

  // Cold visit (2D.1): no project index at all means a first-ever open. Skip
  // the dashboard: create an "Untitled screenplay" seeded with the six-line
  // sample scene and open it directly. The one-time marker key stops this from
  // re-running for a writer who later deletes every project on purpose.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    if (parseHash()) return;
    if (lsGet("less:seeded:v1")) return;
    if (listProjects().length > 0) {
      // An existing install: never seed, and never again check.
      lsSet("less:seeded:v1", "1");
      return;
    }
    lsSet("less:seeded:v1", "1");
    const meta = create("screenplay", "Untitled screenplay", {
      content: SAMPLE_SCRIPT,
    });
    openProject(meta.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Create WITHOUT opening: the dashboard decides whether to open (New script
  // opens immediately with the title focus hint; Duplicate stays on the desk).
  const onCreate = useCallback(
    (
      type: ProjectType,
      title: string,
      opts?: {
        content?: import("@tiptap/core").JSONContent;
        titlePage?: import("@/lib/export/titlePage").TitlePage | null;
        folderId?: string | null;
      }
    ) => create(type, title || undefined, opts),
    [create]
  );

  // Bulk-import screenplays (Final Draft .fdx / Fountain) into the account,
  // staying on the home screen. One project per file; an optional .json
  // manifest in the selection lays them out into coloured folders. Each create
  // syncs to Supabase exactly like a hand-made project, so an import done while
  // signed in lands on every device.
  const importScreenplays = useCallback(
    async (files: File[]): Promise<{ imported: number; failed: string[] }> => {
      const manifestFile = files.find((f) => f.name.toLowerCase().endsWith(".json"));
      let manifest: ImportManifest | null = null;
      if (manifestFile) {
        try {
          manifest = JSON.parse(await manifestFile.text());
        } catch {
          manifest = null;
        }
      }

      const folderIdByKey: Record<string, string> = {};
      for (const def of manifest?.folders ?? []) {
        const parentId = def.parentKey ? folderIdByKey[def.parentKey] : undefined;
        const folder = createFolder(parentId);
        updateFolder(folder.id, { name: def.name, color: def.color, stage: def.stage });
        folderIdByKey[def.key] = folder.id;
      }

      const placement = manifest?.files ?? {};
      const order = manifest?.order;
      const scriptFiles = files
        .filter((f) => !f.name.toLowerCase().endsWith(".json"))
        .sort((a, b) => {
          if (!order) return 0;
          const ia = order.indexOf(a.name);
          const ib = order.indexOf(b.name);
          return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
        });

      const failed: string[] = [];
      let imported = 0;
      for (const file of scriptFiles) {
        try {
          const { doc, titlePage, kind, plainDoc } = await importFile(file);
          const info = placement[file.name] ?? {};
          const fallback = file.name.replace(
            /\.(fdx|fountain|txt|text|md|markdown|spmd|xml|docx|odt|rtf)$/i,
            ""
          );
          const folderId = info.folderKey ? folderIdByKey[info.folderKey] : undefined;
          // Import prose (no scene headings) as a plain document, not a screenplay.
          const isPlain = kind === "plain";
          // Create already filed and with its status, so the first cloud insert
          // is correct rather than loose-then-patched over two round-trips.
          create(isPlain ? "plain" : "screenplay", info.title || (isPlain ? "" : titlePage?.title) || fallback, {
            content: isPlain ? plainDoc : doc,
            titlePage: isPlain ? undefined : titlePage,
            folderId: folderId ?? undefined,
            status: info.status,
          });
          imported++;
        } catch (e) {
          console.error("import failed for", file.name, e);
          failed.push(file.name);
        }
      }
      refresh();
      return { imported, failed };
    },
    [create, createFolder, updateFolder, setFolder, setStatus, refresh]
  );

  // Dev hook so a bulk import can be driven/tested without a file picker.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const w = window as unknown as {
      __lessImportFiles?: typeof importScreenplays;
      __lessImportFile?: typeof importFile;
    };
    w.__lessImportFiles = importScreenplays;
    w.__lessImportFile = importFile;
  }, [importScreenplays]);

  const current =
    view.kind === "editor"
      ? projects.find((p) => p.id === view.id) ?? getProjectMeta(view.id)
      : null;

  // If the open project disappears (deleted, or sign-out dropped it), go home.
  useEffect(() => {
    if (view.kind === "editor" && !getProjectMeta(view.id)) goHome();
  }, [view, projects, goHome]);

  if (view.kind === "duet") {
    return (
      <>
        <EditorHost
          key={`duet:${view.token}`}
          projectId={`duet:${view.token}`}
          type="screenplay"
          title="Shared screenplay"
          onRename={() => {}}
          status="writing"
          onStatusChange={() => {}}
          onBack={goHome}
          prefs={prefs}
          onPrefsChange={onPrefsChange}
          user={user}
          sessionExpired={sessionExpired}
          duet={{ token: view.token, owner: false }}
        />
        {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
      </>
    );
  }

  if (view.kind === "editor" && current) {
    // The instant-create title focus (2C): only for a project that still has
    // its placeholder name and was created moments ago, so a hint that somehow
    // outlives its moment (or a reopened old project) never steals focus.
    const autoFocusTitle =
      view.focusTitle === true &&
      (current.title === "Untitled screenplay" || current.title === "Untitled") &&
      Date.now() - new Date(current.createdAt).getTime() < 10_000;
    const duetShare = getProjectShare(current.id);
    return (
      <>
        <EditorHost
          key={current.id}
          projectId={current.id}
          type={current.type}
          title={current.title}
          onRename={(t) => rename(current.id, t)}
          status={current.status}
          onStatusChange={(s) => setStatus(current.id, s)}
          onBack={goHome}
          prefs={prefs}
          onPrefsChange={onPrefsChange}
          user={user}
          sessionExpired={sessionExpired}
          onImportAsNew={(file) => importScreenplays([file])}
          onOpenProject={openProject}
          autoFocusTitle={autoFocusTitle}
          duet={
            duetShare
              ? { token: duetShare.token, owner: true, ownerKey: duetShare.ownerKey }
              : undefined
          }
        />
        {/* Inside the editor the top bar's sync indicator carries the expired
            state (2B.1); the banner stays for the dashboard only. */}
        {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
      </>
    );
  }

  return (
    <>
      <ProjectsHome
        projects={projects}
        user={user}
        cloudConfigured={isCloudConfigured}
        prefs={prefs}
        onPrefsChange={onPrefsChange}
        onOpen={openProject}
        onCreate={onCreate}
        onDelete={remove}
        onRename={rename}
        onSetFolder={setFolder}
        onReorder={reorder}
        onReorderFolders={reorderFolders}
        folders={folders}
        onCreateFolder={createFolder}
        onUpdateFolder={updateFolder}
        onDeleteFolder={deleteFolder}
        onImportScreenplays={importScreenplays}
        onSyncNow={syncNow}
        onSignIn={() => setShowAuth(true)}
        onSignOut={() => void signOutSafely()}
      />
      {sessionExpired && (
        <SessionExpiredBanner onSignIn={() => setShowAuth(true)} />
      )}
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </>
  );
}
