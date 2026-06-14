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
}

/** A scene, derived by splitting the line list on scene headings. */
export interface Scene {
  heading: string;
  /** Index of the scene-heading line within the flat line list. */
  lineIndex: number;
}
