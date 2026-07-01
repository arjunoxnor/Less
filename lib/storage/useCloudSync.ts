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
  setScriptTitle,
  type VersionRow,
} from "@/lib/cloud/scripts";
import { trimTitlePage, type TitlePage } from "@/lib/export/titlePage";
import { debounce } from "./localStore";
import { onBroadcast } from "./broadcast";
import {
  loadProjectDoc,
  listLocalVersions,
  addLocalVersion,
  type ProjectStatus,
  type ProjectType,
} from "./projects";

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
  /** Title-page-specific dirty flag (persisted), so a pending title-page edit is
   *  pushed on reconcile but a merely-stale local title page is not. */
  isTitlePageDirty: () => boolean;
  setTitlePageDirty: (dirty: boolean) => void;
  /** Title-specific dirty flag (persisted). A genuine local title change (a
   *  rename, or a plain-doc auto-derived title) is pushed via the title-only
   *  endpoint; the content save never carries the title. */
  isTitleDirty: () => boolean;
  setTitleDirty: (dirty: boolean) => void;
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

  // Push a genuine local title change via the title-only endpoint. Called after
  // a content save so the content path never carries (and cannot clobber) the
  // title. Cleared only when the value that landed is still the current title.
  const flushTitle = useCallback(async () => {
    const o = optsRef.current;
    if (!o.isTitleDirty()) return;
    const ed = editor;
    if (!ed) return;
    const title = (o.getTitle?.() || "").trim() || o.deriveTitle(ed.getJSON());
    const ts = await setScriptTitle(o.projectId, title || "Untitled");
    if (ts) o.setTitleDirty(false);
  }, [editor]);

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
      const ts = await saveScript(o.projectId, doc, tp);
      // A null result means the save never reached the cloud (e.g. the session
      // expired -> 401). Keep it dirty and show an error so it retries; never
      // report "synced" or clear the dirty flag, which would risk a later pull
      // overwriting work that was never actually saved.
      if (!ts) {
        setStatus("error");
        return;
      }
      o.setLastSavedAt(ts);
      const docUnchanged = JSON.stringify(ed.getJSON()) === snapshotJson;
      const tpUnchanged = JSON.stringify(titlePageRef.current) === tpSnapshot;
      // The title page we just pushed is now current on the cloud, so clear its
      // dirty flag if it did not change mid-flight.
      if (tpUnchanged) o.setTitlePageDirty(false);
      // Only mark the doc clean if neither doc nor title page changed in-flight.
      if (docUnchanged && tpUnchanged) {
        o.setDirty(false);
      }
      const now = Date.now();
      if (now - lastSnapshotAt.current > SNAPSHOT_THROTTLE_MS) {
        lastSnapshotAt.current = now;
        createSnapshot(o.projectId, u.id, doc, tp).catch((e) =>
          console.error("snapshot failed", e)
        );
      }
      // A local title change (rename / plain-doc auto-name) rides its own path.
      await flushTitle().catch((e) => console.error("title push failed", e));
      setStatus("synced");
    } catch (e) {
      console.error("cloud save failed", e);
      setStatus("error");
    }
  }, [editor, flushTitle]);

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
            // Push the dirty content. For the title page, push it only when it
            // was actually edited locally (tpDirty); otherwise pass undefined so
            // a newer cloud title page is neither clobbered (audit #17) nor a
            // genuine local title-page edit silently dropped.
            const tpDirty = o.isTitlePageDirty();
            const ts = await saveScript(
              projectId,
              live,
              tpDirty ? titlePageRef.current : undefined
            );
            // Keep dirty if the save did not actually land (null = 401/offline),
            // so it retries instead of being lost.
            if (ts) {
              o.setLastSavedAt(ts);
              o.setDirty(false);
              if (tpDirty) o.setTitlePageDirty(false);
              await flushTitle().catch((e) => console.error("title push failed", e));
            } else {
              setStatus("error");
            }
          } else if (cloudNewer) {
            pullInto(cloud.content, cloud.title_page ?? null);
            o.setLastSavedAt(cloud.updated_at);
            o.setTitlePageDirty(false);
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
            o.setTitlePageDirty(false); // the created row carries the title page
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

  // --- Cross-tab: adopt a sibling tab's newer save of THIS project ---------
  // Another tab on this device just wrote a fresher body to localStorage. If we
  // have no unsaved edits of our own, load it into the editor so this tab cannot
  // later autosave a stale copy over it. If we ARE dirty, we keep our edits
  // (cloud last-write-wins reconciles later) rather than clobber them here.
  useEffect(() => {
    if (!editor) return;
    return onBroadcast((msg) => {
      if (msg.type !== "docSaved" || msg.id !== projectId) return;
      if (optsRef.current.isDirty()) return;
      const fresh = loadProjectDoc(projectId);
      if (!fresh) return;
      // Write straight into the editor (no re-save, so no broadcast echo); the
      // localStorage copy is already the sibling's, which is what we're adopting.
      editor.commands.setContent(fresh, { emitUpdate: false });
      setPulledTick((t) => t + 1);
    });
  }, [editor, projectId]);

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

  /** For the history panel: cloud snapshots (when signed in) merged with the
   *  on-device ring, newest first, so a signed-out writer still has rollback. */
  const getVersions = useCallback(async (): Promise<VersionRow[]> => {
    const cloud = userRef.current ? await listVersions(projectId) : [];
    const local: VersionRow[] = listLocalVersions(projectId).map((v) => ({
      id: `local:${v.at}`,
      content: v.content,
      title_page: v.titlePage ?? null,
      label: v.label ? `${v.label} (this device)` : "On this device",
      created_at: v.at,
    }));
    return [...cloud, ...local].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [projectId]);

  /** Edit the title page: persist locally, mark dirty, schedule a cloud push. */
  const setTitlePage = useCallback((tp: TitlePage | null) => {
    const next = trimTitlePage(tp);
    titlePageRef.current = next;
    optsRef.current.saveLocalTitlePage(next);
    setTitlePageState(next);
    optsRef.current.setDirty(true);
    optsRef.current.setTitlePageDirty(true); // a real local title-page edit
    if (userRef.current) debouncedPush.current();
  }, []);

  // Take an immediate, unthrottled snapshot of the CURRENT (pre-replacement)
  // doc so a restore or import is always recoverable, regardless of the
  // periodic snapshot throttle. The local ring always gets one (works signed
  // out); the cloud snapshot additionally lands when signed in.
  const snapshotLive = useCallback(
    (label: string) => {
      const ed = editor;
      if (!ed) return;
      addLocalVersion(optsRef.current.projectId, ed.getJSON(), titlePageRef.current, label, {
        force: true,
      });
      const u = userRef.current;
      if (!u) return;
      createSnapshot(optsRef.current.projectId, u.id, ed.getJSON(), titlePageRef.current, label).catch(
        (e) => console.error("pre-action snapshot failed", e)
      );
    },
    [editor]
  );

  /** Restore a snapshot's content (and its title page) into the editor. */
  const restoreVersion = useCallback(
    (content: JSONContent, tp?: TitlePage | null) => {
      snapshotLive("Before restore");
      pullInto(content, tp);
      optsRef.current.setDirty(true);
      if (tp !== undefined) optsRef.current.setTitlePageDirty(true);
      void pushNow();
    },
    [pullInto, pushNow, snapshotLive]
  );

  /** Load imported content into the editor (same path as a version restore). */
  const importContent = useCallback(
    (content: JSONContent, tp?: TitlePage | null) => {
      snapshotLive("Before import");
      pullInto(content, tp);
      optsRef.current.setDirty(true);
      if (tp !== undefined) optsRef.current.setTitlePageDirty(true);
      void pushNow();
    },
    [pullInto, pushNow, snapshotLive]
  );

  /** Flush any pending debounced push now (used on navigating away and before
   *  sign-out). Awaitable so a caller can ensure the final edit lands in the
   *  cloud before local cloud-backed copies are cleared. */
  const flush = useCallback(async () => {
    debouncedPush.current.cancel();
    if (userRef.current && optsRef.current.isDirty()) await pushNow();
  }, [pushNow]);

  /**
   * Flush on tab close: a small dirty doc is sent with keepalive so the request
   * survives the page tearing down (a plain fetch is cancelled). Bodies over the
   * browser's ~64KB keepalive cap fall back to a best-effort normal push.
   */
  const flushBeacon = useCallback(() => {
    debouncedPush.current.cancel();
    const u = userRef.current;
    const ed = editor;
    const o = optsRef.current;
    if (!u || !ed || !o.isDirty()) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    const doc = ed.getJSON();
    const tp = titlePageRef.current;
    // Measure UTF-8 bytes (the keepalive cap is on the wire body, not UTF-16
    // chars), so a multi-byte (CJK/emoji) doc is not wrongly admitted.
    const bytes = new TextEncoder().encode(
      JSON.stringify({ content: doc, title_page: tp })
    ).length;
    if (bytes < 60000) {
      // Fall back to a normal best-effort push if the keepalive send is rejected.
      void saveScript(o.projectId, doc, o.isTitlePageDirty() ? tp : undefined, {
        keepalive: true,
      }).catch(() => void pushNow());
    } else {
      void pushNow();
    }
  }, [editor, pushNow]);

  return {
    status,
    pulledTick,
    getVersions,
    restoreVersion,
    importContent,
    titlePage,
    setTitlePage,
    flush,
    flushBeacon,
  };
}
