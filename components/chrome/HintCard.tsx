"use client";

import { useEffect, useState } from "react";
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

  useEffect(() => {
    if (!visible) return;
    let count = 0;
    const dismiss = () => {
      lsSet(HINTS_KEY, "dismissed");
      setFading(true);
      setTimeout(() => setVisible(false), 250);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key.length === 1 || e.key === "Enter" || e.key === "Backspace" || e.key === "Tab") {
        count++;
        if (count >= AUTO_DISMISS_KEYSTROKES) dismiss();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible]);

  if (!visible) return null;

  const close = () => {
    lsSet(HINTS_KEY, "dismissed");
    setVisible(false);
  };

  return (
    <div className={"hint-card" + (fading ? " hint-card-fading" : "")} role="note">
      <button
        type="button"
        className="hint-card-x"
        onClick={close}
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
