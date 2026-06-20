import type { ElementType } from "@/lib/editor/elements";

/**
 * Shared screenplay types. The editor's source of truth is ProseMirror JSON,
 * but these typed shapes describe the document at a higher level for things
 * like export, the scene navigator, and the cast list (later phases).
 */

/** One line of a screenplay, flattened from the ProseMirror doc. */
export interface ScriptLine {
  element: ElementType;
  text: string;
  /** True for the right-column cue (and its body) of a dual-dialogue block. */
  dual?: boolean;
}

/** A scene, derived by splitting the line list on scene headings. */
export interface Scene {
  heading: string;
  /** Index of the scene-heading line within the flat line list. */
  lineIndex: number;
}

/* --- Phase 4: navigation -------------------------------------------------- */

/** A scene heading, with the document position to jump to and a page estimate. */
export interface SceneEntry {
  /** 1-based scene number among the headings. */
  number: number;
  heading: string;
  /** Absolute ProseMirror position inside the heading line (the jump target). */
  pos: number;
  /** Index of this line among the doc's top-level lines. */
  lineIndex: number;
  /** Estimated page the scene begins on, or null if not estimable. */
  page: number | null;
}

/** A speaking character, with where they first appear and how often. */
export interface CastEntry {
  name: string;
  /** Jump target: the first cue for this character. */
  pos: number;
  lines: number;
  scenes: number;
}

/** A location used in a slugline, with how many scenes use it. */
export interface LocationEntry {
  name: string;
  scenes: number;
  /** Line index of the most recent sighting, for recency ranking. */
  lastIndex: number;
  /** Sub-locations seen under this parent (e.g. KITCHEN under HOUSE). */
  subLocations: string[];
}

/** A character name with its dialogue-line count (for autocomplete ranking). */
export interface CharacterEntry {
  name: string;
  lines: number;
  /** Line index of the most recent cue, for recency ranking. */
  lastIndex: number;
  /** The last cue extension used with this name, e.g. "(V.O.)", if any. */
  lastExtension?: string;
}

/** A transition used in the script, with frequency and recency for ranking. */
export interface TransitionEntry {
  text: string;
  count: number;
  lastIndex: number;
}

/** Everything derived from one walk of the document. */
export interface Outline {
  scenes: SceneEntry[];
  locations: LocationEntry[];
  characters: CharacterEntry[];
  cast: CastEntry[];
  transitions: TransitionEntry[];
}
