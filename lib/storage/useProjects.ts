"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import type { JSONContent } from "@tiptap/core";
import type { TitlePage } from "@/lib/export/titlePage";

import {
  clearAllBookkeeping,
  clearTombstone,
  createProject as localCreate,
  deleteProject as localDelete,
  dropCloudProjects,
  getProjectMeta,
  listProjects,
  listTombstones,
  loadProjectDoc,
  loadProjectTitlePage,
  markCloudCreated,
  markDeletedTombstone,
  migrateLegacyDoc,
  renameProject as localRename,
  setStatus as localSetStatus,
  setProjectFolder as localSetFolder,
  upsertCloudMeta,
  type ProjectMeta,
  type ProjectStatus,
  type ProjectType,
} from "./projects";
import {
  createScript,
  deleteScript,
  listScripts,
  saveScript,
  setScriptStatus,
} from "@/lib/supabase/scripts";
import { isMeaningfulFor } from "@/lib/editor/plainDocUtils";

const online = () => typeof navigator === "undefined" || navigator.onLine;

/**
 * The dashboard-facing project lifecycle: the project list plus create / delete
 * / rename / status, and the cloud reconcile on sign-in and reconnect. Each
 * operation writes locally first (instant, offline-safe) and mirrors to the
 * cloud best-effort when signed in and online. Heavy per-document body sync
 * stays in useCloudSync, per opened project.
 */
export function useProjects(user: User | null) {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const refresh = useCallback(() => setProjects(listProjects()), []);

  // Migrate the legacy single doc once, before the first render of the list.
  const migrated = useRef(false);
  useEffect(() => {
    if (!migrated.current) {
      migrateLegacyDoc();
      migrated.current = true;
    }
    refresh();
  }, [refresh]);

  const create = useCallback(
    (
      type: ProjectType,
      title?: string,
      opts?: { content?: JSONContent; titlePage?: TitlePage | null; pageTarget?: number }
    ): ProjectMeta => {
      const meta = localCreate(type, {
        title,
        content: opts?.content,
        titlePage: opts?.titlePage,
        pageTarget: opts?.pageTarget,
      });
      if (user && online()) {
        const doc = loadProjectDoc(meta.id);
        if (doc) {
          createScript(user.id, meta.title, doc, {
            id: meta.id,
            type,
            status: meta.status,
            titlePage: opts?.titlePage,
          })
            .then(() => markCloudCreated(meta.id))
            .catch((e) => console.error("cloud create failed", e));
        }
      }
      refresh();
      return meta;
    },
    [user, refresh]
  );

  const remove = useCallback(
    (id: string) => {
      const meta = getProjectMeta(id);
      localDelete(id);
      if (meta?.cloudCreated && user) {
        if (online()) {
          deleteScript(id).catch((e) => {
            console.error("cloud delete failed", e);
            markDeletedTombstone(id);
          });
        } else {
          markDeletedTombstone(id);
        }
      }
      refresh();
    },
    [user, refresh]
  );

  const rename = useCallback(
    (id: string, title: string) => {
      localRename(id, title);
      const meta = getProjectMeta(id);
      if (meta?.cloudCreated && user && online()) {
        const doc = loadProjectDoc(id);
        if (doc) {
          saveScript(id, doc, title.trim() || "Untitled", loadProjectTitlePage(id)).catch(
            (e) => console.error("cloud rename failed", e)
          );
        }
      }
      refresh();
    },
    [user, refresh]
  );

  const setStatus = useCallback(
    (id: string, status: ProjectStatus) => {
      localSetStatus(id, status);
      const meta = getProjectMeta(id);
      if (meta?.cloudCreated && user && online()) {
        setScriptStatus(id, status).catch((e) =>
          console.error("cloud status update failed", e)
        );
      }
      refresh();
    },
    [user, refresh]
  );

  // Filing a project into a folder is purely local organization (folders do not
  // sync yet), so this never touches the cloud.
  const setFolder = useCallback(
    (id: string, folderId: string | null) => {
      localSetFolder(id, folderId);
      refresh();
    },
    [refresh]
  );

  // One pass that pushes anonymous meaningful local projects to the cloud, pulls
  // cloud-only projects into the local index, and flushes delete tombstones.
  const reconcile = useCallback(
    async (u: User) => {
      try {
        for (const m of listProjects()) {
          if (!m.cloudCreated) {
            const doc = loadProjectDoc(m.id);
            if (doc && isMeaningfulFor(m.type, doc)) {
              try {
                await createScript(u.id, m.title, doc, {
                  id: m.id,
                  type: m.type,
                  status: m.status,
                  titlePage: loadProjectTitlePage(m.id),
                });
                markCloudCreated(m.id);
              } catch (e) {
                console.error("push anonymous project failed", e);
              }
            }
          }
        }
        const cloud = await listScripts();
        const localIds = new Set(listProjects().map((m) => m.id));
        for (const c of cloud) {
          if (!localIds.has(c.id)) {
            upsertCloudMeta({
              id: c.id,
              title: c.title,
              type: c.type,
              status: c.status,
              createdAt: c.updated_at,
              updatedAt: c.updated_at,
              cloudCreated: true,
            });
          }
        }
        for (const id of listTombstones()) {
          try {
            await deleteScript(id);
            clearTombstone(id);
          } catch (e) {
            console.error("tombstone flush failed", e);
          }
        }
        refresh();
      } catch (e) {
        console.error("sign-in reconcile failed", e);
      }
    },
    [refresh]
  );

  // Run reconcile on a real sign-in; reset cloud-derived state on a real sign-out.
  const prevUser = useRef<string | null>(null);
  useEffect(() => {
    const had = prevUser.current;
    const now = user?.id ?? null;
    prevUser.current = now;
    if (now && now !== had) {
      void reconcile(user!);
    } else if (!now && had) {
      dropCloudProjects();
      clearAllBookkeeping();
      refresh();
    }
  }, [user, reconcile, refresh]);

  // Flush the same reconcile when the connection returns.
  useEffect(() => {
    if (!user) return;
    const onOnline = () => void reconcile(user);
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [user, reconcile]);

  return { projects, refresh, create, remove, rename, setStatus, setFolder };
}
