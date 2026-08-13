"use client";

import { useEffect, useRef } from "react";
import type { SceneEntry } from "@/types/screenplay";

/**
 * The scene navigator: every scene heading in order, click to jump. The scene
 * the caret is currently in is highlighted and scrolled into view.
 */
export function SceneNavigatorPanel({
  scenes,
  currentSceneNumber,
  onJump,
  onClose,
}: {
  scenes: SceneEntry[];
  currentSceneNumber: number | null;
  onJump: (pos: number) => void;
  onClose: () => void;
}) {
  const currentRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "nearest" });
  }, [currentSceneNumber]);

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
        <ul className="side-panel-list">
          {scenes.map((scene) => {
            const current = scene.number === currentSceneNumber;
            return (
              <li key={scene.number} ref={current ? currentRef : undefined}>
                <button
                  type="button"
                  className={"scene-item" + (current ? " scene-item-current" : "")}
                  title={scene.heading}
                  onClick={() => onJump(scene.pos)}
                >
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
    </aside>
  );
}
