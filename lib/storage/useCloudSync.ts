"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import type { CloudUser as User } from "@/lib/cloud/client";

import {
  createScript,
  createSnapshot,
  fetchScript,
  listVersions,
  saveScript,
  type VersionRow,
} from "@/lib/cloud/scripts";
import { trimTitlePage, type TitlePage } from "@/lib/export/titlePage";
import { debounce } from "./localStore";
import type { ProjectStatus, ProjectType } from "./projects";

export type SyncStatus =
  | "local" // not signed in — local only
  | "syncing"
  | "synced"
  | "offline"
  | "error";

const PUSH_DEBOUNCE_MS = 1500;
const SNAPSHOT_THROTTLE_MS = 3 * 60 * 1000; // at most one snapshot per 3 min

/** Everything the per-project sync engine needs, injected by the editor body. */
export interface CloudSyncOpts {
  projectId: string;
  type: ProjectType;
  status: ProjectStatus;
  deriveTitle: (doc: JSONContent) => string;
  /** The project's real title; preferred over deriveTitle so an explicit title
   *  is never overwritten by the document's first line. */
  getTitle?: () => string;
  saveLocalDoc: (doc: JSONContent) => void;
  loadLocalTitlePage: () => TitlePage | null;
  saveLocalTitlePage: (tp: TitlePage | null) => void;
  isDirty: () => boolean;
  setDirty: (dirty: boolean) => void;
  getLastSavedAt: () => string | null;
  setLastSavedAt: (iso: string | null) => void;
  /** Called after this project's cloud row is first created. */
  onCloudCreated?: (id: string) => void;
}

/**
 * Ties ONE open project's editor to the cloud while keeping local-first
 * guarantees. It is mounted per project (the editor host remounts on switch),
 * so it never has to swap documents under a live editor.
 *
 *  - Local storage is always written first (instant, never lost).
 *  - When signed in, changes push to Supabase in the background.
 *  - On open it reconciles this project's local vs cloud copy safely (never
 *    silently loses work, including edits typed while the cloud copy loads).
 *  - Offline edits keep working and flush when the connection returns.
 *  - Periodic immutable snapshots give a rollback safety net.
 *
 * The dashboard-level list reconcile (which projects exist where) lives in
 * useProjects; this hook only owns the open project's body.
 */
