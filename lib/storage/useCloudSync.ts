"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import type { User } from "@supabase/supabase-js";

import {
  createScript,
  createSnapshot,
  fetchScript,
  listScripts,
  listVersions,
  saveScript,
  type VersionRow,
} from "@/lib/supabase/scripts";
import { deriveTitle, isMeaningfulDoc } from "@/lib/editor/docUtils";
import { SAMPLE_SCRIPT } from "@/lib/editor/sampleScript";
import {
  debounce,
  getActiveScriptId,
  getLastSavedAt,
  isDirty,
  saveDoc,
  setActiveScriptId,
  setDirty,
  setLastSavedAt,
} from "./localStore";

export type SyncStatus =
  | "local" // not signed in — local only
  | "syncing"
  | "synced"
  | "offline"
  | "error";

const PUSH_DEBOUNCE_MS = 1500;
const SNAPSHOT_THROTTLE_MS = 3 * 60 * 1000; // at most one snapshot per 3 min

/**
 * Ties the editor to the cloud while keeping local-first guarantees:
 *
 *  - Local storage is always written first (instant, never lost).
 *  - When signed in, changes also push to Supabase in the background.
 *  - On load it reconciles local vs cloud safely (never silently loses work,
 *    including edits typed while the cloud copy is still loading).
 *  - Offline edits keep working and flush when the connection returns.
 *  - Periodic immutable snapshots give you a rollback safety net.
 *  - On sign-out it fully resets, so one user's work can never bleed into the
 *    next user on a shared browser.
 */
