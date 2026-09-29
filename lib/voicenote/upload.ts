import { API_TIMEOUT_MS, getToken } from "../cloud/client";
import { activeRecordings, isRecordingElsewhere } from "./recorder";
import {
  forgetRecording,
  interruptedRecordings,
  keepRecording,
  waitingRecordings,
} from "./localAudio";

/**
 * Getting recordings to the server.
 *
 * A finished recording waits on the device (localAudio.ts) and is sent with a
 * PUT to /api/assets/<its id>, the id the note in the document already names.
 * A send that fails for a passing reason (no signal, a timeout, a busy server)
 * is retried when the connection comes back, when the tab comes back into
 * view, and every few minutes. A refusal that will not pass by itself (not
 * signed in with Google, storage full) is shown on the note instead, and the
 * recording stays on the device until it can go.
 */

export type UploadStatus =
  | { state: "waiting"; reason?: string }
  | { state: "uploading" }
  | { state: "done" };

const statuses = new Map<string, UploadStatus>();
const listeners = new Set<() => void>();

function set(id: string, status: UploadStatus) {
  statuses.set(id, status);
  listeners.forEach((fn) => fn());
}

/** What this device knows about a recording's upload. Null: nothing here. */
export function uploadStatusOf(id: string): UploadStatus | null {
  return statuses.get(id) ?? null;
}

export function subscribeUploads(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Refusals worth a sentence on the note. Anything else is simply retried. */
function refusalFor(status: number, serverMessage: string | null): string | null {
  if (status === 403) return "Sign in with Google to have it transcribed.";
  if (status === 413) return "Too long to store. It stays on this device.";
  if (status === 415) return "This browser recorded in a format that cannot be stored.";
  if (status === 507) return "Storage is full. It stays on this device.";
  if (status === 409) return serverMessage ?? "Could not be stored.";
  return null;
}

/** Send one recording. True once the server has it. */
export async function uploadRecording(id: string, blob: Blob): Promise<boolean> {
  const token = getToken();
  if (!token) {
    set(id, { state: "waiting", reason: "Sign in to have it transcribed." });
    return false;
  }
  set(id, { state: "uploading" });
  const controller = new AbortController();
  // A long note on a slow connection: allow for about 25 KB a second.
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(API_TIMEOUT_MS * 3, (blob.size / 25_000) * 1000)
  );
  let res: Response;
  try {
    res = await fetch(`/api/assets/${id}`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": blob.type || "application/octet-stream",
      },
      body: blob,
      signal: controller.signal,
    });
  } catch {
    set(id, { state: "waiting" });
    return false;
  } finally {
    clearTimeout(timeout);
  }
  if (res.ok) {
    await forgetRecording(id);
    set(id, { state: "done" });
    return true;
  }
  let message: string | null = null;
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error) message = body.error + ".";
  } catch {
    /* keep the generic sentence */
  }
  const reason = res.status === 401 ? "Sign in again to have it transcribed." : refusalFor(res.status, message);
  set(id, { state: "waiting", ...(reason ? { reason } : {}) });
  return false;
}

/**
 * Pieces older than this with nobody holding them are an interrupted recording.
 * Only used where the browser cannot say whether another tab is still recording
 * (no Web Locks), so it is long: a paused note in another tab must not be cut.
 */
const ORPHAN_AGE_MS = 12 * 60 * 60 * 1000;

let running: Promise<void> | null = null;

/** Send everything waiting on this device. Safe to call at any time. */
export function flushUploads(): Promise<void> {
  if (running) return running;
  running = (async () => {
    try {
      // A tab that closed mid-note left its pieces behind: make them a recording.
      for (const cut of await interruptedRecordings(activeRecordings)) {
        const live = await isRecordingElsewhere(cut.id);
        if (live === true) continue;
        if (live === null && Date.now() - cut.lastAt < ORPHAN_AGE_MS) continue;
        await keepRecording({
          id: cut.id,
          blob: cut.blob,
          mime: cut.mime,
          durationMs: cut.durationMs,
          createdAt: new Date(cut.lastAt).toISOString(),
        });
      }
      for (const rec of await waitingRecordings()) {
        if (activeRecordings.has(rec.id)) continue;
        if (statuses.get(rec.id)?.state === "uploading") continue;
        await uploadRecording(rec.id, rec.blob);
      }
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Keep trying in the background for as long as the app is open. */
export function startUploadLoop(): () => void {
  if (typeof window === "undefined") return () => {};
  const kick = () => void flushUploads();
  const onVisible = () => {
    if (document.visibilityState === "visible") kick();
  };
  kick();
  window.addEventListener("online", kick);
  window.addEventListener("less:sessionrestored", kick);
  document.addEventListener("visibilitychange", onVisible);
  const timer = setInterval(kick, 5 * 60 * 1000);
  return () => {
    window.removeEventListener("online", kick);
    window.removeEventListener("less:sessionrestored", kick);
    document.removeEventListener("visibilitychange", onVisible);
    clearInterval(timer);
  };
}
