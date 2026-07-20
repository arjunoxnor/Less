"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The "Exit focus (Esc)" pill for focus mode. It used to float at 50% opacity
 * forever: a fixed distraction inside the distraction-free mode. Now it acts
 * like a toast: visible for a moment on entry so the writer learns the way out,
 * then it fades away and only returns while the pointer is near the
 * bottom-right corner where it lives. Esc still exits at any time (AppShell
 * owns that key).
 */

const ENTRY_MS = 2500; // how long the pill stays after entering focus mode
const CORNER_PX = 80; // pointer distance from the bottom-right corner
const THROTTLE_MS = 100; // mousemove sampling interval

export function FocusExitPill({ onExit }: { onExit: () => void }) {
  const [visible, setVisible] = useState(true);
  // Set once the entry showing has run its course; before that, moving the
  // pointer around must not hide the pill early.
  const entryDone = useRef(false);
  const lastMove = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      entryDone.current = true;
      setVisible(false);
    }, ENTRY_MS);

    // Throttled by timestamp: mousemove fires continuously and the check is
    // only a couple of comparisons, but there is no reason to run it more than
    // ten times a second.
    const onMove = (e: MouseEvent) => {
      const now = Date.now();
      if (now - lastMove.current < THROTTLE_MS) return;
      lastMove.current = now;
      const nearCorner =
        window.innerWidth - e.clientX <= CORNER_PX &&
        window.innerHeight - e.clientY <= CORNER_PX;
      if (nearCorner) setVisible(true);
      else if (entryDone.current) setVisible(false);
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  return (
    <button
      type="button"
      className={"focus-exit" + (visible ? "" : " focus-exit-hidden")}
      onClick={onExit}
      tabIndex={visible ? 0 : -1}
    >
      Exit focus (Esc)
    </button>
  );
}
