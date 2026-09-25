"use client";

import { useEffect, useRef, useState } from "react";
import { beginPointerDrag, listSlotAt, type DragPoint } from "@/lib/ui/pointerDrag";
import { canStartLibraryDrag } from "@/lib/storage/libraryInteraction";

/**
 * Dragging on the home: scripts and documents into folders or to a new place
 * in a list, projects between stages in the sidebar, stages up and down.
 *
 * Targets are marked in the markup, so the page decides what it offers:
 *   data-drop-into="<folder id | none>"  drop an item here to file it there
 *   data-list="<folder id | unfiled>"    a list of rows (data-row) to place it in
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
  | { kind: "item"; id: string }
  | { kind: "project"; id: string }
  | { kind: "stage"; id: string };

export type HomeDrop =
  | { kind: "into"; folderId: string | null }
  | { kind: "list"; container: string; slot: number }
  | { kind: "projects"; stageId: string; slot: number }
  | { kind: "stages"; slot: number };

export interface DropLine {
  left: number;
  top: number;
  width: number;
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
