"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { lsGet, lsSet } from "@/lib/storage/localStore";

/**
 * The first-open hint card (Superaudit 2, 2D.2): a small floating paper card,
 * bottom-left, with the three things a new writer needs. Dismissed by its
 * close button or automatically after the first 50 keystrokes; either way the
 * dismissal persists under less:hints:v1 so it shows exactly once.
 */

const HINTS_KEY = "less:hints:v1";
const AUTO_DISMISS_KEYSTROKES = 50;

export function HintCard({ modLabel }: { modLabel: string }) {
  const [visible, setVisible] = useState(() => lsGet(HINTS_KEY) !== "dismissed");
  const [fading, setFading] = useState(false);
  const dismissing = useRef(false);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback((immediate = false) => {
    lsSet(HINTS_KEY, "dismissed");
    if (immediate) {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
      setVisible(false);
      return;
    }
    if (dismissing.current) return;
    dismissing.current = true;
    setFading(true);
    dismissTimer.current = setTimeout(() => {
      dismissTimer.current = null;
      setVisible(false);
    }, 250);
  }, []);

  useEffect(() => {
    if (!visible) return;
    let count = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.length === 1 || e.key === "Enter" || e.key === "Backspace" || e.key === "Tab") {
        count++;
        if (count >= AUTO_DISMISS_KEYSTROKES) dismiss();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    };
  }, [dismiss, visible]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === HINTS_KEY && event.newValue === "dismissed") {
        dismiss(true);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [dismiss]);

  if (!visible) return null;

  return (
    <div className={"hint-card" + (fading ? " hint-card-fading" : "")} role="note">
      <button
        type="button"
        className="hint-card-x"
        onClick={() => dismiss(true)}
        aria-label="Close hints"
      >
        ×
      </button>
      <p>Tab cycles the line type</p>
      <p>Enter follows the flow</p>
      <p>{modLabel}K does everything</p>
    </div>
  );
}
