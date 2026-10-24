import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { FontFamily, FontSize, TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { Highlight } from "@tiptap/extension-highlight";
import { TextAlign } from "@tiptap/extension-text-align";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { SmartCaps } from "./smartCaps";
import { boardExtensions } from "./boardNodes";
import { VoiceNote, VoicePending, type VoiceNoteOptions } from "./voiceNodes";
import { cleanPastedHTML } from "./docFonts";
import { Bookmarks } from "./bookmarks";

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
    const paragraphBreak = () => {
      const { $from } = this.editor.state.selection;
      // A voice note's paragraphs keep the same rhythm as the page's.
      const inVoiceNote = $from.depth === 2 && $from.node(1).type.name === "voiceNote";
      if ($from.depth !== 1 && !inVoiceNote) return false;
      if ($from.parent.type.name !== "paragraph" && $from.parent.type.name !== "heading") {
        return false;
      }
      return this.editor.commands.splitBlock();
    };
    // Ctrl+Enter too: a soft break that looks like a paragraph but is not one.
    return { "Shift-Enter": paragraphBreak, "Mod-Enter": paragraphBreak };
  },
});

/**
 * Keys a writer expects on a page. Tab indents the line with a tab (after the
 * list and checklist keys have had their turn, so in a list it still nests
 * the item) instead of jumping out of the document.
 */
export const PlainKeys = Extension.create({
  name: "plainKeys",
  priority: 50,
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        const { $from } = this.editor.state.selection;
        if (!$from.parent.isTextblock || $from.parent.type.name === "codeBlock") return false;
        return this.editor.commands.insertContent("\t");
      },
    };
  },
});

/** Ctrl+click (Cmd+click on a Mac) opens a link in a new tab; a plain click edits. */
export const OpenLinks = Extension.create({
  name: "openLinks",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("openLinks"),
        props: {
          handleClick: (view, pos, event) => {
            if (!(event.ctrlKey || event.metaKey)) return false;
            const link = view.state.doc
              .resolve(pos)
              .marks()
              .find((m) => m.type.name === "link");
            const href = link?.attrs.href as string | undefined;
            if (!href) return false;
            window.open(href, "_blank", "noopener,noreferrer");
            return true;
          },
        },
      }),
    ];
  },
});

/** Text pasted from another app takes on the document's own font and size (docFonts.ts). */
export const PastedLooks = Extension.create({
  name: "pastedLooks",
  addProseMirrorPlugins() {
    return [new Plugin({ key: new PluginKey("pastedLooks"), props: { transformPastedHTML: cleanPastedHTML } })];
  },
});

/**
 * The plain-document editor schema: the STANDARD ProseMirror rich-text schema,
 * entirely separate from the strict screenplay schema. StarterKit 3 brings
 * paragraphs, headings, lists, blockquote, hr, code, history, link, and
 * bold/italic/underline/strike. On top we add the rest of the Google-Docs-style
 * toolset: text alignment, highlight, text color, a font and a size for any
 * stretch of text, and checklists.
 */
export function buildPlainExtensions(opts?: {
  placeholder?: string;
  board?: boolean;
  /** Opens a transcribed voice note's original transcript. */
  onOriginalTranscript?: VoiceNoteOptions["onOriginal"];
}) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true },
    }),
    TextStyle,
    FontFamily,
    FontSize,
    Color,
    PastedLooks,
    PlainKeys,
    OpenLinks,
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
    // document, its paginator, and its exporters never meet them. Voice notes
    // (lib/editor/voiceNodes.ts) are the other way round: documents only.
    ...(opts?.board
      ? boardExtensions
      : [
          VoicePending,
          VoiceNote.configure({ onOriginal: opts?.onOriginalTranscript ?? null }),
          // Coloured bookmarks on paragraphs and headings (lib/editor/bookmarks.ts).
          Bookmarks.configure({ types: ["paragraph", "heading"] }),
        ]),
  ];
}