export function useCloudSync(editor: Editor | null, user: User | null) {
  const [status, setStatus] = useState<SyncStatus>("local");
  const [activeId, setActiveId] = useState<string | null>(null);
  // Bumped whenever we load cloud/snapshot content into the editor with the
  // 'update' event suppressed, so the surrounding UI (word/page count, the
  // "Saved" label) knows to recompute against the freshly loaded document.
  const [pulledTick, setPulledTick] = useState(0);

  // Refs so the editor 'update' subscription never goes stale.
  const userRef = useRef<User | null>(user);
  const activeIdRef = useRef<string | null>(null);
  const lastSnapshotAt = useRef<number>(0);
  const reconciledFor = useRef<string | null>(null);
  const prevUserId = useRef<string | null>(null); // detect real sign-out transitions

  userRef.current = user;

  const setActive = useCallback((id: string | null) => {
    activeIdRef.current = id;
    setActiveScriptId(id);
    setActiveId(id);
  }, []);

  // Load content into the editor WITHOUT firing 'update' (so we don't trigger a
  // save loop), mirror it to local storage, and signal the UI to recompute.
  const pullInto = useCallback(
    (content: JSONContent) => {
      if (!editor) return;
      editor.commands.setContent(content, { emitUpdate: false });
      saveDoc(content);
      setPulledTick((t) => t + 1);
    },
    [editor]
  );

  // Push the current document to the cloud (with a throttled snapshot).
  const pushNow = useCallback(async () => {
    const id = activeIdRef.current;
    const u = userRef.current;
    const ed = editor;
    if (!id || !u || !ed) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setStatus("offline");
      return;
    }
    try {
      const doc = ed.getJSON();
      const snapshotJson = JSON.stringify(doc);
      const ts = await saveScript(id, doc, deriveTitle(doc));
      if (ts) setLastSavedAt(ts);
      // Only mark clean if nothing was typed during the save round trip;
      // otherwise leave dirty=true so the offline-flush path still fires.
      if (JSON.stringify(ed.getJSON()) === snapshotJson) setDirty(false);

      // Snapshot, throttled, so history doesn't fill with every keystroke burst.
      const now = Date.now();
      if (now - lastSnapshotAt.current > SNAPSHOT_THROTTLE_MS) {
        lastSnapshotAt.current = now;
        createSnapshot(id, u.id, doc).catch((e) =>
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

  // --- Reconciliation: runs once when a signed-in user + editor are ready ---
  useEffect(() => {
    if (!editor || !user) {
      if (!user) setStatus("local");
      return;
    }
    if (reconciledFor.current === user.id) return; // already reconciled
    reconciledFor.current = user.id;

    (async () => {
      setStatus("syncing");
      const localDoc = editor.getJSON();
      let id = getActiveScriptId();

      try {
        if (id) {
          const cloud = await fetchScript(id);
          if (!cloud) {
            id = null; // gone / not ours — fall through to first-sign-in path
          } else {
            const lastSaved = getLastSavedAt();
            const cloudNewer =
              !lastSaved || new Date(cloud.updated_at) > new Date(lastSaved);
            // The editor stayed interactive during the fetch above, so re-read
            // it: anything typed in that window must NOT be clobbered.
            const live = editor.getJSON();
            const typedDuringFetch =
              JSON.stringify(live) !== JSON.stringify(localDoc);
            if (isDirty() || typedDuringFetch) {
              // Un-pushed local edits (incl. in-flight typing) win.
              const ts = await saveScript(id, live, deriveTitle(live));
              if (ts) setLastSavedAt(ts);
              setDirty(false);
            } else if (cloudNewer) {
              // Another device moved ahead — pull cloud in.
              pullInto(cloud.content);
              setLastSavedAt(cloud.updated_at);
            }
          }
        }

        if (!id) {
          // First time signing in on this device. Re-read live content so any
          // typing during the (possible) fetch above is preserved.
          const live = editor.getJSON();
          if (isMeaningfulDoc(live)) {
            // Preserve the anonymous work as a new cloud script.
            const row = await createScript(user.id, deriveTitle(live), live);
            if (row) {
              id = row.id;
              setLastSavedAt(row.updated_at);
            }
          } else {
            const existing = await listScripts();
            if (existing.length) {
              const cloud = await fetchScript(existing[0].id);
              if (cloud) {
                id = cloud.id;
                pullInto(cloud.content);
                setLastSavedAt(cloud.updated_at);
              }
            } else {
              const row = await createScript(user.id, deriveTitle(live), live);
              if (row) {
                id = row.id;
                setLastSavedAt(row.updated_at);
              }
            }
          }
          setDirty(false);
        }

        setActive(id);
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
  }, [editor, user, setActive, pullInto]);

  // --- Subscribe to edits: mark dirty + schedule a background push ---------
  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => {
      if (!userRef.current) return;
      // Mark dirty even before reconcile assigns an activeId, so edits made
      // during the reconcile fetch window are never treated as "clean".
      setDirty(true);
      setStatus("syncing");
      if (activeIdRef.current) debouncedPush.current();
    };
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
    };
  }, [editor]);

  // --- Flush pending edits when the connection returns ---------------------
  useEffect(() => {
    const onOnline = () => {
      if (activeIdRef.current && isDirty()) void pushNow();
    };
    const onOffline = () => setStatus("offline");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [pushNow]);

  // --- Sign-out: stop sync, clear ALL bookkeeping, reset the editor --------
  // Only fires on a genuine signed-in -> signed-out transition (not on the
  // initial anonymous load), so anonymous local work is never wiped.
  useEffect(() => {
    const had = prevUserId.current;
    prevUserId.current = user?.id ?? null;
    if (user) return;
    if (!had) return; // initial load / already anonymous — leave local work alone

    reconciledFor.current = null;
    activeIdRef.current = null;
    setActiveId(null);
    // Clear persisted cloud bookkeeping so the next user on this browser does
    // NOT inherit the previous user's script id, timestamps, or content.
    setActiveScriptId(null);
    setLastSavedAt(null);
    setDirty(false);
    if (editor) {
      editor.commands.setContent(SAMPLE_SCRIPT, { emitUpdate: false });
      saveDoc(SAMPLE_SCRIPT);
      setPulledTick((t) => t + 1);
    }
    setStatus("local");
  }, [user, editor]);

  /** For the history panel: list snapshots of the active script. */
  const getVersions = useCallback(async (): Promise<VersionRow[]> => {
    if (!activeIdRef.current) return [];
    return listVersions(activeIdRef.current);
  }, []);

  /** Restore a snapshot's content into the editor (and push it as current). */
  const restoreVersion = useCallback(
    (content: JSONContent) => {
      pullInto(content);
      setDirty(true);
      void pushNow();
    },
    [pullInto, pushNow]
  );

  /**
   * Load imported content into the editor. Behaviorally identical to a version
   * restore: it suppresses the 'update' event (so it never races the debounced
   * local save), mirrors to local storage, refreshes the UI via pulledTick, and
   * pushes to the active cloud script when signed in. Marking dirty first means
   * a mid-flight reconcile treats the import as un-pushed local work and never
   * clobbers it.
   */
  const importContent = useCallback(
    (content: JSONContent) => {
      pullInto(content);
      setDirty(true);
      void pushNow();
    },
    [pullInto, pushNow]
  );

  return {
    status,
    activeId,
    pulledTick,
    getVersions,
    restoreVersion,
    importContent,
  };
}
