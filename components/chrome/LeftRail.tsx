"use client";

import { Tooltip } from "../ui/Tooltip";
import {
  BreakdownIcon,
  CastIcon,
  DocsIcon,
  FindIcon,
  FocusIcon,
  HistoryIcon,
  NotesIcon,
  ReportsIcon,
  ScenesIcon,
} from "./icons";

/**
 * The 44px icon-only right rail (Superaudit 2, 2B.2). One button per dock
 * panel, 32px hit targets, tooltips naming each with its shortcut where one
 * exists. A click sets or clears the single active panel. The Focus button
 * sits last, after the divider group.
 */

export type PanelId =
  | "scenes"
  | "docs"
  | "cast"
  | "notes"
  | "breakdown"
  | "reports"
  | "history"
  | "find";

export type RailItem =
  | { kind: "panel"; id: PanelId; label: string; shortcut?: string }
  | { kind: "divider" };

const GLYPHS: Record<PanelId, () => React.ReactNode> = {
  scenes: ScenesIcon,
  docs: DocsIcon,
  cast: CastIcon,
  notes: NotesIcon,
  breakdown: BreakdownIcon,
  reports: ReportsIcon,
  history: HistoryIcon,
  find: FindIcon,
};

export function LeftRail({
  items,
  activePanel,
  onPanelChange,
  onEnterFocus,
}: {
  items: RailItem[];
  activePanel: PanelId | null;
  onPanelChange: (panel: PanelId | null) => void;
  onEnterFocus: () => void;
}) {
  return (
    <nav className="editor-rail" aria-label="Panels">
      {items.map((it, i) => {
        if (it.kind === "divider") {
          return <div key={"d" + i} className="rail-divider" aria-hidden="true" />;
        }
        const Glyph = GLYPHS[it.id];
        const active = activePanel === it.id;
        return (
          <Tooltip
            key={it.id}
            label={it.shortcut ? `${it.label} (${it.shortcut})` : it.label}
          >
            <button
              type="button"
              className={"rail-btn" + (active ? " rail-btn-active" : "")}
              aria-pressed={active}
              aria-label={it.label}
              onClick={() => onPanelChange(active ? null : it.id)}
            >
              <Glyph />
            </button>
          </Tooltip>
        );
      })}
      <Tooltip label="Focus (Esc to leave)">
        <button
          type="button"
          className="rail-btn"
          aria-label="Focus"
          onClick={onEnterFocus}
        >
          <FocusIcon />
        </button>
      </Tooltip>
    </nav>
  );
}
