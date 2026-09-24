"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import { isSessionExpired, type CloudUser as User } from "@/lib/cloud/client";

import {
  createScript,
  createSnapshot,
  fetchScript,
  listScripts,
  listVersions,
  saveScript,
  setScriptTitle,
  type ScriptRow,
  type VersionRow,
} from "@/lib/cloud/scripts";
import { trimTitlePage, type TitlePage } from "@/lib/export/titlePage";
import { debounce } from "./localStore";
import { onBroadcast } from "./broadcast";
import { stillMatchesField, stillMatchesSnapshot } from "./syncSafety";
import {
  decideRemote,
  isBlankDoc,
  syncFingerprint,
  type RemoteDecision,
} from "./syncBaseline";
import {
  loadProjectDoc,
  localProjectIdFor,
  listLocalVersions,
  addLocalVersion,
  type ProjectStatus,
  type ProjectType,
} from "./projects";
import { replaceDocInPlace } from "@/lib/editor/replaceDoc";

export type SyncStatus =
  | "local" // signed out, so local only
  | "syncing"
  | "synced"
  | "offline"
  | "error";

const PUSH_DEBOUNCE_MS = 1500;
const SNAPSHOT_THROTTLE_MS = 3 * 60 * 1000; // at most one snapshot per 3 min
// How often a visible, open document looks for a body written somewhere else.
// Coming back to the tab checks at once; this covers a tab that never left.
const REMOTE_WATCH_MS = 20 * 1000;
const REMOTE_UPDATE_LABEL = "Before update from another device";

/** Everything the per-project sync engine needs, injected by the editor body. */
export interface CloudSyncOpts {
  /** A shared Yjs document has its own authority. When true, every LWW cloud
   *  read, write, reconcile, and cross-tab replacement path stays inert. */
  disabled?: boolean;
  projectId: string;
  type: ProjectType;
  status: ProjectStatus;
  deriveTitle: (doc: JSONContent) => string;
  /** The project's real title; preferred over deriveTitle so an explicit title
   *  is never overwritten by the document's first line. */
  getTitle?: () => string;
  saveLocalDoc: (doc: JSONContent) => boolean | void;
  loadLocalTitlePage: () => TitlePage | null;
  saveLocalTitlePage: (tp: TitlePage | null) => boolean | void;
  /** True while the editor has changes newer than its debounced local write. */
  hasUnsavedLocalEdits?: () => boolean;
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
  /** Fingerprint of the body this device and the cloud last agreed on (see
   *  syncBaseline.ts). Without these two the hook keeps the older flag-only
   *  rules and never looks at the cloud again after it opens. */
  getSyncedPrint?: () => string | null;
  setSyncedPrint?: (print: string | null) => void;
  /** The open document was just replaced by a body written somewhere else.
   *  "conflict" means local edits were moved into History to make room. */
  onRemoteUpdate?: (kind: "pulled" | "conflict") => void;
  /** Called after this project's cloud row is first created. */
  onCloudCreated?: (id: string) => void;
  /** Marks the first insert as in flight so sign-out cannot orphan its result. */
  setCloudCreatePending?: (pending: boolean) => void;
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
  const [pulledSaveOk, setPulledSaveOk] = useState(true);

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
  const ownDirtyRef = useRef(opts.isDirty());
  const ownTitlePageDirtyRef = useRef(opts.isTitlePageDirty());
  const mountedRef = useRef(true);
  const pushInFlightRef = useRef<Promise<void> | null>(null);
  // Bumped whenever a push starts. The remote watch reads it before and after
  // its network wait: a push that started and finished inside that wait left
  // the watch holding a cloud row older than this tab's own save, which it
  // would otherwise have "pulled" over the writer's newer text.
  const pushGenRef = useRef(0);
  const pushAgainRef = useRef(false);
  const reconcilingRef = useRef(false);
  const watchBusyRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const projectId = opts.projectId;

