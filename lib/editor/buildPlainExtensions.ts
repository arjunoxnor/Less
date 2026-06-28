import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { Highlight } from "@tiptap/extension-highlight";
import { TextAlign } from "@tiptap/extension-text-align";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { SmartCaps } from "./smartCaps";

/**
 * The plain-document editor schema: the STANDARD ProseMirror rich-text schema,
 * entirely separate from the strict screenplay schema. StarterKit 3 brings
 * paragraphs, headings, lists, blockquote, hr, code, history, link, and
 * bold/italic/underline/strike. On top we add the rest of the Google-Docs-style
 * toolset: text alignment, highlight, text color, and checklists.
 */
export function buildPlainExtensions() {
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
    Placeholder.configure({
      placeholder: "Start writing. Outline, beats, notes, anything.",
    }),
  ];
}
