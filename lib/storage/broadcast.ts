/**
 * Cross-tab coordination. localStorage is shared across a browser's tabs, but
 * each tab holds its own in-memory editor and project list, so without a signal
 * a second tab can autosave a stale copy over a fresh one on the SAME device.
 * A BroadcastChannel lets a tab announce "I just saved project X" or "the
 * project list changed" so siblings can refresh or adopt the newer copy.
 *
 * Messages are NOT delivered to the tab that posted them (per the spec), so a
 * tab never reacts to its own writes. Degrades to a no-op where BroadcastChannel
 * is unavailable.
 */

export type BroadcastMessage =
  | { type: "docSaved"; id: string }
  | { type: "indexChanged" }
  | { type: "foldersChanged" };

const CHANNEL = "less:sync";
let channel: BroadcastChannel | null = null;

function chan(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  if (!channel) {
    try {
      channel = new BroadcastChannel(CHANNEL);
    } catch {
      channel = null;
    }
  }
  return channel;
}

/** Announce something to sibling tabs. Never throws. */
export function broadcast(msg: BroadcastMessage): void {
  try {
    chan()?.postMessage(msg);
  } catch {
    /* ignore */
  }
}

/** Subscribe to sibling-tab messages. Returns an unsubscribe function. */
export function onBroadcast(handler: (msg: BroadcastMessage) => void): () => void {
  const c = chan();
  if (!c) return () => {};
  const listener = (e: MessageEvent) => handler(e.data as BroadcastMessage);
  c.addEventListener("message", listener);
  return () => c.removeEventListener("message", listener);
}
