"use client";

import { useEffect, useRef, useState } from "react";
import { beginPointerDrag, gridSlotAt, listSlotAt, type DragPoint } from "@/lib/ui/pointerDrag";
import { canStartLibraryDrag } from "@/lib/storage/libraryInteraction";

/**
 * Dragging on the home: scripts and documents into folders or to a new place
 * in a list, projects between stages in the sidebar, stages up and down.
 *
 * Targets are marked in the markup, so the page decides what it offers:
 *   data-drop-into="<folder id | none>"  drop an item here to file it there
 *   data-list="<folder id | unfiled>"    a list of rows (data-row) to place it in
 *   data-grid="<folder id | unfiled>"    a desk of covers (data-row) to place it in
 *   data-stack-onto="<document id>"      a cover: drop onto its middle to stack
 *                                        the carried document as a version of it
 *   data-tray                            a fanned-out stack (not a drop target)
 *   data-projects="<stage id>"           a stage's projects in the sidebar
 *   data-stage-head="<stage id>"         a stage heading
 *   data-stages                          the sidebar, for arranging stages
 *   data-spring="<key>"                  a closed folder that opens when held over
 *
 * Every folder in the sidebar is a big, named target, and both panes scroll
 * by themselves near their edges, so a script can travel from the bottom of
 * a long list into any project without letting go.
 */

export type HomeDragSource =
  | {
      kind: "item";
      id: string;
      /** A whole stack carried as one: every version in it, current first. */
      members?: string[];
      /** The desk group it belongs to (its stack), so it is not stacked onto itself. */
      group?: string;
      /** Picked out of a fanned-out stack. */
      fromTray?: boolean;
    }
  | { kind: "project"; id: string }
  | { kind: "stage"; id: string };

export type HomeDrop =
  | { kind: "into"; folderId: string | null }
  | { kind: "list"; container: string; slot: number }
  | { kind: "grid"; container: string; slot: number }
  | { kind: "stack"; targetId: string }
  | { kind: "projects"; stageId: string; slot: number }
  | { kind: "stages"; slot: number };

export interface DropLine {
  left: number;
  top: number;
  width: number;
  /** Set for the upright marker between covers on the desk. */
  height?: number;
}

interface Hit {
  drop: HomeDrop | null;
  line: DropLine | null;
  /** The target to light up (a folder id, "none", or a stage id). */
  key: string | null;
  spring: string | null;
}

const NOTHING: Hit = { drop: null, line: null, key: null, spring: null };
/** How long a closed folder has to be held over before it opens. */
const SPRING_MS = 650;

function childrenWith(el: HTMLElement, attr: string): HTMLElement[] {
  return Array.from(el.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && child.hasAttribute(attr)
  );
}

function lineFor(container: HTMLElement, rows: HTMLElement[], slot: number): DropLine {
  const box = container.getBoundingClientRect();
  let top: number;
  if (rows.length === 0) top = box.top + 2;
  else if (slot < rows.length) top = rows[slot].getBoundingClientRect().top;
  else top = rows[rows.length - 1].getBoundingClientRect().bottom;
  return { left: box.left + 6, top: top - 1, width: Math.max(0, box.width - 12) };
}

/** The upright marker for a slot among covers: in the gap before or after a cover. */
function gridLineFor(grid: HTMLElement, tiles: HTMLElement[], slot: number, y: number): DropLine {
  const artOf = (tile: HTMLElement) =>
    (tile.querySelector(".dk-art") ?? tile).getBoundingClientRect();
  if (tiles.length === 0) {
    const box = grid.getBoundingClientRect();
    return { left: box.left + 2, top: box.top, width: 3, height: 120 };
  }
  const prev = slot > 0 ? tiles[slot - 1] : null;
  const next = slot < tiles.length ? tiles[slot] : null;
  const prevBox = prev ? artOf(prev) : null;
  const nextBox = next ? artOf(next) : null;
  // The slot after the last cover in a row is also the slot before the first
  // cover of the next row: draw it in the row the pointer is in.
  const inPrevRow = !!prevBox && y >= prevBox.top - 20 && y <= prevBox.bottom + 60;
  if (nextBox && (!prevBox || Math.abs(prevBox.top - nextBox.top) < 4 || !inPrevRow)) {
    const gap = prevBox && Math.abs(prevBox.top - nextBox.top) < 4 ? nextBox.left - prevBox.right : 22;
    return { left: nextBox.left - gap / 2 - 1.5, top: nextBox.top, width: 3, height: nextBox.height };
  }
  const box = prevBox!;
  return { left: box.right + 11 - 1.5, top: box.top, width: 3, height: box.height };
}

