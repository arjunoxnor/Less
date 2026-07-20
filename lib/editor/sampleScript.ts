import type { JSONContent } from "@tiptap/core";
import type { ElementType } from "./elements";

/** Tiny helper to build a screenplay line of a given type. */
function line(element: ElementType, text: string): JSONContent {
  return {
    type: "screenplayLine",
    attrs: { element },
    content: text ? [{ type: "text", text }] : [],
  };
}

/**
 * The document a cold visit is seeded with (Superaudit 2, 2D.1). It exists so
 * the editor is never an intimidating blank page and so the formatting
 * (indents, casing, centered character cues) is visible the instant the app
 * loads. Exactly six lines: one of each element type, in the order the Tab
 * cycle presents them.
 */
export const SAMPLE_SCRIPT: JSONContent = {
  type: "doc",
  content: [
    line("scene_heading", "INT. WRITER'S APARTMENT - NIGHT"),
    line(
      "action",
      "A cramped studio lit by one desk lamp. ALEX (30s) stares at a glowing laptop. The cursor blinks. It has been blinking for an hour."
    ),
    line("character", "ALEX"),
    line("parenthetical", "(to the screen)"),
    line("dialogue", "Okay. Last ever screenwriting software. No more excuses."),
    line("transition", "CUT TO:"),
  ],
};
