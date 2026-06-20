"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth, signOut } from "@/lib/supabase/auth";
import { isCloudConfigured } from "@/lib/supabase/client";
import {
  DEFAULT_PREFS,
  loadPrefs,
  savePrefs,
  type Prefs,
} from "@/lib/storage/localStore";
import { useProjects } from "@/lib/storage/useProjects";
import {
  getLastOpenedId,
  getProjectMeta,
  setLastOpenedId,
  type ProjectType,
} from "@/lib/storage/projects";
import { ProjectsHome } from "./ProjectsHome";
import { EditorHost } from "./EditorHost";
import { AuthModal } from "./AuthModal";

type View = { kind: "home" } | { kind: "editor"; id: string };

function parseHash(): string | null {
  if (typeof window === "undefined") return null;
  const m = window.location.hash.match(/^#\/p\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * The single client root for the static export. Owns the home-vs-editor view
 * (hash-routed so a project is bookmarkable and refresh-safe), the app-wide
 * theme/font/focus prefs, and the project lifecycle via useProjects.
 */
export function AppShell() {
  const { user } = useAuth();
  const { projects, refresh, create, remove, rename, setStatus } = useProjects(user);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [view, setView] = useState<View>({ kind: "home" });
  const [showAuth, setShowAuth] = useState(false);

  useEffect(() => {
    setPrefs(loadPrefs());
  }, []);

  useEffect(() => {
    savePrefs(prefs);
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

  // Escape leaves focus mode (app-wide).
  useEffect(() => {
    if (!prefs.focusMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPrefs((p) => ({ ...p, focusMode: false }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prefs.focusMode]);

  // Resolve the opening view from the hash once on mount (migration has run in
  // useProjects). hashchange does not fire on initial load, so do it explicitly.
  useEffect(() => {
    const id = parseHash();
    if (id && getProjectMeta(id)) setView({ kind: "editor", id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drive the view from the hash so browser back/forward works.
  useEffect(() => {
    const onHash = () => {
      const id = parseHash();
      if (id && getProjectMeta(id)) setView({ kind: "editor", id });
      else setView({ kind: "home" });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const openProject = useCallback((id: string) => {
    setLastOpenedId(id);
    if (typeof window !== "undefined") {
      window.location.hash = "#/p/" + encodeURIComponent(id);
    }
    setView({ kind: "editor", id });
  }, []);

  const goHome = useCallback(() => {
    refresh();
    if (typeof window !== "undefined") window.location.hash = "";
    setView({ kind: "home" });
  }, [refresh]);

  const onCreate = useCallback(
    (
      type: ProjectType,
      title: string,
      opts?: {
        content?: import("@tiptap/core").JSONContent;
        titlePage?: import("@/lib/export/titlePage").TitlePage | null;
        pageTarget?: number;
      }
    ) => {
      const meta = create(type, title || undefined, opts);
      openProject(meta.id);
    },
    [create, openProject]
  );

  const current =
    view.kind === "editor"
      ? projects.find((p) => p.id === view.id) ?? getProjectMeta(view.id)
      : null;

  // If the open project disappears (deleted, or sign-out dropped it), go home.
  useEffect(() => {
    if (view.kind === "editor" && !getProjectMeta(view.id)) goHome();
  }, [view, projects, goHome]);

  if (view.kind === "editor" && current) {
    return (
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
      />
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
        lastOpenedId={getLastOpenedId()}
        onOpen={openProject}
        onCreate={onCreate}
        onDelete={remove}
        onRename={rename}
        onStatusChange={setStatus}
        onSignIn={() => setShowAuth(true)}
        onSignOut={() => void signOut()}
      />
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </>
  );
}
