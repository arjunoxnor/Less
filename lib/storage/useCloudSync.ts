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
 *  - On load it reconciles local vs cloud safely (never silently loses work).
 *  - Offline edits keep working and flush when the connection returns.
 *  - Periodic immutable snapshots give you a rollback safety net.
 */
export function useCloudSync(editor: Editor | null, user: User | null) {
  const [status, setStatus] = useState<SyncStatus>("local");
  const [activeId, setActiveId] = useState<string | null>(null);

  // Refs so the editor 'update' subscription never goes stale.
  const userRef = useRef<User | null>(user);
  const activeIdRef = useRef<string | null>(null);
  const lastSnapshotAt = useRef<number>(0);
  const reconciledFor = useRef<string | null>(null);

  userRef.current = user;

  const setActive = useCallback((id: string | null) => {
    activeIdRef.current = id;
    setActiveScriptId(id);
    setActiveId(id);
  }, []);

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
      const title = deriveTitle(doc);
      const ts = await saveScript(id, doc, title);
      if (ts) setLastSavedAt(ts);
      setDirty(false);

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
            if (isDirty()) {
              // We have un-pushed local edits — local wins.
              const ts = await saveScript(id, localDoc, deriveTitle(localDoc));
              if (ts) setLastSavedAt(ts);
              setDirty(false);
            } else if (cloudNewer) {
              // Another device moved ahead — pull cloud in.
              applyCloud(editor, cloud.content);
              setLastSavedAt(cloud.updated_at);
            }
          }
        }

        if (!id) {
          // First time signing in on this device.
          if (isMeaningfulDoc(localDoc)) {
            // Preserve the anonymous work as a new cloud script.
            const row = await createScript(
              user.id,
              deriveTitle(localDoc),
              localDoc
            );
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
                applyCloud(editor, cloud.content);
                setLastSavedAt(cloud.updated_at);
              }
            } else {
              const row = await createScript(
                user.id,
                deriveTitle(localDoc),
                localDoc
              );
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
  }, [editor, user, setActive]);

  // --- Subscribe to edits: mark dirty + schedule a background push ---------
  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => {
      if (!userRef.current || !activeIdRef.current) return;
      setDirty(true);
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

  // --- Sign-out: stop cloud sync, keep the local copy ----------------------
  useEffect(() => {
    if (!user) {
      reconciledFor.current = null;
      activeIdRef.current = null;
      setActiveId(null);
    }
  }, [user]);

  /** For the history panel: list snapshots of the active script. */
  const getVersions = useCallback(async (): Promise<VersionRow[]> => {
    if (!activeIdRef.current) return [];
    return listVersions(activeIdRef.current);
  }, []);

  /** Restore a snapshot's content into the editor (and push it as current). */
  const restoreVersion = useCallback(
    (content: JSONContent) => {
      if (!editor) return;
      applyCloud(editor, content);
      setDirty(true);
      void pushNow();
    },
    [editor, pushNow]
  );

  return { status, activeId, getVersions, restoreVersion };
}

/** Load cloud content into the editor without triggering a save loop. */
function applyCloud(editor: Editor, content: JSONContent) {
  editor.commands.setContent(content, { emitUpdate: false });
  saveDoc(content);
}
