import { Bold } from "@tiptap/extension-bold";
import { Italic } from "@tiptap/extension-italic";
import { Underline } from "@tiptap/extension-underline";
import { Highlight } from "@tiptap/extension-highlight";

/**
 * Bold, italic, underline and highlight in a script (Ctrl/Cmd+B, I, U, and
 * Ctrl/Cmd+Shift+H for a yellow highlight). Formatting rides on the text as
 * marks, never on the line, so it never changes an element or a page break;
 * the exporters carry it (lib/export/styleRuns.ts).
 *
 * No typing shortcuts: asterisks and underscores in a script are text (and
 * Fountain's own emphasis markers on import), so "*word*" must stay as typed.
 */
const noRules = { addInputRules: () => [], addPasteRules: () => [] };

export const SCRIPT_HIGHLIGHTS: { label: string; value: string }[] = [
  { label: "Yellow", value: "#fff1a8" },
  { label: "Green", value: "#c6f6c2" },
  { label: "Blue", value: "#c2e0ff" },
  { label: "Pink", value: "#ffc9e0" },
];

export const scriptMarks = [
  Bold.extend(noRules),
  Italic.extend(noRules),
  Underline.extend(noRules),
  Highlight.extend({
    ...noRules,
    addKeyboardShortcuts() {
      return { "Mod-Shift-h": () => this.editor.commands.toggleHighlight({ color: SCRIPT_HIGHLIGHTS[0].value }) };
    },
  }).configure({ multicolor: true }),
];
