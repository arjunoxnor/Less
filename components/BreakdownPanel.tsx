"use client";

import { memo, useMemo, useRef, useState } from "react";
import {
  BREAKDOWN_CATEGORIES,
  categoryById,
  type BreakdownItem,
  type BreakdownResult,
} from "@/lib/editor/breakdown";

/**
 * The production breakdown panel: tag elements (props, wardrobe, vehicles...),
 * see them highlighted in the script, and read the live per-scene and
 * per-category rollups. Tag from a selection in the script, or type a name.
 */
export const BreakdownPanel = memo(function BreakdownPanel({
  result,
  items,
  highlightOn,
  hasSelection,
  onAdd,
  onTagSelection,
  onRemove,
  onToggleHighlight,
  onJumpScene,
  onExport,
  onClose,
}: {
  result: BreakdownResult;
  items: BreakdownItem[];
  highlightOn: boolean;
  hasSelection: boolean;
  onAdd: (category: string, name: string) => void;
  onTagSelection: (category: string) => void;
  onRemove: (id: string) => void;
  onToggleHighlight: () => void;
  onJumpScene: (sceneNumber: number) => void;
  onExport: () => void;
  onClose: () => void;
}) {
  const [category, setCategory] = useState(BREAKDOWN_CATEGORIES[2].id); // Props
  const [name, setName] = useState("");
  const [view, setView] = useState<"category" | "scene">("category");
  const latestItems = useRef(items);
  const latestResult = useRef(result);
  latestItems.current = items;
  latestResult.current = result;
  const liveItemIds = useMemo(() => new Set(items.map((item) => item.id)), [items]);

  const add = () => {
    const t = name.trim();
    if (!t) return;
    onAdd(category, t);
    setName("");
  };

  return (
    <aside className="side-panel breakdown-panel">
      <div className="side-panel-head">
        <strong>Breakdown</strong>
        <button type="button" className="side-panel-x" onClick={onClose} title="Close">
          Close
        </button>
      </div>

      <div className="bd-add">
        <select
          className="bd-cat-select"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Category"
        >
          {BREAKDOWN_CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <input
          className="bd-name-input"
          placeholder="Element name (e.g. REVOLVER)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <div className="bd-add-row">
          <button type="button" className="tb-btn" onClick={add} disabled={!name.trim()}>
            Add
          </button>
          <button
            type="button"
            className="tb-btn"
            onClick={() => onTagSelection(category)}
            disabled={!hasSelection}
            title={hasSelection ? "Tag the selected text" : "Select text in the script first"}
          >
            Tag selection
          </button>
        </div>
        <label className="bd-highlight-toggle">
          <input type="checkbox" checked={highlightOn} onChange={onToggleHighlight} />
          Highlight tags in the script
        </label>
      </div>

      {result.itemCount === 0 ? (
        <div className="side-panel-empty">
          Nothing tagged yet. Select something in the script, pick a category, and
          tag it, or type a name above.
        </div>
      ) : (
        <>
          <div className="find-seg bd-seg">
            <button
              type="button"
              className={"seg" + (view === "category" ? " seg-active" : "")}
              onClick={() => setView("category")}
              aria-pressed={view === "category"}
            >
              By category
            </button>
            <button
              type="button"
              className={"seg" + (view === "scene" ? " seg-active" : "")}
              onClick={() => setView("scene")}
              aria-pressed={view === "scene"}
            >
              By scene
            </button>
          </div>

          <button type="button" className="tb-btn report-export" onClick={onExport}>
            Export breakdown
          </button>

          {view === "category"
            ? result.byCategory.map((g) => (
                <div key={g.category.id} className="bd-group">
                  <div className="bd-group-title">
                    <span className="bd-swatch" style={{ background: g.category.color }} />
                    {g.category.label}
                    <span className="bd-group-count">{g.items.length}</span>
                  </div>
                  <ul className="side-panel-list">
                    {g.items
                      .filter((row) => liveItemIds.has(row.item.id))
                      .map((row) => (
                      <li key={row.item.id} className="bd-item">
                        <span className="bd-item-name">{row.item.name}</span>
                        <span className="bd-item-metrics">
                          {row.total > 0
                            ? `${row.total} in ${row.scenes} ${row.scenes === 1 ? "scene" : "scenes"}`
                            : "not found"}
                        </span>
                        <button
                          type="button"
                          className="bd-item-remove"
                          onClick={() => {
                            if (
                              latestItems.current.some(
                                (item) => item.id === row.item.id
                              )
                            ) {
                              onRemove(row.item.id);
                            }
                          }}
                          title="Remove this tag"
                          aria-label={`Remove ${row.item.name}`}
                        >
                          ×
                        </button>
                      </li>
                      ))}
                  </ul>
                </div>
              ))
            : result.scenes.length === 0 ? (
                <div className="side-panel-empty">No tagged elements appear in any scene yet.</div>
              ) : (
                result.scenes.map((sc) => (
                  <div key={sc.number} className="bd-group">
                    <button
                      type="button"
                      className="bd-scene-title"
                      onClick={() => {
                        const live = latestResult.current.scenes.find(
                          (scene) =>
                            scene.number === sc.number && scene.heading === sc.heading
                        );
                        if (live) onJumpScene(live.number);
                      }}
                      title="Jump to this scene"
                    >
                      <span className="bd-scene-n">{sc.number}</span>
                      <span className="bd-scene-h">{sc.heading || "(untitled scene)"}</span>
                    </button>
                    <ul className="side-panel-list">
                      {sc.matches
                        .filter((m) => liveItemIds.has(m.item.id))
                        .map((m) => {
                        const cat = categoryById(m.item.category);
                        return (
                          <li key={m.item.id} className="bd-item">
                            <span className="bd-swatch" style={{ background: cat?.color ?? "#888" }} />
                            <span className="bd-item-name">{m.item.name}</span>
                            <span className="bd-item-metrics">
                              {cat?.label}
                              {m.count > 1 ? ` ×${m.count}` : ""}
                            </span>
                          </li>
                        );
                        })}
                    </ul>
                  </div>
                ))
              )}
        </>
      )}
    </aside>
  );
}, (previous, next) =>
  previous.result === next.result &&
  previous.items === next.items &&
  previous.highlightOn === next.highlightOn &&
  previous.hasSelection === next.hasSelection &&
  previous.onAdd === next.onAdd &&
  previous.onTagSelection === next.onTagSelection &&
  previous.onRemove === next.onRemove &&
  previous.onJumpScene === next.onJumpScene &&
  previous.onExport === next.onExport
);
