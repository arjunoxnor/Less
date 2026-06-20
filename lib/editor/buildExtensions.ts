import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import { UndoRedo, Gapcursor, Dropcursor, Placeholder } from "@tiptap/extensions";

import { ScreenplayLine } from "./screenplayLine";
import { ScreenplayKeymap } from "./keymap";
import { AutoCaps } from "./autoCaps";
import { AutoElement } from "./autoElement";
import { ElementIcons } from "./elementIcons";
import { buildAutocomplete, type AcState } from "./autocomplete";
import { FindReplace } from "./findPlugin";
import { buildSpellcheck, type SpellState } from "./spellcheck";
import { buildRevisionTracker } from "./revisions";
import { EMPTY_OUTLINE } from "./outline";
import type { ElementType } from "./elements";
import type { Outline } from "@/types/screenplay";
import type { NSpell } from "nspell";

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
export function buildExtensions(opts?: {
  /** Live outline source for autocomplete candidates (locations, characters). */
  getOutline?: () => Outline;
  /** Pushes the autocomplete dropdown state to React for rendering. */
  onAutocompleteState?: (state: AcState | null) => void;
  /** Lazy spell-check engine loader; omit to disable spell check entirely. */
  getSpeller?: () => Promise<NSpell>;
  /** Live read of the user's Spelling toggle. */
  isSpellEnabled?: () => boolean;
  /** Pushes the spelling popover state to React for rendering. */
  onSpellState?: (state: SpellState | null) => void;
  /** Live read of the user's Revisions toggle (auto-marks edited lines). */
  isRevisionEnabled?: () => boolean;
}) {
  const getOutline = opts?.getOutline ?? (() => EMPTY_OUTLINE);
  const extensions = [
    // Override the document's content rule so the only thing allowed at the top
    // level is one-or-more screenplay lines. Nothing else can sneak in.
    Document.extend({ content: "screenplayLine+" }),
    Text,
    ScreenplayLine,
    ScreenplayKeymap,
    AutoCaps,
    AutoElement,
    ElementIcons,
    // Autocomplete carries priority 200 so its keydown handler runs before the
    // keymap; it only consumes keys while its menu is open.
    buildAutocomplete(getOutline, opts?.onAutocompleteState),
    FindReplace,
    UndoRedo,
    Gapcursor,
    Dropcursor,
    Placeholder.configure({
      includeChildren: false,
      placeholder: ({ node }) =>
        placeholderFor((node.attrs.element as ElementType) ?? "action"),
    }),
  ];
  // Spell check is decorations + click only (no keydown priority needed).
  if (opts?.getSpeller) {
    extensions.push(
      buildSpellcheck(
        getOutline,
        opts.getSpeller,
        opts.isSpellEnabled ?? (() => true),
        opts.onSpellState
      )
    );
  }
  // Revision tracking marks edited lines while revision mode is on.
  if (opts?.isRevisionEnabled) {
    extensions.push(buildRevisionTracker(opts.isRevisionEnabled));
  }
  return extensions;
}