  // Load content into the editor WITHOUT firing 'update', mirror it to local
  // storage, and signal the UI to recompute.
  const pullInto = useCallback(
    (content: JSONContent, tp?: TitlePage | null) => {
      if (!editor) return;
      // Only the stretch that differs is replaced, so a writer who is looking
      // at the page keeps their caret on the same words and the view does not
      // move. A whole-document swap sent the caret to the end of the script
      // and wiped every page break until the pages were measured again.
      replaceDocInPlace(editor, content);
      const docSaved = optsRef.current.saveLocalDoc(content) !== false;
      let titlePageSaved = true;
      ownDirtyRef.current = false;
      if (tp !== undefined) {
        titlePageRef.current = tp;
        titlePageSaved = optsRef.current.saveLocalTitlePage(tp) !== false;
        setTitlePageState(tp);
        ownTitlePageDirtyRef.current = false;
      }
      setPulledSaveOk(docSaved && titlePageSaved);
      setPulledTick((t) => t + 1);
    },
    [editor]
  );

  // Take an immediate, unthrottled snapshot of the CURRENT (pre-replacement)
  // doc so a restore, an import, or a body arriving from elsewhere is always
  // recoverable, regardless of the periodic snapshot throttle. The local ring
  // always gets one (works signed out); the cloud snapshot additionally lands
  // when signed in.
  const snapshotLive = useCallback(
    (label: string) => {
      const ed = editor;
      if (!ed) return;
      addLocalVersion(optsRef.current.projectId, ed.getJSON(), titlePageRef.current, label, {
        force: true,
      });
      const u = userRef.current;
      if (!u || optsRef.current.disabled) return;
      createSnapshot(optsRef.current.projectId, u.id, ed.getJSON(), titlePageRef.current, label).catch(
        (e) => console.error("pre-action snapshot failed", e)
      );
    },
    [editor]
  );

  // The cloud body as THIS editor would hold it. A body written by another
  // client build, or by a tool writing straight to the database, may spell the
  // same document differently (attribute defaults left out). Passing it through
  // the schema makes it comparable with editor.getJSON(). A body the schema
  // cannot read is compared as it came.
  const asEditorWouldHold = useCallback(
    (content: JSONContent): JSONContent => {
      try {
        const schema = editor?.schema;
        if (schema?.nodeFromJSON) return schema.nodeFromJSON(content).toJSON() as JSONContent;
      } catch {
        // fall through
      }
      return content;
    },
    [editor]
  );

  /** Record what the cloud now holds, as far as this device knows. */
  const recordBaseline = useCallback((doc: JSONContent, tp: TitlePage | null) => {
    optsRef.current.setSyncedPrint?.(syncFingerprint(doc, tp));
  }, []);

  /**
   * Settle the open editor against a cloud row (rules in syncBaseline.ts).
   *
   * Everything from reading the editor to replacing its content happens in one
   * synchronous stretch, so no keystroke can land between the decision and the
   * replacement and be lost.
   *
   * "push" is returned WITHOUT pushing: the caller owns the network write.
   * `origin` is where the question came from. Only a body that arrives while the
   * writer is already in the document ("watch", "prepush") is announced and
   * backed up first; the open-time pull stays as quiet as it always was.
   */
  const settleWithCloud = useCallback(
    (
      cloud: ScriptRow,
      ask: { origin: "open" | "watch" | "prepush"; legacyDirty: boolean }
    ): RemoteDecision => {
      if (!editor) return "noop";
      const o = optsRef.current;
      const live = editor.getJSON();
      const localTp = titlePageRef.current;
      const cloudBody = asEditorWouldHold(cloud.content);
      const cloudTp = trimTitlePage(cloud.title_page);
      const lastSaved = o.getLastSavedAt();
      const decision = decideRemote({
        baseline: o.getSyncedPrint?.() ?? null,
        localPrint: syncFingerprint(live, localTp),
        cloudPrint: syncFingerprint(cloudBody, cloudTp),
        localBlank: isBlankDoc(live),
        cloudBlank: isBlankDoc(cloudBody),
        cloudMoved: !lastSaved || cloud.updated_at !== lastSaved,
        legacyDirty: ask.legacyDirty,
        legacyCloudNewer: !lastSaved || new Date(cloud.updated_at) > new Date(lastSaved),
      });
      if (decision === "noop" || decision === "push") return decision;

      if (decision === "advance") {
        // Same body on both sides: nothing to send, only clocks to record.
        o.setLastSavedAt(cloud.updated_at);
        recordBaseline(live, localTp);
        o.setDirty(false);
        ownDirtyRef.current = false;
        o.setTitlePageDirty(false);
        ownTitlePageDirtyRef.current = false;
        return decision;
      }

      // "pull" or "conflict": the cloud body replaces what is on screen.
      const arrivedLive = ask.origin !== "open";
      if (decision === "conflict") {
        snapshotLive(REMOTE_UPDATE_LABEL); // the writer's unsent edits, kept in both rings
      } else if (arrivedLive && !isBlankDoc(live)) {
        addLocalVersion(o.projectId, live, localTp, REMOTE_UPDATE_LABEL, { force: true });
      }
      pullInto(cloud.content, cloudTp);
      o.setLastSavedAt(cloud.updated_at);
      o.setDirty(false);
      o.setTitlePageDirty(false);
      recordBaseline(editor.getJSON(), cloudTp);
      if (decision === "conflict") o.onRemoteUpdate?.("conflict");
      else if (arrivedLive) o.onRemoteUpdate?.("pulled");
      return decision;
    },
    [editor, asEditorWouldHold, pullInto, recordBaseline, snapshotLive]
  );