/** A cover's middle: where letting go stacks, rather than places beside it. */
function inStackZone(tile: HTMLElement, x: number, y: number): boolean {
  const box = (tile.querySelector(".dk-art") ?? tile).getBoundingClientRect();
  const dx = box.width * 0.2;
  const dy = box.height * 0.12;
  return x > box.left + dx && x < box.right - dx && y > box.top + dy && y < box.bottom - dy;
}

function hitTest(source: HomeDragSource, { x, y }: DragPoint, side: HTMLElement | null): Hit {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  if (source.kind === "item") {
    const into = el?.closest<HTMLElement>("[data-drop-into]");
    if (into) {
      const raw = into.dataset.dropInto!;
      return {
        drop: { kind: "into", folderId: raw === "none" ? null : raw },
        line: null,
        key: raw,
        spring: into.dataset.spring ?? null,
      };
    }
    const onto = el?.closest<HTMLElement>("[data-stack-onto]");
    if (onto) {
      const targetId = onto.dataset.stackOnto!;
      const own =
        targetId === source.id ||
        source.members?.includes(targetId) ||
        (!!source.group && onto.dataset.group === source.group);
      if (!own && inStackZone(onto, x, y)) {
        return { drop: { kind: "stack", targetId }, line: null, key: "stack:" + targetId, spring: null };
      }
    }
    if (el?.closest("[data-tray]")) return NOTHING;
    const grid = el?.closest<HTMLElement>("[data-grid]");
    if (grid) {
      const tiles = childrenWith(grid, "data-row");
      const slot = gridSlotAt(tiles, x, y);
      return {
        drop: { kind: "grid", container: grid.dataset.grid!, slot },
        line: gridLineFor(grid, tiles, slot, y),
        key: null,
        spring: null,
      };
    }
    const list = el?.closest<HTMLElement>("[data-list]");
    if (list) {
      const rows = childrenWith(list, "data-row");
      const slot = listSlotAt(rows, y);
      return {
        drop: { kind: "list", container: list.dataset.list!, slot },
        line: lineFor(list, rows, slot),
        key: null,
        spring: null,
      };
    }
    return NOTHING;
  }
  if (source.kind === "project") {
    const group = el?.closest<HTMLElement>("[data-projects]");
    if (group) {
      const rows = childrenWith(group, "data-project-row");
      const slot = listSlotAt(rows, y);
      return {
        drop: { kind: "projects", stageId: group.dataset.projects!, slot },
        line: lineFor(group, rows, slot),
        key: null,
        spring: null,
      };
    }
    const head = el?.closest<HTMLElement>("[data-stage-head]");
    if (head) {
      const stageId = head.dataset.stageHead!;
      const list = head.parentElement?.querySelector<HTMLElement>("[data-projects]");
      const count = list ? childrenWith(list, "data-project-row").length : 0;
      return {
        drop: { kind: "projects", stageId, slot: count },
        line: null,
        key: stageId,
        spring: head.dataset.spring ?? null,
      };
    }
    return NOTHING;
  }
  // A stage: anywhere over the sidebar arranges the stages.
  const nav = el?.closest<HTMLElement>("[data-stages]") ?? null;
  const inside = side && nav === side;
  if (!inside) return NOTHING;
  const groups = Array.from(side.querySelectorAll<HTMLElement>("[data-stage]"));
  const slot = listSlotAt(groups, y);
  return { drop: { kind: "stages", slot }, line: lineFor(side, groups, slot), key: null, spring: null };
}

