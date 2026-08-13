"use client";

import { useEffect, useState } from "react";

let storageFullSeen = false;
const storageFullSubscribers = new Set<() => void>();

// Install as soon as the client module loads, before descendant components can
// perform migration or startup writes. A useEffect-only listener can miss a
// quota failure fired during that first render.
if (typeof window !== "undefined") {
  window.addEventListener("less:storagefull", () => {
    storageFullSeen = true;
    for (const subscriber of storageFullSubscribers) subscriber();
  });
}

/**
 * A quiet, persistent notice shown when the browser's local storage is full or
 * blocked. Some writes (folder arrangement, sync bookkeeping) cannot thread a
 * failure back to the UI, so the storage layer broadcasts a `less:storagefull`
 * event and this banner makes the condition visible instead of letting saves
 * fail silently. It stays until the page is reloaded (the condition is sticky).
 */
export function StorageBanner() {
  // Keep the server and first client render identical; the effect immediately
  // consumes the early sticky signal after hydration.
  const [full, setFull] = useState(false);

  useEffect(() => {
    const onFull = () => setFull(true);
    storageFullSubscribers.add(onFull);
    if (storageFullSeen) onFull();
    return () => {
      storageFullSubscribers.delete(onFull);
    };
  }, []);

  if (!full) return null;

  return (
    <div className="storage-banner" role="alert">
      This device is out of local storage, so some changes may not be saving.
      Export anything important, then free up space or sign in to sync.
    </div>
  );
}