  /** The cloud row, but only if it moved since this device last synced to it.
   *  Asks the cheap list first (clocks only, no bodies) and fetches the body
   *  only when the clock differs. Null also covers "could not ask": offline, a
   *  401, or a caller that has not wired baselines. */
  const cloudRowIfMoved = useCallback(async (): Promise<ScriptRow | null> => {
    const o = optsRef.current;
    if (!o.getSyncedPrint || !o.setSyncedPrint) return null;
    try {
      const row = (await listScripts()).find((r) => r.id === o.projectId);
      if (!row || row.updated_at === o.getLastSavedAt()) return null;
      return await fetchScript(o.projectId);
    } catch {
      return null;
    }
  }, []);

  // Push a genuine local title change via the title-only endpoint. Called after
  // a content save so the content path never carries (and cannot clobber) the
  // title. Cleared only when the value that landed is still the current title.
  const flushTitle = useCallback(async () => {
    const o = optsRef.current;
    if (o.disabled) return;
    if (!o.isTitleDirty()) return;
    const ed = editor;
    if (!ed) return;
    const title = (o.getTitle?.() || "").trim() || o.deriveTitle(ed.getJSON());
    const requested = title || "Untitled";
    const ts = await setScriptTitle(o.projectId, requested);
    // Same reasoning as the body push below: the unmount flush is a normal way
    // for this to complete, and setTitleDirty is a localStorage write. Bailing
    // here would leave a title that already landed marked dirty forever.
    if (!ts) throw new Error("title save did not reach the cloud");
    const current =
      (optsRef.current.getTitle?.() || "").trim() ||
      optsRef.current.deriveTitle(ed.getJSON()) ||
      "Untitled";
    if (stillMatchesField(current, requested)) o.setTitleDirty(false);
  }, [editor]);

