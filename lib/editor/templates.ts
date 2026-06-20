import type { JSONContent } from "@tiptap/core";
import type { ElementType } from "./elements";

/**
 * Starter templates for new screenplays. Each is a small scaffold in the strict
 * screenplay schema (the editor uppercases sluglines/cues/transitions on its
 * own, so seed text is written plainly). "Blank" is the default empty page.
 */

const line = (element: ElementType, text = ""): JSONContent => ({
  type: "screenplayLine",
  attrs: { element },
  content: text ? [{ type: "text", text }] : [],
});

const doc = (...lines: JSONContent[]): JSONContent => ({ type: "doc", content: lines });

export interface ScreenplayTemplate {
  id: string;
  label: string;
  description: string;
  build: () => JSONContent;
}

export const SCREENPLAY_TEMPLATES: ScreenplayTemplate[] = [
  {
    id: "blank",
    label: "Blank",
    description: "An empty page.",
    build: () => doc(line("scene_heading")),
  },
  {
    id: "feature",
    label: "Feature film",
    description: "FADE IN and a first scene.",
    build: () =>
      doc(
        line("transition", "FADE IN:"),
        line("scene_heading", "INT. LOCATION - DAY"),
        line("action", "We open on something we cannot look away from."),
        line("scene_heading")
      ),
  },
  {
    id: "tv_hour",
    label: "TV drama (1 hour)",
    description: "Cold open and act breaks.",
    build: () =>
      doc(
        line("action", "COLD OPEN"),
        line("scene_heading", "INT. LOCATION - NIGHT"),
        line("action", "A hook that earns the first commercial."),
        line("action", "END OF COLD OPEN"),
        line("action", "ACT ONE"),
        line("scene_heading", "INT. LOCATION - DAY"),
        line("action", "")
      ),
  },
  {
    id: "sitcom",
    label: "Sitcom (multi-cam)",
    description: "Act and scene markers.",
    build: () =>
      doc(
        line("action", "ACT ONE"),
        line("action", "SCENE A"),
        line("scene_heading", "INT. LIVING ROOM - DAY"),
        line("action", "The ensemble is mid-argument as we join them."),
        line("character", "CHARACTER"),
        line("dialogue", "")
      ),
  },
];

export function buildTemplate(id: string): JSONContent | null {
  const t = SCREENPLAY_TEMPLATES.find((x) => x.id === id);
  return t ? t.build() : null;
}
