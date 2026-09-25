"use client";

import type { Section } from "@/lib/storage/library";
import type { ProjectMeta } from "@/lib/storage/projects";
import { DotsIcon } from "../chrome/icons";
import { ChevronDown, ClockGlyph, NameInput, PlusGlyph, TrayGlyph } from "./homeParts";
import type { HomeDragSource } from "./useHomeDrag";

export type HomeView =
  | { kind: "recent" }
  | { kind: "stage"; id: string }
  | { kind: "project"; id: string }
  | { kind: "unfiled" };

/**
 * The library down the left: Recent, then each top-level folder (a stage, like
 * InProgress) with the projects inside it, then anything not in a folder.
 * Every project row is also where a carried script can be dropped.
 */
export function HomeSidebar({
  sideRef,
  open,
  sections,
  unfiled,
  view,
  onSelect,
  isStageOpen,
  onToggleStage,
  renamingFolder,
  onRenameFolder,
  onRenameDone,
  dragSource,
  dropKey,
  onStartDrag,
  onNewProject,
  onStageMenu,
  stageMenuFor,
  onNewFolder,
}: {
  sideRef: React.RefObject<HTMLElement | null>;
  /** On a narrow window the sidebar is a drawer; this is its state. */
  open: boolean;
  sections: Section[];
  unfiled: ProjectMeta[];
  view: HomeView;
  onSelect: (view: HomeView) => void;
  isStageOpen: (id: string) => boolean;
  onToggleStage: (id: string) => void;
  renamingFolder: string | null;
  onRenameFolder: (id: string, name: string) => void;
  onRenameDone: () => void;
  dragSource: HomeDragSource | null;
  dropKey: string | null;
  onStartDrag: (e: React.PointerEvent, source: HomeDragSource, el: HTMLElement) => void;
  onNewProject: (stageId: string) => void;
  onStageMenu: (stageId: string, anchor: DOMRect) => void;
  stageMenuFor: string | null;
  onNewFolder: () => void;
}) {
  const carryingItem = dragSource?.kind === "item";
  return (
    <nav
      ref={sideRef}
      className={"lib-side" + (open ? " is-open" : "")}
      aria-label="Library"
      data-stages=""
    >
      <button
        type="button"
        className={"lib-nav lib-nav-recent" + (view.kind === "recent" ? " is-on" : "")}
        onClick={() => onSelect({ kind: "recent" })}
      >
        <span className="lib-nav-icon" aria-hidden="true">
          <ClockGlyph />
        </span>
        <span className="lib-nav-name">Recent</span>
      </button>

      {sections.map((section) => {
        const stage = section.folder;
        const stageOpen = isStageOpen(stage.id);
        const held = section.cards.reduce((n, c) => n + c.total, 0) + section.loose.length;
        return (
          <div
            key={stage.id}
            className={
              "lib-stage" + (dragSource?.kind === "stage" && dragSource.id === stage.id ? " is-lifted" : "")
            }
            data-stage={stage.id}
          >
            <div
              className={
                "lib-stage-head" +
                (view.kind === "stage" && view.id === stage.id ? " is-on" : "") +
                (dropKey === stage.id ? " is-drop" : "")
              }
              data-stage-head={stage.id}
              data-drop-into={stage.id}
              data-spring={stageOpen ? undefined : stage.id}
              onPointerDown={(e) => onStartDrag(e, { kind: "stage", id: stage.id }, e.currentTarget)}
            >
              <button
                type="button"
                className={"lib-caret" + (stageOpen ? " is-open" : "")}
                aria-expanded={stageOpen}
                aria-label={stageOpen ? `Fold ${stage.name} away` : `Open ${stage.name}`}
                onClick={() => onToggleStage(stage.id)}
              >
                <ChevronDown />
              </button>
              {renamingFolder === stage.id ? (
                <NameInput
                  initial={stage.name}
                  className="lib-rename"
                  ariaLabel="Folder name"
                  onCommit={(name) => {
                    if (name) onRenameFolder(stage.id, name);
                  }}
                  onDone={onRenameDone}
                />
              ) : (
                <button
                  type="button"
                  className="lib-stage-name"
                  title={stage.name}
                  onClick={() => onSelect({ kind: "stage", id: stage.id })}
                >
                  {stage.name}
                </button>
              )}
              {!stageOpen && held > 0 && <span className="lib-count">{held}</span>}
              <button
                type="button"
                className="lib-icon-btn lib-stage-add"
                aria-label={`New project in ${stage.name}`}
                title={`New project in ${stage.name}`}
                onClick={() => onNewProject(stage.id)}
              >
                <PlusGlyph />
              </button>
              <button
                type="button"
                className="lib-icon-btn lib-kebab"
                aria-label={`Actions for ${stage.name}`}
                aria-haspopup="menu"
                aria-expanded={stageMenuFor === stage.id}
                onClick={(e) => onStageMenu(stage.id, e.currentTarget.getBoundingClientRect())}
              >
                <DotsIcon />
              </button>
            </div>

            {stageOpen && (
              <div className="lib-projects" data-projects={stage.id}>
                {section.cards.map((card) => {
                  const f = card.folder;
                  const on = view.kind === "project" && view.id === f.id;
                  return (
                    <div
                      key={f.id}
                      className={
                        "lib-nav lib-project" +
                        (on ? " is-on" : "") +
                        (dropKey === f.id ? " is-drop" : "") +
                        (dragSource?.kind === "project" && dragSource.id === f.id ? " is-lifted" : "")
                      }
                      data-project-row={f.id}
                      data-drop-into={f.id}
                      role="button"
                      tabIndex={0}
                      aria-current={on ? "page" : undefined}
                      onClick={() => onSelect({ kind: "project", id: f.id })}
                      onKeyDown={(e) => {
                        if (e.target !== e.currentTarget) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelect({ kind: "project", id: f.id });
                        }
                      }}
                      onPointerDown={(e) => onStartDrag(e, { kind: "project", id: f.id }, e.currentTarget)}
                    >
                      <span className="lib-dot" style={{ background: f.color }} aria-hidden="true" />
                      {renamingFolder === f.id ? (
                        <NameInput
                          initial={f.name}
                          className="lib-rename"
                          ariaLabel="Project name"
                          onCommit={(name) => {
                            if (name) onRenameFolder(f.id, name);
                          }}
                          onDone={onRenameDone}
                        />
                      ) : (
                        <span className="lib-nav-name" title={f.name}>
                          {f.name}
                        </span>
                      )}
                      {card.total > 0 && <span className="lib-count">{card.total}</span>}
                    </div>
                  );
                })}
                {section.cards.length === 0 && section.loose.length === 0 && (
                  <div className="lib-side-empty">Empty</div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {(unfiled.length > 0 || carryingItem) && (
        <div
          className={
            "lib-nav lib-nav-unfiled" +
            (view.kind === "unfiled" ? " is-on" : "") +
            (dropKey === "none" ? " is-drop" : "")
          }
          data-drop-into="none"
          role="button"
          tabIndex={0}
          onClick={() => onSelect({ kind: "unfiled" })}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect({ kind: "unfiled" });
            }
          }}
        >
          <span className="lib-nav-icon" aria-hidden="true">
            <TrayGlyph />
          </span>
          <span className="lib-nav-name">Not in a folder</span>
          {unfiled.length > 0 && <span className="lib-count">{unfiled.length}</span>}
        </div>
      )}

      <button type="button" className="lib-nav lib-nav-new" onClick={onNewFolder}>
        <span className="lib-nav-icon" aria-hidden="true">
          <PlusGlyph />
        </span>
        <span className="lib-nav-name">New folder</span>
      </button>
    </nav>
  );
}
