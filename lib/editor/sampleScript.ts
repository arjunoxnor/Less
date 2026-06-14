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
 * The default document a first-time visitor sees. It exists so the editor is
 * never an intimidating blank page and so the formatting (indents, casing,
 * centered character cues) is visible the instant the app loads.
 *
 * Short on purpose — one complete little scene that shows every element type.
 */
export const SAMPLE_SCRIPT: JSONContent = {
  type: "doc",
  content: [
    line("scene_heading", "INT. WRITER'S APARTMENT - NIGHT"),
    line(
      "action",
      "A cramped studio lit by one desk lamp. ALEX (30s), hair a mess, stares at a glowing laptop. The cursor blinks. It has been blinking for an hour."
    ),
    line("character", "ALEX"),
    line("parenthetical", "(to the screen)"),
    line("dialogue", "Okay. Last ever screenwriting software. No more excuses."),
    line("action", "Alex cracks their knuckles and starts to type. The words come easily now."),
    line("character", "ALEX (CONT'D)"),
    line("dialogue", "Finally."),
    line("transition", "CUT TO:"),
    line("scene_heading", "EXT. ROOFTOP - CONTINUOUS"),
    line("action", "The city hums below. Somewhere, a story is being written. This one is yours. Delete this and begin."),
  ],
};
