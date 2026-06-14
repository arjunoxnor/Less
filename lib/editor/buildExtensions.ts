import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import { UndoRedo, Gapcursor, Dropcursor, Placeholder } from "@tiptap/extensions";

import { ScreenplayLine } from "./screenplayLine";
import { ScreenplayKeymap } from "./keymap";
import { AutoCaps } from "./autoCaps";
import type { ElementType } from "./elements";

/** Hint shown on the current empty line, tailored to its element type. */
function placeholderFor(element: ElementType): string {
  switch (element) {
    case "scene_heading":
      return "INT. / EXT. LOCATION - TIME";
    case "character":
      return "CHARACTER NAME";
    case "parenthetical":
      return "(how they say it)";
    case "dialogue":
      return "What they say…";
    case "transition":
      return "CUT TO:";
    default:
      return "Action — describe what we see.";
  }
}

/**
 * Assembles the full editor schema + behavior.
 *
 * We deliberately do NOT use TipTap's StarterKit. StarterKit brings paragraphs,
 * headings, lists, blockquotes, bold/italic, etc. — none of which belong in a
 * strict screenplay document. A small, hand-picked extension list is what keeps
 * the schema enforceable, which is what makes Fountain/FDX export reliable.
 *
 *   Document     the top node, forced to be a sequence of screenplay lines
 *   Text         inline text
 *   ScreenplayLine  the one block node (carries the element type)
 *   ScreenplayKeymap  Enter/Tab/Cmd-number behavior
 *   AutoCaps     uppercases scene headings, character cues, transitions
 *   UndoRedo     history (Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z)
 *   Gapcursor/Dropcursor  standard editing niceties
 */
export function buildExtensions() {
  return [
    // Override the document's content rule so the only thing allowed at the top
    // level is one-or-more screenplay lines. Nothing else can sneak in.
    Document.extend({ content: "screenplayLine+" }),
    Text,
    ScreenplayLine,
    ScreenplayKeymap,
    AutoCaps,
    UndoRedo,
    Gapcursor,
    Dropcursor,
    Placeholder.configure({
      includeChildren: false,
      placeholder: ({ node }) =>
        placeholderFor((node.attrs.element as ElementType) ?? "action"),
    }),
  ];
}
