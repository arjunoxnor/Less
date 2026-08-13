"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import type { SceneEntry } from "@/types/screenplay";

/**
 * The scene navigator: every scene heading in order, click to jump. The scene
 * the caret is currently in is highlighted and scrolled into view.
 */
export const SceneNavigatorPanel = memo(function SceneNavigatorPanel({
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
  const latestScenes = useRef(scenes);
  latestScenes.current = scenes;

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
          {rows.map(({ scene, key }) => {
            const current = scene.number === currentSceneNumber;
            return (
              <li key={key} ref={current ? currentRef : undefined}>
                <button
                  type="button"
                  className={"scene-item" + (current ? " scene-item-current" : "")}
                  title={scene.heading}
                  onClick={() => jump(scene)}
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
}, (previous, next) =>
  previous.scenes === next.scenes &&
  previous.currentSceneNumber === next.currentSceneNumber &&
  previous.onJump === next.onJump
);
