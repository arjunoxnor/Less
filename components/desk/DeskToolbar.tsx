"use client";

import type { DocKind } from "@/lib/cover/kinds";
import { KIND_COLOR } from "@/lib/cover/palette";
import { Cover } from "./Cover";

/** What the toolbar can make: any kind of document, or a folder. */
export type DeskTool = DocKind | "folder";

export const DESK_TOOLS: { tool: DeskTool; label: string; hint: string }[] = [
  { tool: "script", label: "Script", hint: "A new script" },
  { tool: "onepager", label: "One-pager", hint: "A new one-pager" },
  { tool: "treatment", label: "Treatment", hint: "A new treatment" },
  { tool: "outline", label: "Outline", hint: "A new outline" },
  { tool: "characters", label: "Characters", hint: "A new characters doc" },
  { tool: "notes", label: "Note", hint: "A sticky note" },
  { tool: "board", label: "Board", hint: "A board for pictures" },
  { tool: "folder", label: "Folder", hint: "A folder on this desk" },
];

function ToolGlyph({ tool }: { tool: DeskTool }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (tool) {
    case "script":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path {...p} d="M7 3h7l4 4v14H7z" />
          <path {...p} d="M14 3v4h4M10 12h5M10 15.5h5" />
        </svg>
      );
    case "onepager":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect {...p} x="5" y="3" width="14" height="18" rx="2" />
          <circle cx="12" cy="10" r="3.4" fill="currentColor" />
          <path {...p} d="M8.5 17h7" />
        </svg>
      );
    case "treatment":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path {...p} d="M5 4h14v16H5z" />
          <path {...p} d="M8 8h8M12 8v8" />
        </svg>
      );
    case "outline":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect {...p} x="4" y="4" width="7" height="6" rx="1.2" />
          <rect {...p} x="13" y="4" width="7" height="6" rx="1.2" />
          <rect {...p} x="4" y="14" width="7" height="6" rx="1.2" />
          <rect {...p} x="13" y="14" width="7" height="6" rx="1.2" />
        </svg>
      );
    case "characters":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle {...p} cx="9" cy="9" r="3.2" />
          <circle {...p} cx="16.5" cy="10.5" r="2.6" />
          <path {...p} d="M3.5 19c.8-3 3-4.6 5.5-4.6s4.7 1.6 5.5 4.6M14.5 15.2c2.6-.4 4.8 1 5.6 3.8" />
        </svg>
      );
    case "notes":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path {...p} d="M5 4h14v11l-5 5H5z" />
          <path {...p} d="M14 20v-5h5M8 9h8M8 12.5h5" />
        </svg>
      );
    case "board":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect {...p} x="4" y="4" width="16" height="16" rx="2" />
          <circle cx="9" cy="9.5" r="1.8" fill="currentColor" />
          <path {...p} d="M4.5 17l5-5 4 4 2.5-2.5 3.5 3.5" />
        </svg>
      );
    case "folder":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path {...p} d="M3.5 7.5V18a1.5 1.5 0 0 0 1.5 1.5h14a1.5 1.5 0 0 0 1.5-1.5V9.5A1.5 1.5 0 0 0 19 8h-7l-2-2.5H5A1.5 1.5 0 0 0 3.5 7z" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path {...p} d="M7 3h10v18H7z" />
        </svg>
      );
  }
}

/**
 * The desk's toolbar, down its left side like Milanote's: click a tool to put
 * a new one on the desk, or drag it out and let go exactly where it should go
 * (or onto a folder, to make it inside). Each tool carries a little preview of
 * what it makes, which is what travels under the pointer.
 */
export function DeskToolbar({
  canFolder,
  onPick,
  onPointerDown,
}: {
  /** Folders can be made here (a desk inside a project). */
  canFolder: boolean;
  onPick: (tool: DeskTool) => void;
  onPointerDown: (e: React.PointerEvent, el: HTMLElement, tool: DeskTool) => void;
}) {
  return (
    <nav className="dk-tools" aria-label="Add to this desk">
      {DESK_TOOLS.filter((t) => canFolder || t.tool !== "folder").map((t) => (
        <div
          key={t.tool}
          className="dk-tool"
          role="button"
          tabIndex={0}
          title={`${t.hint}. Click, or drag it onto the desk.`}
          style={{ ["--kc" as string]: t.tool === "folder" ? "#8a8a93" : KIND_COLOR[t.tool] } as React.CSSProperties}
          onClick={() => onPick(t.tool)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onPick(t.tool);
            }
          }}
          onPointerDown={(e) => onPointerDown(e, e.currentTarget, t.tool)}
        >
          <span className="dk-tool-icon">
            <ToolGlyph tool={t.tool} />
          </span>
          <span className="dk-tool-label">{t.label}</span>
          <span className="dk-tool-preview" aria-hidden="true">
            {t.tool === "folder" ? (
              <span className="dk-tool-folder" />
            ) : (
              <Cover id={`new-${t.tool}`} title={t.label} kind={t.tool} mini />
            )}
          </span>
        </div>
      ))}
    </nav>
  );
}
