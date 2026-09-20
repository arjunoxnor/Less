import { Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { Highlight } from "@tiptap/extension-highlight";
import { TextAlign } from "@tiptap/extension-text-align";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { SmartCaps } from "./smartCaps";
import { boardExtensions } from "./boardNodes";

/**
 * Notes use paragraph spacing for their visible rhythm. At the top level,
 * Shift+Enter therefore creates the same paragraph boundary as Enter instead
 * of a hard break that looks similar but carries no paragraph gap. Nested
 * contexts keep StarterKit's normal soft-break behavior.
 */
export const UniformPlainBreaks = Extension.create({
  name: "uniformPlainBreaks",
  priority: 200,

  addKeyboardShortcuts() {
    return {
      "Shift-Enter": () => {
        const { $from } = this.editor.state.selection;
        if ($from.depth !== 1) return false;
        if ($from.parent.type.name !== "paragraph" && $from.parent.type.name !== "heading") {
          return false;
        }
        return this.editor.commands.splitBlock();
      },
    };
  },
});

/**
 * The plain-document editor schema: the STANDARD ProseMirror rich-text schema,
 * entirely separate from the strict screenplay schema. StarterKit 3 brings
 * paragraphs, headings, lists, blockquote, hr, code, history, link, and
 * bold/italic/underline/strike. On top we add the rest of the Google-Docs-style
 * toolset: text alignment, highlight, text color, and checklists.
 */
export function buildPlainExtensions(opts?: { placeholder?: string; board?: boolean }) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true },
    }),
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    TaskList,
    TaskItem.configure({ nested: true }),
    SmartCaps,
    UniformPlainBreaks,
    Placeholder.configure({
      placeholder: opts?.placeholder ?? "Start writing. Outline, beats, notes, anything.",
    }),
    // Images, image grids, and palettes exist only in boards, so an ordinary
    // document, its paginator, and its exporters never meet them.
    ...(opts?.board ? boardExtensions : []),
  ];
}
