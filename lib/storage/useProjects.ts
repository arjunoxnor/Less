"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CloudUser as User } from "@/lib/cloud/client";
import type { JSONContent } from "@tiptap/core";
import type { TitlePage } from "@/lib/export/titlePage";

import {
  clearAllBookkeeping,
  clearTombstone,
  createProject as localCreate,
  deleteProject as localDelete,
  dropCloudProjects,
  getProjectMeta,
  patchProjectMeta,
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
  reorderProjects as localReorder,
  setProjectPlacement,
  upsertCloudMeta,
  type ProjectMeta,
  type ProjectStatus,
  type ProjectType,
} from "./projects";
import {
  listFolders,
  createFolder as localCreateFolder,
  updateFolder as localUpdateFolder,
  deleteFolder as localDeleteFolder,
  reorderFolders as localReorderFolders,
  getFolder,
  upsertLocalFolder,
  removeLocalFolder,
  clearLocalFolders,
  toggleFolderCollapsed,
  markFolderTombstone,
  listFolderTombstones,
  clearFolderTombstone,
  type Folder,
} from "./folders";
import {
  createScript,
  deleteScript,
  listScripts,
  saveScript,
  setScriptStatus,
  setScriptFolder,
} from "@/lib/cloud/scripts";
import {
  listCloudFolders,
  upsertCloudFolder,
  deleteCloudFolder,
} from "@/lib/cloud/folders";
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
  const [folders, setFoldersState] = useState<Folder[]>([]);
  const refreshFolders = useCallback(() => setFoldersState(listFolders()), []);

  // Migrate the legacy single doc once, before the first render of the list.
  const migrated = useRef(false);
  useEffect(() => {
    if (!migrated.current) {
      migrateLegacyDoc();
      migrated.current = true;
    }
    refresh();
    refreshFolders();
  }, [refresh, refreshFolders]);

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
            folderId: meta.folderId ?? null,
            position: meta.order ?? null,
          })
            // Only mark created when a real row comes back; a 401/expired session
            // resolves to null, and marking it created would strand it local-only.
            .then((row) => {
              if (row) markCloudCreated(meta.id);
            })
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

  // Filing a project into a folder writes locally first, then pushes only the
  // folder/position columns to the cloud (never content).
  const setFolder = useCallback(
    (id: string, folderId: string | null) => {
      localSetFolder(id, folderId);
      refresh();
      const meta = getProjectMeta(id);
      if (meta?.cloudCreated && user && online()) {
        setScriptFolder(id, folderId, meta.order ?? null).catch((e) =>
          console.error("cloud folder placement failed", e)
        );
      }
    },
    [user, refresh]
  );

  const reorder = useCallback(
    (orderedIds: string[]) => {
      localReorder(orderedIds);
      refresh();
      if (user && online()) {
        orderedIds.forEach((id, i) => {
          const meta = getProjectMeta(id);
          if (meta?.cloudCreated) {
            setScriptFolder(id, meta.folderId ?? null, i).catch((e) =>
              console.error("cloud reorder placement failed", e)
            );
          }
        });
      }
    },
    [user, refresh]
  );

  // --- Folder CRUD: local first, best-effort cloud mirror ------------------
  const createFolder = useCallback(
    (parentId?: string): Folder => {
      const f = localCreateFolder(undefined, parentId);
      refreshFolders();
      if (user && online()) {
        upsertCloudFolder(user.id, f).catch((e) =>
          console.error("cloud folder create failed", e)
        );
      }
      return f;
    },
    [user, refreshFolders]
  );

  const updateFolder = useCallback(
    (id: string, patch: Parameters<typeof localUpdateFolder>[1]) => {
      localUpdateFolder(id, patch);
      refreshFolders();
      const f = getFolder(id);
      if (f && user && online()) {
        upsertCloudFolder(user.id, f).catch((e) =>
          console.error("cloud folder update failed", e)
        );
      }
    },
    [user, refreshFolders]
  );

  // Expand/collapse is device-local view state; never synced.
  const toggleFolder = useCallback(
    (id: string) => {
      toggleFolderCollapsed(id);
      refreshFolders();
    },
    [refreshFolders]
  );

  const reorderFolders = useCallback(
    (orderedIds: string[]) => {
      localReorderFolders(orderedIds);
      refreshFolders();
      if (user && online()) {
        orderedIds.forEach((id) => {
          const f = getFolder(id);
          if (f) {
            upsertCloudFolder(user.id, f).catch((e) =>
              console.error("cloud folder reorder failed", e)
            );
          }
        });
      }
    },
    [user, refreshFolders]
  );

  const deleteFolder = useCallback(
    (id: string) => {
      // Tombstone first so the delete converges even if the cloud call fails or
      // another device still has the folder locally.
      markFolderTombstone(id, new Date().toISOString());
      localDeleteFolder(id);
      refreshFolders();
      if (user && online()) {
        deleteCloudFolder(id)
          .then(() => clearFolderTombstone(id))
          .catch((e) => console.error("cloud folder delete failed", e));
      }
    },
    [user, refreshFolders]
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
                const row = await createScript(u.id, m.title, doc, {
                  id: m.id,
                  type: m.type,
                  status: m.status,
                  titlePage: loadProjectTitlePage(m.id),
                  folderId: m.folderId ?? null,
                  position: m.order ?? null,
                });
                if (row) markCloudCreated(m.id);
              } catch (e) {
                console.error("push anonymous project failed", e);
              }
            }
          }
        }
        // Folders: merge local and cloud, last-write-wins by updated_at, with
        // delete tombstones so a folder removed on one device stays removed.
        try {
          const cloudFolders = await listCloudFolders();
          const cloudFolderById = new Map(cloudFolders.map((c) => [c.id, c]));

          // 1. Flush delete tombstones. A folder re-created/edited after our
          //    delete (cloud newer than the tombstone) survives; otherwise the
          //    delete wins and is removed from the cloud and local.
          for (const t of listFolderTombstones()) {
            const cf = cloudFolderById.get(t.id);
            if (cf && new Date(cf.updated_at).getTime() > new Date(t.at).getTime()) {
              clearFolderTombstone(t.id);
            } else {
              try {
                await deleteCloudFolder(t.id);
                removeLocalFolder(t.id);
                cloudFolderById.delete(t.id);
                clearFolderTombstone(t.id);
              } catch (e) {
                console.error("folder tombstone flush failed", e);
                cloudFolderById.delete(t.id); // do not resurrect locally this pass
              }
            }
          }
          const tombed = new Set(listFolderTombstones().map((t) => t.id));

          const localFolders = listFolders();
          const localFolderById = new Map(localFolders.map((f) => [f.id, f]));
          // Push local-only or locally-newer folders (never a tombstoned one).
          for (const lf of localFolders) {
            if (tombed.has(lf.id)) continue;
            const cf = cloudFolderById.get(lf.id);
            if (!cf || new Date(lf.updatedAt).getTime() > new Date(cf.updated_at).getTime()) {
              try {
                await upsertCloudFolder(u.id, lf);
              } catch (e) {
                console.error("folder push failed", e);
              }
            }
          }
          // Pull cloud-only or cloud-newer folders (skip ones we are deleting).
          for (const cf of cloudFolderById.values()) {
            if (tombed.has(cf.id)) continue;
            const lf = localFolderById.get(cf.id);
            if (!lf || new Date(cf.updated_at).getTime() > new Date(lf.updatedAt).getTime()) {
              upsertLocalFolder(cf);
            }
          }
          refreshFolders();
        } catch (e) {
          console.error("folder reconcile failed", e);
        }

        const cloud = await listScripts();
        const localIds = new Set(listProjects().map((m) => m.id));
        for (const c of cloud) {
          if (!localIds.has(c.id)) {
            // Seed the pulled project WITH its cloud placement, so a fresh device
            // does not start loose and then push a blank placement back up (which
            // would erase the folder for everyone). titleManual keeps the local
            // auto-namer from re-deriving the cloud title from the first line.
            upsertCloudMeta({
              id: c.id,
              title: c.title,
              type: c.type,
              status: c.status,
              createdAt: c.updated_at,
              updatedAt: c.updated_at,
              cloudCreated: true,
              folderId: c.folder_id ?? undefined,
              order: c.position ?? undefined,
              placedAt: c.placed_at ?? c.updated_at,
            });
          }
        }

        // Title + status converge by last-write-wins on updated_at for projects
        // that exist on both sides, so a rename or status change on one device
        // reaches the others (previously these were push-only and never synced).
        for (const c of cloud) {
          const lm = getProjectMeta(c.id);
          if (!lm) continue;
          if (new Date(c.updated_at).getTime() > new Date(lm.updatedAt).getTime()) {
            const patch: Partial<ProjectMeta> = {};
            if (c.title && c.title !== lm.title) patch.title = c.title;
            if (c.status && c.status !== lm.status) patch.status = c.status;
            if (Object.keys(patch).length) {
              patch.titleManual = true; // a cloud title is explicit
              patch.updatedAt = c.updated_at; // align so it does not bounce back
              patchProjectMeta(c.id, patch);
            }
          }
        }

        // Placement (folder + position): last-write-wins on the dedicated
        // placed_at clock, so a content save can never out-rank a real move, and
        // a genuine un-file beats a stale filed copy. Never touches content.
        for (const c of cloud) {
          const lm = getProjectMeta(c.id);
          if (!lm) continue;
          const samePlacement =
            (lm.folderId ?? null) === (c.folder_id ?? null) &&
            (lm.order ?? null) === (c.position ?? null);
          if (samePlacement) continue;
          const cloudPlaced = c.placed_at ?? c.updated_at;
          const localPlaced = lm.placedAt ?? lm.updatedAt;
          if (new Date(cloudPlaced).getTime() > new Date(localPlaced).getTime()) {
            setProjectPlacement(c.id, c.folder_id ?? null, c.position ?? null, cloudPlaced);
          } else {
            try {
              await setScriptFolder(c.id, lm.folderId ?? null, lm.order ?? null);
            } catch (e) {
              console.error("placement push failed", e);
            }
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
        refreshFolders();
      } catch (e) {
        console.error("sign-in reconcile failed", e);
      }
    },
    [refresh, refreshFolders]
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
      clearLocalFolders();
      clearAllBookkeeping();
      refresh();
      refreshFolders();
    }
  }, [user, reconcile, refresh, refreshFolders]);

  // Flush the same reconcile when the connection returns.
  useEffect(() => {
    if (!user) return;
    const onOnline = () => void reconcile(user);
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [user, reconcile]);

  // Manual "Sync now": run the same reconcile (pull + push + heal) on demand,
  // so a writer can force everything up/down and watch it confirm.
  const syncNow = useCallback(async (): Promise<boolean> => {
    if (!user || !online()) return false;
    await reconcile(user);
    refresh();
    refreshFolders();
    return true;
  }, [user, reconcile, refresh, refreshFolders]);

  return {
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
    updateFolder,
    deleteFolder,
    reorderFolders,
    toggleFolder,
  };
}
