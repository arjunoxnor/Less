import type { Node as PMNode } from "@tiptap/pm/model";
import { LAYOUT, LINES_PER_PAGE, wrap } from "@/lib/export/layout";
import { isElementType } from "@/lib/export/flatten";
import { cueBaseName } from "./outline";
import { sceneCard } from "./sceneAttrs";

/**
 * The structure board's view of a script: one card per scene, in order.
 * A pure walk of the document, like the outline, so it is testable on its own.
 */

export interface SceneCardData {
  /** Position among the scenes, from 0. */
  index: number;
  /** Position of the heading line in the document. */
  headingPos: number;
  heading: string;
  storyline: string;
  color: string;
  synopsis: string;
  /** The scene's first lines of action, for a card with no summary of its own. */
  preview: string;
  /** Who speaks in the scene, in order of first line. */
  characters: string[];
  /** How long the scene runs, in eighths of a page (at least one). */
  eighths: number;
}

export interface StorylineEntry {
  name: string;
  color: string;
  scenes: number;
}

const PREVIEW_CHARS = 180;
const LINES_PER_EIGHTH = LINES_PER_PAGE / 8;

function linesOf(node: PMNode): number {
  const raw = node.attrs.element;
  const element = isElementType(raw) ? raw : "action";
  const layout = LAYOUT[element];
  const rows = wrap(node.textContent, layout.maxChars, layout.hang ?? 0).length;
  return Math.max(1, rows) + layout.spaceBefore;
}

export function buildSceneCards(doc: PMNode): SceneCardData[] {
  const cards: SceneCardData[] = [];
  let current: (SceneCardData & { lines: number }) | null = null;
  const finish = () => {
    if (!current) return;
    const { lines, ...card } = current;
    cards.push({ ...card, eighths: Math.max(1, Math.round(lines / LINES_PER_EIGHTH)) });
    current = null;
  };

  doc.forEach((node, offset) => {
    const element = node.attrs.element as string;
    if (element === "scene_heading") {
      finish();
      const card = sceneCard(node.attrs.scene);
      current = {
        index: cards.length,
        headingPos: offset,
        heading: node.textContent.trim(),
        storyline: card?.storyline ?? "",
        color: card?.color ?? "",
        synopsis: card?.synopsis ?? "",
        preview: "",
        characters: [],
        eighths: 1,
        lines: linesOf(node),
      };
      return;
    }
    if (!current) return;
    const text = node.textContent.trim();
    current.lines += linesOf(node);
    if (element === "action" && text && current.preview.length < PREVIEW_CHARS) {
      current.preview = (current.preview ? current.preview + " " : "") + text;
    } else if (element === "character" && text) {
      const name = cueBaseName(text).toUpperCase();
      if (name && !current.characters.includes(name)) current.characters.push(name);
    }
  });
  finish();

  for (const card of cards) {
    if (card.preview.length > PREVIEW_CHARS) {
      const cut = card.preview.lastIndexOf(" ", PREVIEW_CHARS);
      card.preview =
        card.preview
          .slice(0, cut > 80 ? cut : PREVIEW_CHARS)
          .trimEnd()
          .replace(/[.,;:!?-]+$/, "") + "…";
    }
  }
  return cards;
}

/** The script's storylines in order of first appearance, each with the color it wears. */
export function storylinesOf(cards: SceneCardData[]): StorylineEntry[] {
  const byName = new Map<string, StorylineEntry>();
  for (const card of cards) {
    if (!card.storyline) continue;
    const entry = byName.get(card.storyline);
    if (entry) {
      entry.scenes++;
      if (!entry.color && card.color) entry.color = card.color;
    } else {
      byName.set(card.storyline, { name: card.storyline, color: card.color, scenes: 1 });
    }
  }
  return [...byName.values()];
}

/** "3/8", "1", "1 5/8": a length the way a production board writes it. */
export function formatEighths(eighths: number): string {
  const pages = Math.floor(eighths / 8);
  const rest = eighths % 8;
  if (rest === 0) return String(pages);
  return pages ? `${pages} ${rest}/8` : `${rest}/8`;
}
