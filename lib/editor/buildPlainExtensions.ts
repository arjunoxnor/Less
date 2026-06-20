import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";

/**
 * The plain-document editor schema: the STANDARD ProseMirror rich-text schema
 * (paragraphs, headings, lists, blockquote, hr, bold/italic/underline/strike),
 * entirely separate from the strict screenplay schema. StarterKit 3 bundles all
 * of these plus history, dropcursor, gapcursor, underline, and link, so there is
 * nothing to hand-wire. Used for outlines, beats, and notes.
 */
export function buildPlainExtensions() {
  return [
    StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
    Placeholder.configure({
      placeholder: "Start writing. Outline, beats, notes, anything.",
    }),
  ];
}