  // Push the current document to the cloud (with a throttled snapshot).
  const pushOnce = useCallback(async () => {
    if (optsRef.current.disabled) return;
    const u = userRef.current;
    const ed = editor;
    if (!u || !ed) return;
    // An expired session would just 401 on every push: go quiet instead of
    // hammering the API. The doc stays dirty locally and pushes after re-auth.
    if (isSessionExpired()) {
      setStatus("error");
      return;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setStatus("offline");
      return;
    }
    const o = optsRef.current;
    // A sibling tab deleted or concurrently replaced this project. The local
    // storage layer forked this tab's text into a recovered project; never send
    // that divergent body back under the deleted/original cloud id.
    if (localProjectIdFor(o.projectId) !== o.projectId) {
      setStatus("local");
      return;
    }
    try {
      // Look before writing. The save below is unconditional on the server, so
      // a body written somewhere else since this device last synced would be
      // replaced without a trace. If the cloud moved, settle first: only a real
      // local change on top of an unchanged cloud body still goes up. (A write
      // landing in the instant between this look and the save can still lose;
      // closing that needs a conditional save on the server.)
      const moved = await cloudRowIfMoved();
      if (moved) {
        const decision = settleWithCloud(moved, { origin: "prepush", legacyDirty: true });
        if (decision !== "push") {
          await flushTitle();
          if (mountedRef.current) setStatus(o.isTitleDirty() ? "syncing" : "synced");
          return;
        }
      } else {
        const baseline = o.getSyncedPrint?.() ?? null;
        if (
          baseline &&
          o.getLastSavedAt() &&
          syncFingerprint(ed.getJSON(), titlePageRef.current) === baseline
        ) {
          // Flagged dirty by an update that changed nothing (opening an empty
          // screenplay is enough). The cloud already holds this exact body.
          o.setDirty(false);
          ownDirtyRef.current = false;
          o.setTitlePageDirty(false);
          ownTitlePageDirtyRef.current = false;
          await flushTitle();
          if (mountedRef.current) setStatus(o.isTitleDirty() ? "syncing" : "synced");
          return;
        }
      }
      const doc = ed.getJSON();
      const tp = titlePageRef.current;
      const tpWasDirty = ownTitlePageDirtyRef.current;
      const snapshotJson = JSON.stringify(doc);
      const tpSnapshot = JSON.stringify(tp);
      if (!stillMatchesSnapshot(loadProjectDoc(o.projectId), snapshotJson)) {
        o.saveLocalDoc(doc);
      }
      // A body edit must not re-upload a merely cached title page. Another
      // device may have changed it since this editor opened.
      const ts = await saveScript(o.projectId, doc, tpWasDirty ? tp : undefined);
      // Deliberately NOT gated on mountedRef: the unmount flush is the common
      // way a push completes (closing the editor). Bailing here would leave a
      // successfully-pushed body marked dirty, and the next reconcile would
      // force-push that stale body over a newer copy from another device. The
      // bookkeeping below is localStorage, not editor state, so it is correct
      // and necessary to run after unmount.
      // A null result means the save never reached the cloud (e.g. the session
      // expired -> 401). Keep it dirty and show an error so it retries; never
      // report "synced" or clear the dirty flag, which would risk a later pull
      // overwriting work that was never actually saved.
      if (!ts) {
        setStatus("error");
        return;
      }
      o.setLastSavedAt(ts);
      // The cloud now holds exactly what was sent, whatever was typed since.
      recordBaseline(doc, tp);
      const docUnchanged = stillMatchesSnapshot(ed.getJSON(), snapshotJson);
      const tpUnchanged = stillMatchesSnapshot(titlePageRef.current, tpSnapshot);
      const localDocUnchanged = stillMatchesSnapshot(
        loadProjectDoc(o.projectId),
        snapshotJson
      );
      const localTpUnchanged = stillMatchesSnapshot(
        o.loadLocalTitlePage(),
        tpSnapshot
      );
      // The title page we just pushed is now current on the cloud, so clear its
      // dirty flag if it did not change mid-flight.
      if (tpWasDirty && tpUnchanged && localTpUnchanged) {
        o.setTitlePageDirty(false);
        ownTitlePageDirtyRef.current = false;
      }
      // Only mark the doc clean if neither doc nor title page changed in-flight.
      if (docUnchanged && tpUnchanged && localDocUnchanged && localTpUnchanged) {
        o.setDirty(false);
        ownDirtyRef.current = false;
      }
      const now = Date.now();
      if (now - lastSnapshotAt.current > SNAPSHOT_THROTTLE_MS) {
        lastSnapshotAt.current = now;
        createSnapshot(o.projectId, u.id, doc, tp).catch((e) =>
          console.error("snapshot failed", e)
        );
      }
      // A local title change (rename / plain-doc auto-name) rides its own path.
      await flushTitle();
      // Safe to skip after unmount: this only paints the indicator. Persisted
      // bookkeeping above must NOT be skipped this way (see the note there).
      if (!mountedRef.current) return;
      setStatus(
        docUnchanged &&
          tpUnchanged &&
          localDocUnchanged &&
          localTpUnchanged &&
          !o.isTitleDirty()
          ? "synced"
          : "syncing"
      );
    } catch (e) {
      console.error("cloud save failed", e);
      setStatus("error");
    }
  }, [editor, flushTitle, cloudRowIfMoved, settleWithCloud, recordBaseline]);