export function useCloudSync(
  editor: Editor | null,
  user: User | null,
  opts: CloudSyncOpts
) {
  const [status, setStatus] = useState<SyncStatus>("local");
  // Bumped whenever we load cloud/snapshot/import content into the editor with
  // the 'update' event suppressed, so the surrounding UI recomputes.
  const [pulledTick, setPulledTick] = useState(0);

  // The title page is metadata beside the doc (not editor state).
  const titlePageRef = useRef<TitlePage | null>(opts.loadLocalTitlePage());
  const [titlePage, setTitlePageState] = useState<TitlePage | null>(
    titlePageRef.current
  );

  // Latest opts + user in refs so subscriptions never go stale.
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const userRef = useRef<User | null>(user);
  userRef.current = user;
  const lastSnapshotAt = useRef<number>(0);
  const reconciledFor = useRef<string | null>(null);

  const projectId = opts.projectId;

  // Load content into the editor WITHOUT firing 'update', mirror it to local
  // storage, and signal the UI to recompute.
  const pullInto = useCallback(
    (content: JSONContent, tp?: TitlePage | null) => {
      if (!editor) return;
      editor.commands.setContent(content, { emitUpdate: false });
      optsRef.current.saveLocalDoc(content);
      if (tp !== undefined) {
        titlePageRef.current = tp;
        optsRef.current.saveLocalTitlePage(tp);
        setTitlePageState(tp);
      }
      setPulledTick((t) => t + 1);
    },
    [editor]
  );

  // Push the current document to the cloud (with a throttled snapshot).
  const pushNow = useCallback(async () => {
    const u = userRef.current;
    const ed = editor;
    if (!u || !ed) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setStatus("offline");
      return;
    }
    const o = optsRef.current;
    try {
      const doc = ed.getJSON();
      const tp = titlePageRef.current;
      const snapshotJson = JSON.stringify(doc);
      const tpSnapshot = JSON.stringify(tp);
      const ts = await saveScript(o.projectId, doc, (o.getTitle?.() || "").trim() || o.deriveTitle(doc), tp);
      // A null result means the save never reached the cloud (e.g. the session
      // expired -> 401). Keep it dirty and show an error so it retries; never
      // report "synced" or clear the dirty flag, which would risk a later pull
      // overwriting work that was never actually saved.
      if (!ts) {
        setStatus("error");
        return;
      }
      o.setLastSavedAt(ts);
      // Only mark clean if neither doc nor title page changed during the round trip.
      if (
        JSON.stringify(ed.getJSON()) === snapshotJson &&
        JSON.stringify(titlePageRef.current) === tpSnapshot
      ) {
        o.setDirty(false);
      }
      const now = Date.now();
      if (now - lastSnapshotAt.current > SNAPSHOT_THROTTLE_MS) {
        lastSnapshotAt.current = now;
        createSnapshot(o.projectId, u.id, doc, tp).catch((e) =>
          console.error("snapshot failed", e)
        );
      }
      setStatus("synced");
    } catch (e) {
      console.error("cloud save failed", e);
      setStatus("error");
    }
  }, [editor]);

  const debouncedPush = useRef(debounce(() => void pushNow(), PUSH_DEBOUNCE_MS));
  useEffect(() => {
    debouncedPush.current = debounce(() => void pushNow(), PUSH_DEBOUNCE_MS);
  }, [pushNow]);

  // --- Reconcile this project once when a signed-in user + editor are ready ---
  useEffect(() => {
    if (!editor || !user) {
      if (!user) setStatus("local");
      return;
    }
    const key = `${user.id}:${projectId}`;
    if (reconciledFor.current === key) return;
    reconciledFor.current = key;

    (async () => {
      const o = optsRef.current;
      setStatus("syncing");
      const localDoc = editor.getJSON();
      try {
        const cloud = await fetchScript(projectId);
        if (cloud) {
          const lastSaved = o.getLastSavedAt();
          const cloudNewer =
            !lastSaved || new Date(cloud.updated_at) > new Date(lastSaved);
          // The editor stayed interactive during the fetch: re-read it so any
          // typing in that window is never clobbered.
          const live = editor.getJSON();
          const typedDuringFetch =
            JSON.stringify(live) !== JSON.stringify(localDoc);
          if (o.isDirty() || typedDuringFetch) {
            const ts = await saveScript(
              projectId,
              live,
              (o.getTitle?.() || "").trim() || o.deriveTitle(live),
              titlePageRef.current
            );
            // Keep dirty if the save did not actually land (null = 401/offline),
            // so it retries instead of being lost.
            if (ts) {
              o.setLastSavedAt(ts);
              o.setDirty(false);
            } else {
              setStatus("error");
            }
          } else if (cloudNewer) {
            pullInto(cloud.content, cloud.title_page ?? null);
            o.setLastSavedAt(cloud.updated_at);
          }
        } else {
          // No cloud row yet (a local-only project opened while signed in):
          // create it under the SAME id so local id == cloud id.
          const live = editor.getJSON();
          const row = await createScript(user.id, (o.getTitle?.() || "").trim() || o.deriveTitle(live), live, {
            id: projectId,
            type: o.type,
            status: o.status,
            titlePage: titlePageRef.current,
          });
          if (row) {
            o.setLastSavedAt(row.updated_at);
            o.onCloudCreated?.(projectId);
            o.setDirty(false);
          } else {
            setStatus("error");
          }
        }
        setStatus(
          typeof navigator !== "undefined" && !navigator.onLine
            ? "offline"
            : "synced"
        );
      } catch (e) {
        console.error("reconcile failed", e);
        reconciledFor.current = null; // allow a retry
        setStatus("error");
      }
    })();
  }, [editor, user, projectId, pullInto]);

  // --- Subscribe to edits: mark dirty + schedule a background push ---------
  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => {
      if (!userRef.current) return;
      optsRef.current.setDirty(true);
      setStatus("syncing");
      debouncedPush.current();
    };
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
    };
  }, [editor]);

  // --- Flush pending edits when the connection returns ---------------------
  useEffect(() => {
    const onOnline = () => {
      if (optsRef.current.isDirty()) void pushNow();
    };
    const onOffline = () => setStatus("offline");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [pushNow]);

  // Signed out: stop syncing (the host unmounts to home, so no editor reset here).
  useEffect(() => {
    if (!user) setStatus("local");
  }, [user]);

  /** For the history panel: snapshots of this project. */
  const getVersions = useCallback(
    async (): Promise<VersionRow[]> => listVersions(projectId),
    [projectId]
  );

  /** Edit the title page: persist locally, mark dirty, schedule a cloud push. */
  const setTitlePage = useCallback((tp: TitlePage | null) => {
    const next = trimTitlePage(tp);
    titlePageRef.current = next;
    optsRef.current.saveLocalTitlePage(next);
    setTitlePageState(next);
    optsRef.current.setDirty(true);
    if (userRef.current) debouncedPush.current();
  }, []);

  /** Restore a snapshot's content (and its title page) into the editor. */
  const restoreVersion = useCallback(
    (content: JSONContent, tp?: TitlePage | null) => {
      pullInto(content, tp);
      optsRef.current.setDirty(true);
      void pushNow();
    },
    [pullInto, pushNow]
  );

  /** Load imported content into the editor (same path as a version restore). */
  const importContent = useCallback(
    (content: JSONContent, tp?: TitlePage | null) => {
      pullInto(content, tp);
      optsRef.current.setDirty(true);
      void pushNow();
    },
    [pullInto, pushNow]
  );

  /** Flush any pending debounced push now (used on navigating away). */
  const flush = useCallback(() => {
    debouncedPush.current.cancel();
    if (userRef.current && optsRef.current.isDirty()) void pushNow();
  }, [pushNow]);

  return {
    status,
    pulledTick,
    getVersions,
    restoreVersion,
    importContent,
    titlePage,
    setTitlePage,
    flush,
  };
}
