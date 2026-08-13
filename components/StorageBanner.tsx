"use client";

import { useEffect, useState } from "react";

/**
 * A quiet, persistent notice shown when the browser's local storage is full or
 * blocked. Some writes (folder arrangement, sync bookkeeping) cannot thread a
 * failure back to the UI, so the storage layer broadcasts a `less:storagefull`
 * event and this banner makes the condition visible instead of letting saves
 * fail silently. It stays until the page is reloaded (the condition is sticky).
 */
export function StorageBanner() {
  const [full, setFull] = useState(false);

  useEffect(() => {
    const onFull = () => setFull(true);
    window.addEventListener("less:storagefull", onFull);
    return () => window.removeEventListener("less:storagefull", onFull);
  }, []);

  if (!full) return null;

  return (
    <div className="storage-banner" role="alert">
      This device is out of local storage, so some changes may not be saving.
      Export anything important, then free up space or sign in to sync.
    </div>
  );
}