  // Only one body request for this editor may be in flight. Calls arriving
  // while it runs request one more pass, whose snapshot is taken only after the
  // older response completes. This prevents an old late response from landing
  // after a newer response and silently becoming the cloud's final body.
  const pushNow = useCallback(async () => {
    if (pushInFlightRef.current) {
      pushAgainRef.current = true;
      await pushInFlightRef.current;
      return;
    }
    const run = (async () => {
      do {
        pushAgainRef.current = false;
        await pushOnce();
      } while (pushAgainRef.current && mountedRef.current);
    })();
    pushGenRef.current++;
    pushInFlightRef.current = run;
    try {
      await run;
    } finally {
      if (pushInFlightRef.current === run) pushInFlightRef.current = null;
    }
  }, [pushOnce]);

  const debouncedPush = useRef(debounce(() => void pushNow(), PUSH_DEBOUNCE_MS));
  useEffect(() => {
    debouncedPush.current = debounce(() => void pushNow(), PUSH_DEBOUNCE_MS);
  }, [pushNow]);

  // --- Resume after re-auth from an expired session -------------------------
  // Expiry keeps user non-null on purpose, so signing back in as the same
  // account changes neither user.id nor the reconcile key: without this,
  // reconciledFor would still match, the effect below would return early, and
  // sync would silently stay paused (status stuck on error, dirty doc
  // unpushed) until the next edit. setSession announces the restoration;
  // reset the key and bump a tick so the full reconcile re-runs.
  const [restoredTick, setRestoredTick] = useState(0);
  useEffect(() => {
    if (optsRef.current.disabled) {
      setStatus("local");
      return;
    }
    const onRestored = () => {
      reconciledFor.current = null;
      setRestoredTick((t) => t + 1);
    };
    window.addEventListener("less:sessionrestored", onRestored);
    return () => window.removeEventListener("less:sessionrestored", onRestored);
  }, []);

