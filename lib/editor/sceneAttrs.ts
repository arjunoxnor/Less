/**
 * What a scene heading carries for the structure board: the storyline (plot
 * line) the scene belongs to, that storyline's color, and a one-line summary.
 * Stored as one attribute on the heading line, null on every other line.
 */
export interface SceneCardAttrs {
  storyline: string;
  /** A plain #rrggbb, or empty. */
  color: string;
  synopsis: string;
}

export const MAX_STORYLINE_LENGTH = 40;
export const MAX_SYNOPSIS_LENGTH = 300;

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Clean whatever arrived (a document from another device, pasted HTML, an old
 * client) into a card, or null when it holds nothing worth keeping. A color
 * means nothing without a storyline to belong to, so it goes with it.
 */
export function sceneCard(raw: unknown): SceneCardAttrs | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const storyline =
    typeof r.storyline === "string" ? r.storyline.trim().slice(0, MAX_STORYLINE_LENGTH) : "";
  const color = storyline && typeof r.color === "string" && HEX.test(r.color) ? r.color.toLowerCase() : "";
  const synopsis =
    typeof r.synopsis === "string" ? r.synopsis.trim().slice(0, MAX_SYNOPSIS_LENGTH) : "";
  if (!storyline && !synopsis) return null;
  return { storyline, color, synopsis };
}
