import type { EditorState, Transaction } from "@tiptap/pm/state";
import { SKIP_REVISION_META } from "./revisions";
import { sceneCard, type SceneCardAttrs } from "./sceneAttrs";

/**
 * Storylines (plot lines) and scene summaries, written onto the scene
 * headings. Each change is one undoable step and never counts as a revision:
 * it changes what the board shows, not a word of the script.
 */

/** The colors a new storyline takes, in order: distinct on paper and on the dark page. */
export const STORYLINE_COLORS = [
  "#378add", // blue
  "#ba7517", // amber
  "#3fa663", // green
  "#c45fb8", // magenta
  "#e0533b", // red
  "#1d9e75", // teal
  "#7f77dd", // purple
  "#e08a2e", // orange
] as const;

/** The first color no storyline wears yet (cycling once all are taken). */
export function nextStorylineColor(inUse: string[]): string {
  const taken = new Set(inUse.map((c) => c.toLowerCase()));
  return STORYLINE_COLORS.find((c) => !taken.has(c)) ?? STORYLINE_COLORS[inUse.length % STORYLINE_COLORS.length];
}

function finish(tr: Transaction): Transaction {
  tr.setMeta(SKIP_REVISION_META, true);
  tr.setMeta("storyline", true);
  return tr;
}

/** Change one scene's card: its storyline (with the color it wears) and summary. */
export function setSceneCardTr(
  state: EditorState,
  headingPos: number,
  patch: Partial<SceneCardAttrs>
): Transaction | null {
  const node = state.doc.nodeAt(headingPos);
  if (!node || node.attrs.element !== "scene_heading") return null;
  const before = sceneCard(node.attrs.scene);
  const next = sceneCard({ storyline: "", color: "", synopsis: "", ...before, ...patch });
  if (JSON.stringify(before) === JSON.stringify(next)) return null;
  return finish(state.tr.setNodeMarkup(headingPos, undefined, { ...node.attrs, scene: next }));
}

/**
 * Rename or recolor a storyline on every scene that has it, in one step. An
 * empty new name takes the storyline off those scenes (their summaries stay).
 */
export function updateStorylineTr(
  state: EditorState,
  name: string,
  change: { name?: string; color?: string }
): Transaction | null {
  const tr = state.tr;
  let changed = false;
  state.doc.forEach((node, offset) => {
    if (node.attrs.element !== "scene_heading") return;
    const card = sceneCard(node.attrs.scene);
    if (!card || card.storyline !== name) return;
    const renamed = change.name !== undefined ? change.name.trim() : card.storyline;
    const next = sceneCard({
      ...card,
      storyline: renamed,
      color: change.color ?? card.color,
    });
    if (JSON.stringify(next) === JSON.stringify(card)) return;
    tr.setNodeMarkup(offset, undefined, { ...node.attrs, scene: next });
    changed = true;
  });
  return changed ? finish(tr) : null;
}
