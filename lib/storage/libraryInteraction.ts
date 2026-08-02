import type { ThemeChoice } from "./localStore";
import type { Folder } from "./folders";
import { canMoveFolderTo, reorderIdsAtSlot } from "./library";

/** Interactive controls inside a draggable row retain their own pointer use. */
export function canStartLibraryDrag(target: EventTarget | null): boolean {
  return !(
    target instanceof Element &&
    target.closest("input, textarea, button, select, a, [contenteditable='true']")
  );
}

export type FolderCardDropTarget =
  | { kind: "body"; folderId: string }
  | {
      kind: "gap";
      parentId: string;
      siblingIds: string[];
      slot: number;
    };

export type FolderCardDropPlan =
  | { parentId: string; orderedIds?: never }
  | { parentId?: string; orderedIds: string[] };

/**
 * A card body files a folder inside that card. A grid gap arranges the target
 * section's children, adding a parent write only when the section changes.
 */
export function planFolderCardDrop(
  sourceId: string,
  target: FolderCardDropTarget,
  folders: Folder[]
): FolderCardDropPlan | null {
  const source = folders.find((folder) => folder.id === sourceId);
  if (!source) return null;

  if (target.kind === "body") {
    if (!canMoveFolderTo(sourceId, target.folderId, folders)) return null;
    if ((source.parentId ?? null) === target.folderId) return null;
    return { parentId: target.folderId };
  }

  if (!canMoveFolderTo(sourceId, target.parentId, folders)) return null;
  const currentParentId = source.parentId ?? null;
  if (currentParentId === target.parentId) {
    const orderedIds = reorderIdsAtSlot(
      target.siblingIds,
      sourceId,
      target.slot
    );
    return orderedIds ? { orderedIds } : null;
  }

  const targetIds = target.siblingIds.filter((id) => id !== sourceId);
  const withSource = [...targetIds, sourceId];
  const orderedIds =
    reorderIdsAtSlot(withSource, sourceId, target.slot) ?? withSource;
  return { parentId: target.parentId, orderedIds };
}

export interface CardGridRect {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface CardGridGap {
  at: number;
  line: { left: number; top: number; width: number; height: number };
}

type GapCandidate = CardGridGap & {
  distanceSquared: (x: number, y: number) => number;
};

function verticalGap(
  at: number,
  x: number,
  top: number,
  bottom: number
): GapCandidate {
  return {
    at,
    line: { left: x - 1, top, width: 2, height: Math.max(2, bottom - top) },
    distanceSquared: (pointerX, pointerY) => {
      const nearestY = Math.max(top, Math.min(pointerY, bottom));
      return (pointerX - x) ** 2 + (pointerY - nearestY) ** 2;
    },
  };
}

function horizontalGap(
  at: number,
  y: number,
  left: number,
  right: number
): GapCandidate {
  return {
    at,
    line: { left, top: y - 1, width: Math.max(2, right - left), height: 2 },
    distanceSquared: (pointerX, pointerY) => {
      const nearestX = Math.max(left, Math.min(pointerX, right));
      return (pointerX - nearestX) ** 2 + (pointerY - y) ** 2;
    },
  };
}

/**
 * Resolve the nearest insertion line across every row and column in a card
 * grid. Row boundaries are full-width gaps so a short card cannot create a
 * dead zone beside a taller neighbor.
 */
export function nearestCardGridGap(
  pointerX: number,
  pointerY: number,
  cards: CardGridRect[]
): CardGridGap | null {
  if (cards.length === 0) return null;

  const rows: { first: number; cards: CardGridRect[] }[] = [];
  for (let index = 0; index < cards.length; index++) {
    const card = cards[index];
    const row = rows[rows.length - 1];
    if (row && Math.abs(row.cards[0].top - card.top) < 2) {
      row.cards.push(card);
    } else {
      rows.push({ first: index, cards: [card] });
    }
  }

  const gridLeft = Math.min(...cards.map((card) => card.left));
  const gridRight = Math.max(...cards.map((card) => card.right));
  const candidates: GapCandidate[] = [];

  rows.forEach((row, rowIndex) => {
    const top = Math.min(...row.cards.map((card) => card.top));
    const bottom = Math.max(...row.cards.map((card) => card.bottom));
    const first = row.cards[0];
    candidates.push(verticalGap(row.first, first.left, top, bottom));

    for (let index = 1; index < row.cards.length; index++) {
      const previous = row.cards[index - 1];
      const current = row.cards[index];
      candidates.push(
        verticalGap(
          row.first + index,
          (previous.right + current.left) / 2,
          Math.max(previous.top, current.top),
          Math.min(previous.bottom, current.bottom)
        )
      );
    }

    const last = row.cards[row.cards.length - 1];
    candidates.push(
      verticalGap(row.first + row.cards.length, last.right, top, bottom)
    );

    const nextRow = rows[rowIndex + 1];
    if (nextRow) {
      const nextTop = Math.min(...nextRow.cards.map((card) => card.top));
      candidates.push(
        horizontalGap(
          nextRow.first,
          (bottom + nextTop) / 2,
          gridLeft,
          gridRight
        )
      );
    }
  });

  let nearest = candidates[0];
  let nearestDistance = nearest.distanceSquared(pointerX, pointerY);
  for (const candidate of candidates.slice(1)) {
    const distance = candidate.distanceSquared(pointerX, pointerY);
    if (distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }
  return { at: nearest.at, line: nearest.line };
}

/** The explicit choice that guarantees one click changes the visible theme. */
export function nextThemeChoice(
  theme: ThemeChoice,
  systemResolvesDark: boolean
): Exclude<ThemeChoice, "system"> {
  const current =
    theme === "system" ? (systemResolvesDark ? "dark" : "light") : theme;
  return current === "dark" ? "light" : "dark";
}
