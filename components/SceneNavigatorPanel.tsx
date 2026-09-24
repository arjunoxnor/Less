"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { SceneEntry } from "@/types/screenplay";
import { beginPointerDrag, listSlotAt } from "@/lib/ui/pointerDrag";

/**
 * The scene navigator: every scene heading in order. Click to jump; drag a
 * scene (or Alt+Arrow on a focused one) to move the whole scene. While a scene
 * is carried the list scrolls by itself near its top and bottom edges, so a
 * scene can travel from the end of the script to the start in one gesture.
 */
export const SceneNavigatorPanel = memo(function SceneNavigatorPanel({
  scenes,
  currentSceneNumber,
  onJump,
  onMove,
  onClose,
}: {
  scenes: SceneEntry[];
  currentSceneNumber: number | null;
  onJump: (pos: number) => void;
  /** Move scene `from` (0-based) to land before the scene now at `slot`. */
  onMove?: (from: number, slot: number) => void;
  onClose: () => void;
}) {
  const currentRef = useRef<HTMLLIElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const rowEls = useRef<(HTMLLIElement | null)[]>([]);
  const latestScenes = useRef(scenes);
  latestScenes.current = scenes;
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [marker, setMarker] = useState<number | null>(null);
  const slotRef = useRef<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  // After a keyboard move, focus follows the scene to its new row.
  const focusAfterMove = useRef<number | null>(null);

  // A scene's number and position both move when an earlier scene is inserted.
  // Heading + occurrence gives React a steadier key, so a focused row is not
  // needlessly replaced by routine edits above it.
  const rows = useMemo(() => {
    const seen = new Map<string, number>();
    return scenes.map((scene) => {
      const occurrence = seen.get(scene.heading) ?? 0;
      seen.set(scene.heading, occurrence + 1);
      return { scene, key: `${scene.heading}\u0000${occurrence}` };
    });
  }, [scenes]);

  const jump = (snapshot: SceneEntry) => {
    // Resolve through the newest props. Requiring the old number and heading
    // means a detached row cannot silently become a different renumbered scene.
    const live = latestScenes.current.find(
      (scene) =>
        scene.number === snapshot.number && scene.heading === snapshot.heading
    );
    if (live) onJump(live.pos);
  };

  useEffect(() => {
    if (dragFrom === null) currentRef.current?.scrollIntoView({ block: "nearest" });
    // Only when the caret moves to another scene, not after a drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSceneNumber]);

  useEffect(() => {
    const index = focusAfterMove.current;
    if (index === null) return;
    focusAfterMove.current = null;
    rowEls.current[index]?.querySelector("button")?.focus();
  }, [scenes]);

  const move = (from: number, slot: number, byKeyboard = false) => {
    if (!onMove || slot === from || slot === from + 1) return;
    const to = slot > from ? slot - 1 : slot;
    if (byKeyboard) focusAfterMove.current = to;
    onMove(from, slot);
    setAnnouncement(`Scene ${from + 1} moved to position ${to + 1}.`);
  };

  const startDrag = (event: React.PointerEvent, index: number) => {
    const source = rowEls.current[index];
    if (!onMove || !source) return;
    beginPointerDrag(event.nativeEvent, {
      source,
      scroller: listRef.current,
      ghost: (el) => {
        const copy = el.cloneNode(true) as HTMLElement;
        copy.classList.add("scene-ghost");
        return copy;
      },
      onStart: () => setDragFrom(index),
      onMove: ({ y }) => {
        const els = rowEls.current.filter(Boolean) as HTMLElement[];
        const slot = listSlotAt(els, y);
        const noop = slot === index || slot === index + 1;
        slotRef.current = noop ? null : slot;
        setMarker(noop ? null : slot);
      },
      onDrop: () => {
        const slot = slotRef.current;
        slotRef.current = null;
        setDragFrom(null);
        setMarker(null);
        if (slot !== null) move(index, slot);
      },
      onCancel: () => {
        slotRef.current = null;
        setDragFrom(null);
        setMarker(null);
      },
    });
  };

  return (
    <aside className="side-panel scene-panel">
      <div className="side-panel-head">
        <strong>Scenes</strong>
        <button type="button" className="side-panel-x" onClick={onClose} title="Close">
          Close
        </button>
      </div>

      {scenes.length === 0 ? (
        <div className="side-panel-empty">
          No scenes yet. Add a scene heading to see it here.
        </div>
      ) : (
        <ul
          ref={listRef}
          className={"side-panel-list" + (dragFrom !== null ? " is-sorting" : "")}
        >
          {rows.map(({ scene, key }, index) => {
            const current = scene.number === currentSceneNumber;
            return (
              <li
                key={key}
                ref={(el) => {
                  rowEls.current[index] = el;
                  if (current) currentRef.current = el;
                }}
                className={
                  (dragFrom === index ? "is-lifted" : "") +
                  (marker === index ? " drop-before" : "") +
                  (marker === rows.length && index === rows.length - 1 ? " drop-after" : "")
                }
              >
                <button
                  type="button"
                  className={"scene-item" + (current ? " scene-item-current" : "")}
                  title={scene.heading}
                  onClick={() => jump(scene)}
                  onPointerDown={(e) => startDrag(e, index)}
                  onKeyDown={(e) => {
                    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
                    e.preventDefault();
                    if (e.key === "ArrowUp" && index > 0) move(index, index - 1, true);
                    if (e.key === "ArrowDown" && index < rows.length - 1) move(index, index + 2, true);
                  }}
                  aria-keyshortcuts={onMove ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
                >
                  <span
                    className="scene-story"
                    style={scene.color ? { background: scene.color } : undefined}
                    title={scene.storyline || undefined}
                    aria-hidden="true"
                  />
                  <span className="scene-num">{scene.number}.</span>
                  <span className="scene-text">
                    {scene.heading || "(untitled scene)"}
                  </span>
                  {scene.page != null && (
                    <span className="scene-page">p. {scene.page}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
    </aside>
  );
}, (previous, next) =>
  previous.scenes === next.scenes &&
  previous.currentSceneNumber === next.currentSceneNumber &&
  previous.onJump === next.onJump &&
  previous.onMove === next.onMove
);
