"use client";

import { useEffect, useState } from "react";

/**
 * Whether a "working on it" state has lasted long enough to be worth showing.
 *
 * Saving happens a moment after every pause in typing, so a status word that
 * follows it exactly flips between "Saving" and "Saved" every couple of
 * seconds while the writer works: constant motion in the corner of the eye
 * that tells them nothing. The pending state only shows once it has lasted
 * `delayMs` without settling; a save that finishes in time is never
 * announced, and one that is really stuck (offline, storage full) still is.
 */
export function useCalmPending(pending: boolean, delayMs = 2500): boolean {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!pending) {
      setShow(false);
      return;
    }
    const timer = setTimeout(() => setShow(true), delayMs);
    return () => clearTimeout(timer);
  }, [pending, delayMs]);
  return pending && show;
}