  // --- Reconcile this project once when a signed-in user + editor are ready ---
  useEffect(() => {
    if (optsRef.current.disabled) {
      setStatus("local");
      return;
    }
    if (!editor || !user) {
      if (!user) setStatus("local");
      return;
    }
    // Expired session: skip the reconcile entirely (every call would 401).
    // reconciledFor stays unset so a re-sign-in re-runs it for this project.
    if (isSessionExpired()) {
      setStatus("error");
      return;
    }
    const key = `${user.id}:${projectId}`;
    if (reconciledFor.current === key) return;
    reconciledFor.current = key;
    let cancelled = false;

    (async () => {
      const o = optsRef.current;
      if (localProjectIdFor(projectId) !== projectId) {
        setStatus("local");
        return;
      }
      setStatus("syncing");
      reconcilingRef.current = true;
      const localDoc = editor.getJSON();
      try {
        const cloud = await fetchScript(projectId);
        if (cancelled) return;
        if (cloud) {
          // The editor stayed interactive during the fetch: re-read it so any
          // typing in that window is never clobbered.
          const live = editor.getJSON();
          const typedDuringFetch =
            JSON.stringify(live) !== JSON.stringify(localDoc);
          // Who wins is decided from content against the synced baseline, not
          // from the dirty flag alone (syncBaseline.ts): a flag set by an update
          // that changed nothing used to push a stale or blank body over newer
          // work on every open. Pull, conflict, and clock-only outcomes finish
          // inside settleWithCloud; a push is carried out below as it always was.
          const decision = settleWithCloud(cloud, {
            origin: "open",
            legacyDirty: o.isDirty() || !!o.hasUnsavedLocalEdits?.() || typedDuringFetch,
          });
          if (decision === "push") {
            // Push the dirty content. For the title page, push it only when it
            // was actually edited locally (tpDirty); otherwise pass undefined so
            // a newer cloud title page is neither clobbered (audit #17) nor a
            // genuine local title-page edit silently dropped.
            const tpDirty = ownTitlePageDirtyRef.current;
            const docSnapshot = JSON.stringify(live);
            const tpSnapshot = JSON.stringify(titlePageRef.current);
            if (!stillMatchesSnapshot(loadProjectDoc(projectId), docSnapshot)) {
              o.saveLocalDoc(live);
            }
            if (localProjectIdFor(projectId) !== projectId) {
              setStatus("local");
              return;
            }
            const ts = await saveScript(
              projectId,
              live,
              tpDirty ? titlePageRef.current : undefined
            );
            if (cancelled) return;
            // Keep dirty if the save did not actually land (null = 401/offline),
            // so it retries instead of being lost.
            if (ts) {
              o.setLastSavedAt(ts);
              // The title page only went up if it was edited here; otherwise the
              // cloud kept its own.
              recordBaseline(
                live,
                tpDirty ? titlePageRef.current : trimTitlePage(cloud.title_page)
              );
              const docUnchanged = stillMatchesSnapshot(editor.getJSON(), docSnapshot);
              const tpUnchanged = stillMatchesSnapshot(titlePageRef.current, tpSnapshot);
              const localDocUnchanged = stillMatchesSnapshot(
                loadProjectDoc(projectId),
                docSnapshot
              );
              const localTpUnchanged = stillMatchesSnapshot(
                o.loadLocalTitlePage(),
                tpSnapshot
              );
              if (docUnchanged && tpUnchanged && localDocUnchanged && localTpUnchanged) {
                o.setDirty(false);
                ownDirtyRef.current = false;
              }
              if (tpDirty && tpUnchanged && localTpUnchanged) {
                o.setTitlePageDirty(false);
                ownTitlePageDirtyRef.current = false;
              }
              await flushTitle();
            } else {
              setStatus("error");
              return;
            }
          }
        } else {
          // No cloud row yet (a local-only project opened while signed in):
          // create it under the SAME id so local id == cloud id.
          const live = editor.getJSON();
          const docSnapshot = JSON.stringify(live);
          const tpSnapshot = JSON.stringify(titlePageRef.current);
          if (!stillMatchesSnapshot(loadProjectDoc(projectId), docSnapshot)) {
            o.saveLocalDoc(live);
          }
          if (localProjectIdFor(projectId) !== projectId) {
            setStatus("local");
            return;
          }
          const requestedTitle =
            (o.getTitle?.() || "").trim() || o.deriveTitle(live) || "Untitled";
          o.setCloudCreatePending?.(true);
          let row: Awaited<ReturnType<typeof createScript>>;
          try {
            row = await createScript(user.id, requestedTitle, live, {
              id: projectId,
              type: o.type,
              status: o.status,
              titlePage: titlePageRef.current,
            });
          } finally {
            // Always clear it: the request has settled by now, and this is a
            // persisted flag. Leaving it set on unmount would make
            // hasPendingCloudWork() warn about this project forever.
            o.setCloudCreatePending?.(false);
          }
          if (cancelled) return;
          if (row) {
            o.setLastSavedAt(row.updated_at);
            recordBaseline(live, titlePageRef.current);
            o.onCloudCreated?.(projectId);
            const docUnchanged = stillMatchesSnapshot(editor.getJSON(), docSnapshot);
            const tpUnchanged = stillMatchesSnapshot(titlePageRef.current, tpSnapshot);
            const localDocUnchanged = stillMatchesSnapshot(
              loadProjectDoc(projectId),
              docSnapshot
            );
            const localTpUnchanged = stillMatchesSnapshot(
              o.loadLocalTitlePage(),
              tpSnapshot
            );
            if (docUnchanged && tpUnchanged && localDocUnchanged && localTpUnchanged) {
              o.setDirty(false);
              ownDirtyRef.current = false;
            }
            if (tpUnchanged && localTpUnchanged) {
              o.setTitlePageDirty(false);
              ownTitlePageDirtyRef.current = false;
            }
            const currentTitle =
              (optsRef.current.getTitle?.() || "").trim() ||
              optsRef.current.deriveTitle(editor.getJSON()) ||
              "Untitled";
            if (stillMatchesField(currentTitle, requestedTitle)) o.setTitleDirty(false);
          } else {
            setStatus("error");
            return;
          }
        }
        setStatus(
          typeof navigator !== "undefined" && !navigator.onLine
            ? "offline"
            : o.isDirty() || o.isTitlePageDirty() || o.isTitleDirty()
              ? "syncing"
              : "synced"
        );
      } catch (e) {
        if (cancelled) return;
        console.error("reconcile failed", e);
        reconciledFor.current = null; // allow a retry
        setStatus("error");
      } finally {
        reconcilingRef.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editor, user, projectId, settleWithCloud, recordBaseline, flushTitle, restoredTick]);

  // --- Watch for a body written somewhere else while this one is open ------
  // An open document used to look at the cloud exactly once, when it mounted.
  // Anything written afterwards (another device, a tool writing to the
  // database) stayed invisible, and the next local save replaced it. A visible
  // tab now asks again the moment the writer comes back to it, and on a slow
  // timer in case it never left. The list is asked first (clocks only); a body
  // is fetched only when its clock moved.
  useEffect(() => {
    if (optsRef.current.disabled) return;
    if (!editor || !user) return;
    let stopped = false;
    const check = async () => {
      const o = optsRef.current;
      if (stopped || o.disabled || watchBusyRef.current) return;
      if (reconcilingRef.current || pushInFlightRef.current) return;
      if (typeof document !== "undefined" && document.hidden) return;
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      if (isSessionExpired()) return;
      if (localProjectIdFor(o.projectId) !== o.projectId) return;
      watchBusyRef.current = true;
      const pushGen = pushGenRef.current;
      try {
        const cloud = await cloudRowIfMoved();
        // A push that started while we were asking runs its own check, and one
        // that already finished made this row stale: skip until the next look.
        if (
          !cloud ||
          stopped ||
          !mountedRef.current ||
          pushInFlightRef.current ||
          pushGenRef.current !== pushGen
        ) {
          return;
        }
        const decision = settleWithCloud(cloud, {
          origin: "watch",
          legacyDirty:
            ownDirtyRef.current || o.isDirty() || !!o.hasUnsavedLocalEdits?.(),
        });
        if (decision === "push") void pushNow();
        else if (decision !== "noop") setStatus(o.isTitleDirty() ? "syncing" : "synced");
      } finally {
        watchBusyRef.current = false;
      }
    };
    const onReturn = () => void check();
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    const timer = window.setInterval(onReturn, REMOTE_WATCH_MS);
    return () => {
      stopped = true;
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
      window.clearInterval(timer);
    };
  }, [editor, user, projectId, cloudRowIfMoved, settleWithCloud, pushNow]);

  // --- Cross-tab: adopt a sibling tab's newer save of THIS project ---------
  // Another tab on this device just wrote a fresher body to localStorage. If we
  // have no unsaved edits of our own, load it into the editor so this tab cannot
  // later autosave a stale copy over it. If we ARE dirty, we keep our edits
  // (cloud last-write-wins reconciles later) rather than clobber them here.
  useEffect(() => {
    if (optsRef.current.disabled) return;
    if (!editor) return;
    return onBroadcast((msg) => {
      if (msg.type !== "docSaved" && msg.type !== "titlePageSaved") return;
      if (msg.id !== projectId) return;
      if (msg.type === "titlePageSaved") {
        if (ownTitlePageDirtyRef.current) return;
        const freshTitlePage = optsRef.current.loadLocalTitlePage();
        titlePageRef.current = freshTitlePage;
        setTitlePageState(freshTitlePage);
        return;
      }
      if (ownDirtyRef.current || optsRef.current.hasUnsavedLocalEdits?.()) return;
      const fresh = loadProjectDoc(projectId);
      if (!fresh) return;
      // Write straight into the editor (no re-save, so no broadcast echo); the
      // localStorage copy is already the sibling's, which is what we're adopting.
      // Only the changed stretch is replaced, so the caret and the view stay
      // put instead of jumping to the end of the script.
      replaceDocInPlace(editor, fresh);
      setPulledSaveOk(true);
      setPulledTick((t) => t + 1);
    });
  }, [editor, projectId]);

  // --- Subscribe to edits: mark dirty + schedule a background push ---------
  useEffect(() => {
    if (optsRef.current.disabled) return;
    if (!editor) return;
    const onUpdate = () => {
      if (!userRef.current) return;
      ownDirtyRef.current = true;
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
    if (optsRef.current.disabled) return;
    const onOnline = () => {
      if (ownDirtyRef.current || optsRef.current.isDirty()) void pushNow();
      else if (optsRef.current.isTitleDirty()) {
        setStatus("syncing");
        void flushTitle()
          .then(() => setStatus(optsRef.current.isTitleDirty() ? "syncing" : "synced"))
          .catch(() => setStatus("error"));
      }
    };
    const onOffline = () => setStatus("offline");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [pushNow, flushTitle]);

  // Signed out: stop syncing (the host unmounts to home, so no editor reset here).
  useEffect(() => {
    if (optsRef.current.disabled) return;
    if (!user) setStatus("local");
  }, [user]);

  /** For the history panel: cloud snapshots (when signed in) merged with the
   *  on-device ring, newest first, so a signed-out writer still has rollback. */
  const getVersions = useCallback(async (): Promise<VersionRow[]> => {
    const cloud = !optsRef.current.disabled && userRef.current
      ? await listVersions(projectId)
      : [];
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
    ownDirtyRef.current = true;
    ownTitlePageDirtyRef.current = true;
    if (!optsRef.current.disabled && userRef.current) debouncedPush.current();
  }, []);

  /** Restore a snapshot's content (and its title page) into the editor. */
  const restoreVersion = useCallback(
    (content: JSONContent, tp?: TitlePage | null) => {
      snapshotLive("Before restore");
      pullInto(content, tp);
      optsRef.current.setDirty(true);
      ownDirtyRef.current = true;
      if (tp !== undefined) optsRef.current.setTitlePageDirty(true);
      if (tp !== undefined) ownTitlePageDirtyRef.current = true;
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
      ownDirtyRef.current = true;
      if (tp !== undefined) optsRef.current.setTitlePageDirty(true);
      if (tp !== undefined) ownTitlePageDirtyRef.current = true;
      void pushNow();
    },
    [pullInto, pushNow, snapshotLive]
  );

  /** Flush any pending debounced push now (used on navigating away and before
   *  sign-out). Awaitable so a caller can ensure the final edit lands in the
   *  cloud before local cloud-backed copies are cleared. */
  const flush = useCallback(async () => {
    debouncedPush.current.cancel();
    if (optsRef.current.disabled) return;
    if (userRef.current && (ownDirtyRef.current || optsRef.current.isDirty())) {
      await pushNow();
    }
    else if (userRef.current && optsRef.current.isTitleDirty()) {
      setStatus("syncing");
      try {
        await flushTitle();
        setStatus(optsRef.current.isTitleDirty() ? "syncing" : "synced");
      } catch {
        setStatus("error");
      }
    }
  }, [pushNow, flushTitle]);

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
    if (o.disabled) return;
    if (!u || !ed || (!ownDirtyRef.current && !o.isDirty())) return;
    if (isSessionExpired()) return; // would only 401; local save already ran
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    const doc = ed.getJSON();
    const tp = titlePageRef.current;
    // Flagged dirty without a real change: the cloud already holds this body.
    const baseline = o.getSyncedPrint?.() ?? null;
    if (baseline && syncFingerprint(doc, tp) === baseline) return;
    // Measure UTF-8 bytes (the keepalive cap is on the wire body, not UTF-16
    // chars), so a multi-byte (CJK/emoji) doc is not wrongly admitted.
    const bytes = new TextEncoder().encode(
      JSON.stringify({ content: doc, title_page: tp })
    ).length;
    if (bytes < 60000) {
      // Fall back to a normal best-effort push if the keepalive send is rejected.
      void saveScript(
        o.projectId,
        doc,
        ownTitlePageDirtyRef.current ? tp : undefined,
        {
        keepalive: true,
        }
      ).catch(() => void pushNow());
    } else {
      void pushNow();
    }
  }, [editor, pushNow]);

  return {
    status,
    pulledTick,
    pulledSaveOk,
    getVersions,
    restoreVersion,
    /** Mark this moment in History under a name ("Draft 2"): on this device
     *  always, in the cloud too when signed in. */
    markVersion: snapshotLive,
    importContent,
    titlePage,
    setTitlePage,
    flush,
    flushBeacon,
  };
}