export function useHomeDrag({
  sideRef,
  mainRef,
  canStart,
  onDrop,
  onSpring,
}: {
  sideRef: React.RefObject<HTMLElement | null>;
  mainRef: React.RefObject<HTMLElement | null>;
  /** False while a menu, dialog or rename is open. */
  canStart: () => boolean;
  onDrop: (source: HomeDragSource, drop: HomeDrop) => void;
  /** A closed folder held under the pointer: open it. */
  onSpring: (key: string) => void;
}) {
  const [source, setSource] = useState<HomeDragSource | null>(null);
  const [hit, setHit] = useState<Hit>(NOTHING);
  const hitRef = useRef<Hit>(NOTHING);
  const spring = useRef<{ key: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const handlers = useRef({ onDrop, onSpring });
  handlers.current = { onDrop, onSpring };

  const clearSpring = () => {
    if (spring.current) clearTimeout(spring.current.timer);
    spring.current = null;
  };
  useEffect(() => clearSpring, []);

  const finish = () => {
    clearSpring();
    hitRef.current = NOTHING;
    setHit(NOTHING);
    setSource(null);
  };

  const start = (event: React.PointerEvent, what: HomeDragSource, element: HTMLElement) => {
    if (!canStartLibraryDrag(event.target) || !canStart()) return;
    beginPointerDrag(event.nativeEvent, {
      source: element,
      // Each pane scrolls under the pointer: the sidebar when over it, the
      // main list everywhere else.
      scroller: (point) => {
        const side = sideRef.current;
        if (side) {
          const box = side.getBoundingClientRect();
          if (box.width > 0 && point.x >= box.left && point.x <= box.right) return side;
        }
        return mainRef.current;
      },
      // A script travels as a small chip beside the pointer, so the folder
      // it is carried to stays in sight; a sidebar row travels as itself.
      ghost: (el) => {
        if (what.kind === "item" && el.classList.contains("dk-tile")) {
          // A cover travels as a small copy of itself, the pile behind it
          // when a whole stack is carried.
          const ghost = document.createElement("div");
          ghost.className = "dk-ghost";
          const card = document.createElement("div");
          card.className = "dk-ghost-card";
          const cover = el.querySelector(".cv");
          if (cover) card.appendChild(cover.cloneNode(true));
          ghost.appendChild(card);
          const count = what.members?.length ?? 1;
          if (count > 1) {
            ghost.classList.add("is-stack");
            const badge = document.createElement("span");
            badge.className = "dk-ghost-count";
            badge.textContent = String(count);
            ghost.appendChild(badge);
          }
          return ghost;
        }
        if (what.kind === "item") {
          const chip = document.createElement("div");
          chip.className = "lib-chip";
          const icon = el.querySelector(".lib-row-icon");
          if (icon) chip.appendChild(icon.cloneNode(true));
          const title = document.createElement("span");
          title.className = "lib-chip-title";
          title.textContent = el.querySelector(".lib-row-title")?.textContent ?? "";
          chip.appendChild(title);
          return chip;
        }
        const copy = el.cloneNode(true) as HTMLElement;
        copy.classList.add("lib-ghost");
        copy.classList.remove("is-on", "is-drop", "is-lifted");
        return copy;
      },
      ghostOffset: what.kind === "item" ? { x: 14, y: 10 } : undefined,
      onStart: () => setSource(what),
      onMove: (point) => {
        const next = hitTest(what, point, sideRef.current);
        hitRef.current = next;
        setHit((prev) =>
          prev.key === next.key &&
          JSON.stringify(prev.drop) === JSON.stringify(next.drop) &&
          prev.line?.top === next.line?.top &&
          prev.line?.left === next.line?.left
            ? prev
            : next
        );
        if (next.spring !== (spring.current?.key ?? null)) {
          clearSpring();
          if (next.spring) {
            const key = next.spring;
            spring.current = {
              key,
              timer: setTimeout(() => {
                spring.current = null;
                handlers.current.onSpring(key);
              }, SPRING_MS),
            };
          }
        }
      },
      onDrop: () => {
        const drop = hitRef.current.drop;
        finish();
        if (drop) handlers.current.onDrop(what, drop);
      },
      onCancel: finish,
    });
  };

  return { source, drop: hit.drop, line: hit.line, dropKey: hit.key, start };
}
