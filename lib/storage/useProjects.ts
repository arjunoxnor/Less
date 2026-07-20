"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isSessionExpired, type CloudUser as User } from "@/lib/cloud/client";
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
  isStatusDirty,
  setStatusDirty,
  isTitleDirty,
  setTitleDirty,
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
import { onBroadcast } from "./broadcast";
import { clockNewer, decideField, decidePlacement, mapLimit } from "./lww";
import {
  createScript,
  deleteScript,
  listScripts,
  setScriptStatus,
  setScriptTitle,
  setScriptFolder,
} from "@/lib/cloud/scripts";
import {
  listCloudFolders,
  listCloudFolderTombstones,
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

  // Cross-tab: when another tab creates/renames/deletes a project or edits
  // folders, refresh so this tab's dashboard reflects it instead of drifting.
  useEffect(() => {
    return onBroadcast((msg) => {
      if (msg.type === "indexChanged") refresh();
      else if (msg.type === "foldersChanged") refreshFolders();
    });
  }, [refresh, refreshFolders]);

  const create = useCallback(
    (
      type: ProjectType,
      title?: string,
      opts?: {
        content?: JSONContent;
        titlePage?: TitlePage | null;
        pageTarget?: number;
        folderId?: string | null;
        status?: ProjectStatus;
      }
    ): ProjectMeta => {
      const meta = localCreate(type, {
        title,
        content: opts?.content,
        titlePage: opts?.titlePage,
        pageTarget: opts?.pageTarget,
        folderId: opts?.folderId,
        status: opts?.status,
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
      const wasCloud = getProjectMeta(id)?.cloudCreated;
      localDelete(id);
      if (user) {
        if (wasCloud) {
          if (online()) {
            deleteScript(id).catch((e) => {
              console.error("cloud delete failed", e);
              markDeletedTombstone(id);
            });
          } else {
            markDeletedTombstone(id);
          }
        } else {
          // Not yet marked cloud-created: a createScript may still be in flight.
          // Tombstone unconditionally so the reconcile flush removes any orphan
          // that in-flight create leaves behind (the server delete is idempotent).
          markDeletedTombstone(id);
          if (online()) {
            deleteScript(id).catch((e) => console.error("cloud delete failed", e));
          }
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
        // Title-only PATCH: a rename must never re-upload the document, which
        // could push a stale local body over newer cloud content.
        setScriptTitle(id, title.trim() || "Untitled")
          .then((ts) => {
            // Only finalize if this is still the latest local title; a stale
            // in-flight callback must not clear a dirty flag a newer rename set.
            if (ts && getProjectMeta(id)?.title === (title.trim() || "Untitled")) {
              patchProjectMeta(id, { titleAt: ts }); // align local clock to cloud
              setTitleDirty(id, false); // landed; no reconcile push needed
            }
          })
          .catch((e) => console.error("cloud rename failed", e));
      }
      refresh();
    },
    [user, refresh]
  );

  const setStatus = useCallback(
    (id: string, status: ProjectStatus) => {
      // localSetStatus marks the project status-dirty so reconcile can push it.
      localSetStatus(id, status);
      const meta = getProjectMeta(id);
      if (meta?.cloudCreated && user && online()) {
        setScriptStatus(id, status)
          .then((ts) => {
            // Only finalize if this is still the latest local value; a stale
            // in-flight callback must not clear a dirty flag a newer edit set.
            if (ts && getProjectMeta(id)?.status === status) {
              patchProjectMeta(id, { statusAt: ts }); // align local clock to cloud
              setStatusDirty(id, false); // landed; no reconcile push needed
            }
          })
          .catch((e) => console.error("cloud status update failed", e));
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
      // Snapshot positions before the local write so we only push the rows whose
      // position actually changed, instead of every row in the container.
      const before = new Map(orderedIds.map((id) => [id, getProjectMeta(id)?.order]));
      localReorder(orderedIds);
      refresh();
      if (user && online()) {
        orderedIds.forEach((id, i) => {
          if (before.get(id) === i) return; // unchanged: nothing to push
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
    async (u: User): Promise<boolean> => {
      // An expired session would 401 every one of the calls below: go quiet
      // and report failure instead of hammering the API. Nothing local is
      // touched; a fresh sign-in re-runs the reconcile.
      if (isSessionExpired()) return false;
      // Count anything that did not go through, so a manual "Sync" never reports
      // success when pushes silently failed (e.g. an expired session 401s).
      let failures = 0;
      try {
        // Push local-only ("anonymous") projects up. These are independent, so
        // run them with bounded concurrency instead of one serial round-trip per
        // project (a first sign-in with many local scripts used to be a storm).
        const anon = listProjects().filter((m) => !m.cloudCreated);
        const anonResults = await mapLimit(anon, 6, async (m) => {
          const doc = loadProjectDoc(m.id);
          if (!doc || !isMeaningfulFor(m.type, doc)) return true; // nothing to push
          try {
            const row = await createScript(u.id, m.title, doc, {
              id: m.id,
              type: m.type,
              status: m.status,
              titlePage: loadProjectTitlePage(m.id),
              folderId: m.folderId ?? null,
              position: m.order ?? null,
            });
            if (row) {
              markCloudCreated(m.id);
              return true;
            }
            return false; // null row = not created (auth/expired)
          } catch (e) {
            console.error("push anonymous project failed", e);
            return false;
          }
        });
        failures += anonResults.filter((ok) => !ok).length;
        // Folders: merge local and cloud, last-write-wins by updated_at, with
        // delete tombstones so a folder removed on one device stays removed.
        try {
          const cloudFolders = await listCloudFolders();
          const cloudFolderById = new Map(cloudFolders.map((c) => [c.id, c]));
          // Server-side deletion records: a folder deleted on another device must
          // be dropped here and NOT re-uploaded (the resurrection bug).
          const cloudTombAt = new Map(
            (await listCloudFolderTombstones()).map((t) => [t.id, t.deleted_at])
          );

          // 1. Flush delete tombstones. A folder re-created/edited after our
          //    delete (cloud newer than the tombstone) survives; otherwise the
          //    delete wins and is removed from the cloud and local.
          for (const t of listFolderTombstones()) {
            const cf = cloudFolderById.get(t.id);
            if (cf && new Date(cf.updated_at).getTime() > new Date(t.at).getTime()) {
              clearFolderTombstone(t.id);
            } else {
              try {
                // Only finalize the delete when the server confirms it. A 401
                // returns false (not a throw), so keep the tombstone and retry
                // next pass rather than dropping the queued folder delete.
                if (await deleteCloudFolder(t.id)) {
                  removeLocalFolder(t.id);
                  cloudFolderById.delete(t.id);
                  clearFolderTombstone(t.id);
                } else {
                  failures++;
                  cloudFolderById.delete(t.id); // do not resurrect locally this pass
                }
              } catch (e) {
                console.error("folder tombstone flush failed", e);
                failures++;
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
            // Deleted on another device after our copy: honor the delete locally
            // and do not re-upload. A local copy NEWER than the deletion is a
            // genuine re-creation, so it still pushes (which clears the record).
            const deletedAt = cloudTombAt.get(lf.id);
            if (
              deletedAt &&
              new Date(deletedAt).getTime() >= new Date(lf.updatedAt).getTime()
            ) {
              removeLocalFolder(lf.id);
              continue;
            }
            const cf = cloudFolderById.get(lf.id);
            if (!cf || new Date(lf.updatedAt).getTime() > new Date(cf.updated_at).getTime()) {
              try {
                if (!(await upsertCloudFolder(u.id, lf))) failures++;
              } catch (e) {
                console.error("folder push failed", e);
                failures++;
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
          failures++;
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
              createdAt: c.created_at ?? c.updated_at,
              updatedAt: c.updated_at,
              cloudCreated: true,
              folderId: c.folder_id ?? undefined,
              order: c.position ?? undefined,
              placedAt: c.placed_at ?? c.updated_at,
              titleAt: c.title_at ?? c.updated_at,
              statusAt: c.status_at ?? c.updated_at,
            });
          }
        }

        // Title + status converge by last-write-wins on their OWN dedicated
        // clocks (title_at / status_at), so a change to one field can never make
        // a stale value of another field look "newer" (the shared updated_at is
        // bumped by every PATCH). The dirty flag means "we have a local edit to
        // push"; the clock decides who wins on a genuine conflict.
        for (const c of cloud) {
          const lm = getProjectMeta(c.id);
          if (!lm) continue;
          const cloudTitleNewer = clockNewer(c.title_at, c.updated_at, lm.titleAt, lm.updatedAt);
          const cloudStatusNewer = clockNewer(c.status_at, c.updated_at, lm.statusAt, lm.updatedAt);

          // Title: decide via the shared pure LWW rule (tested in lww.test.ts),
          // then perform the side effect. A strictly-newer cloud title supersedes
          // a pending local rename; otherwise the local rename is pushed (offline
          // self-heal); otherwise a newer cloud title is adopted.
          switch (
            decideField({
              dirty: isTitleDirty(c.id),
              cloudNewer: cloudTitleNewer,
              localValue: lm.title,
              cloudValue: c.title,
            })
          ) {
            case "pull":
              patchProjectMeta(c.id, {
                title: c.title,
                titleManual: true,
                titleAt: c.title_at ?? c.updated_at,
              });
              setTitleDirty(c.id, false);
              break;
            case "push":
              try {
                const ts = await setScriptTitle(c.id, lm.title);
                if (ts === null) failures++;
                else {
                  patchProjectMeta(c.id, { titleAt: ts });
                  setTitleDirty(c.id, false);
                }
              } catch (e) {
                console.error("title push failed", e);
                failures++;
              }
              break;
            case "clearDirty":
              setTitleDirty(c.id, false);
              break;
          }

          // Status: same rule, on status_at.
          switch (
            decideField({
              dirty: isStatusDirty(c.id),
              cloudNewer: cloudStatusNewer,
              localValue: lm.status,
              cloudValue: c.status,
            })
          ) {
            case "pull":
              patchProjectMeta(c.id, { status: c.status, statusAt: c.status_at ?? c.updated_at });
              setStatusDirty(c.id, false);
              break;
            case "push":
              try {
                const ts = await setScriptStatus(c.id, lm.status);
                if (ts === null) failures++;
                else {
                  patchProjectMeta(c.id, { statusAt: ts });
                  setStatusDirty(c.id, false);
                }
              } catch (e) {
                console.error("status push failed", e);
                failures++;
              }
              break;
            case "clearDirty":
              setStatusDirty(c.id, false);
              break;
          }
        }

        // Placement (folder + position): last-write-wins on the dedicated
        // placed_at clock, so a content save can never out-rank a real move, and
        // a genuine un-file beats a stale filed copy. Never touches content.
        for (const c of cloud) {
          const lm = getProjectMeta(c.id);
          if (!lm) continue;
          const decision = decidePlacement({
            localFolderId: lm.folderId,
            localPosition: lm.order,
            localPlacedAt: lm.placedAt,
            localCreatedAt: lm.createdAt,
            cloudFolderId: c.folder_id,
            cloudPosition: c.position,
            cloudPlacedAt: c.placed_at,
            cloudUpdatedAt: c.updated_at,
          });
          if (decision === "pull") {
            setProjectPlacement(
              c.id,
              c.folder_id ?? null,
              c.position ?? null,
              c.placed_at ?? c.updated_at
            );
          } else if (decision === "push") {
            try {
              // A 401 makes this resolve false (not throw), so count it as a
              // failure rather than silently dropping the placement push.
              if (!(await setScriptFolder(c.id, lm.folderId ?? null, lm.order ?? null))) {
                failures++;
              }
            } catch (e) {
              console.error("placement push failed", e);
              failures++;
            }
          }
        }
        // Flush queued deletes concurrently (independent, idempotent). Only clear
        // a tombstone when the server actually deleted it; a 401 returns false, so
        // we keep it and retry next pass instead of orphaning the cloud row.
        const tombResults = await mapLimit(listTombstones(), 6, async (id) => {
          try {
            if (await deleteScript(id)) {
              clearTombstone(id);
              return true;
            }
            return false;
          } catch (e) {
            console.error("tombstone flush failed", e);
            return false;
          }
        });
        failures += tombResults.filter((ok) => !ok).length;
        refresh();
        refreshFolders();
        return failures === 0;
      } catch (e) {
        console.error("sign-in reconcile failed", e);
        return false;
      }
    },
    [refresh, refreshFolders]
  );

  // Run reconcile on a real sign-in; reset cloud-derived state on a real
  // sign-out. This wipe keys off the user becoming null, which only the
  // explicit sign-out path (clearSession) causes: a session EXPIRY leaves the
  // stored user in place and only flags the session (see lib/cloud/client.ts),
  // so dropCloudProjects can never run because a token silently aged out.
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

  // And when an expired session signs back in. That path keeps the same
  // user.id (expiry never nulls the user), so the identity effect above stays
  // quiet; the old sign-out/sign-in cycle only re-ran reconcile because user
  // passed through null. setSession fires this event after storing the fresh
  // token, so tombstone flushes, dirty title/status pushes, and cloud-only
  // pulls all resume without a reload.
  useEffect(() => {
    if (!user) return;
    const onRestored = () => void reconcile(user);
    window.addEventListener("less:sessionrestored", onRestored);
    return () => window.removeEventListener("less:sessionrestored", onRestored);
  }, [user, reconcile]);

  // Manual "Sync now": run the same reconcile (pull + push + heal) on demand,
  // so a writer can force everything up/down and watch it confirm.
  const syncNow = useCallback(async (): Promise<boolean> => {
    if (!user || !online()) return false;
    const ok = await reconcile(user);
    refresh();
    refreshFolders();
    return ok;
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
