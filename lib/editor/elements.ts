/**
 * The screenplay element model.
 *
 * This file is the single source of truth for "what kinds of lines exist in a
 * screenplay and how they behave." The editor schema, the keyboard shortcuts,
 * the toolbar, the CSS, and (later) the Fountain/FDX exporters all read from
 * here. If you want to change how an element flows or is labeled, change it
 * once, here.
 */

/** The six element types a screenplay line can be. */
export type ElementType =
  | "scene_heading"
  | "action"
  | "character"
  | "parenthetical"
  | "dialogue"
  | "transition";

/** The default type for a brand-new, context-free line. */
export const DEFAULT_ELEMENT: ElementType = "action";

/**
 * Ordered list used by Tab / Shift+Tab to cycle a line through the types.
 * This is the "cycle order" — deliberately the natural writing rhythm.
 */
export const ELEMENT_CYCLE: ElementType[] = [
  "scene_heading",
  "action",
  "character",
  "dialogue",
  "parenthetical",
  "transition",
];

/** Human-readable labels (used in the toolbar and status bar). */
export const ELEMENT_LABELS: Record<ElementType, string> = {
  scene_heading: "Scene Heading",
  action: "Action",
  character: "Character",
  parenthetical: "Parenthetical",
  dialogue: "Dialogue",
  transition: "Transition",
};

/**
 * "What comes next when I press Enter at the end of this element."
 *
 * This is what makes the editor feel professional: finish a character name,
 * press Enter, and you're writing dialogue without touching the mouse.
 *
 *  - After a scene heading you describe the scene  -> action
 *  - After action you keep describing              -> action
 *  - After a character name you speak              -> dialogue
 *  - After a parenthetical you speak               -> dialogue
 *  - After a line of dialogue you move on          -> action
 *  - After a transition you start a new scene      -> scene_heading
 */
export const ENTER_FLOW: Record<ElementType, ElementType> = {
  scene_heading: "action",
  action: "action",
  character: "dialogue",
  parenthetical: "dialogue",
  dialogue: "action",
  transition: "scene_heading",
};

/**
 * Element types whose text is forced to UPPERCASE as the writer types.
 * Scene headings and character cues are uppercase by screenplay convention,
 * and storing them uppercased (rather than just displaying them that way)
 * keeps the cast list, autocomplete, and exporters honest.
 */
export const UPPERCASE_ELEMENTS: ReadonlySet<ElementType> = new Set<ElementType>([
  "scene_heading",
  "character",
  "transition",
]);

/**
 * Cmd/Ctrl + number -> element type. This is the explicit mapping from the
 * product spec:
 *   1 = scene heading, 2 = action, 3 = character,
 *   4 = dialogue, 5 = parenthetical, 6 = transition
 * (6 is added for completeness; the first five match the spec exactly.)
 */
export const NUMBER_SHORTCUTS: Record<string, ElementType> = {
  "1": "scene_heading",
  "2": "action",
  "3": "character",
  "4": "dialogue",
  "5": "parenthetical",
  "6": "transition",
};

/** Reverse of NUMBER_SHORTCUTS, for showing the hint in the toolbar. */
export const ELEMENT_NUMBER: Record<ElementType, string> = {
  scene_heading: "1",
  action: "2",
  character: "3",
  dialogue: "4",
  parenthetical: "5",
  transition: "6",
};

/** Step to the next element type in the cycle (Tab). */
export function nextElement(type: ElementType): ElementType {
  const i = ELEMENT_CYCLE.indexOf(type);
  return ELEMENT_CYCLE[(i + 1) % ELEMENT_CYCLE.length];
}

/** Step to the previous element type in the cycle (Shift+Tab). */
export function prevElement(type: ElementType): ElementType {
  const i = ELEMENT_CYCLE.indexOf(type);
  return ELEMENT_CYCLE[(i - 1 + ELEMENT_CYCLE.length) % ELEMENT_CYCLE.length];
}
