import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { UndoRedo, Gapcursor, Dropcursor, Placeholder } from "@tiptap/extensions";
import type { AnyExtension } from "@tiptap/core";

import { ScreenplayLine } from "./screenplayLine";
import { ScreenplayKeymap } from "./keymap";
import { AutoCaps } from "./autoCaps";
import { SmartCaps } from "./smartCaps";
import { AutoElement } from "./autoElement";
import { ElementIcons } from "./elementIcons";
import { buildContdMarkers } from "./contd";
import { buildBreakdownMarks } from "./breakdownMarks";
import type { BreakdownItem } from "./breakdown";
import { buildAutocomplete, type AcState } from "./autocomplete";
import { FindReplace } from "./findPlugin";
import { buildSpellcheck, type SpellState } from "./spellcheck";
import { buildRevisionTracker } from "./revisions";
import { buildGhostHint } from "./ghostHint";
import {
  ParentheticalEditing,
  PARENTHETICAL_PLACEHOLDER,
} from "./parenthetical";
import { EMPTY_OUTLINE } from "./outline";
import type { ElementType } from "./elements";
import type { Outline } from "@/types/screenplay";
import type { NSpell } from "nspell";
import type { DuetSession } from "@/lib/collab/duet";

/** Hint shown on the current empty line, tailored to its element type. */
function placeholderFor(element: ElementType): string {
  switch (element) {
    case "scene_heading":
      return "INT. / EXT. LOCATION - TIME";
    case "character":
      return "CHARACTER NAME";
    case "parenthetical":
      return `(${PARENTHETICAL_PLACEHOLDER})`;
    case "dialogue":
      return "What they say…";
    case "transition":
      return "CUT TO:";
    default:
      return "Action: describe what we see.";
  }
}

/**
 * Assembles the full editor schema + behavior.
 *
 * We deliberately do NOT use TipTap's StarterKit. StarterKit brings paragraphs,
 * headings, lists, blockquotes, bold/italic, etc. None belong in a
 * strict screenplay document. A small, hand-picked extension list is what keeps
 * the schema enforceable, which is what makes Fountain/FDX export reliable.
 *
 *   Document     the top node, forced to be a sequence of screenplay lines
 *   Text         inline text
 *   ScreenplayLine  the one block node (carries the element type)
 *   ScreenplayKeymap  Enter/Tab/Cmd-number behavior
 *   AutoCaps     uppercases scene headings, character cues, transitions
 *   UndoRedo     local history, replaced by Yjs history while collaborative
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
  /** Live read of the user's auto-(CONT'D) toggle. */
  isContdEnabled?: () => boolean;
  /** Live read of the breakdown element catalog (for in-script highlighting). */
  getBreakdownItems?: () => BreakdownItem[];
  /** Live read of the user's breakdown-highlight toggle. */
  isBreakdownEnabled?: () => boolean;
  /** Show the onboarding ghost line on a brand-new empty screenplay (2D.3). */
  showGhostHint?: boolean;
  /** A shared Yjs binding. Its presence replaces local history and adds carets. */
  collaboration?: Pick<DuetSession, "doc" | "provider" | "user">;
}) {
  const getOutline = opts?.getOutline ?? (() => EMPTY_OUTLINE);
  const extensions: AnyExtension[] = [
    // Override the document's content rule so the only thing allowed at the top
    // level is one-or-more screenplay lines. Nothing else can sneak in.
    Document.extend({ content: "screenplayLine+" }),
    Text,
    ScreenplayLine,
    ParentheticalEditing,
    ScreenplayKeymap,
    AutoCaps,
    SmartCaps,
    AutoElement,
    ElementIcons,
    // Autocomplete carries priority 200 so its keydown handler runs before the
    // keymap; it only consumes keys while its menu is open.
    buildAutocomplete(getOutline, opts?.onAutocompleteState),
    FindReplace,
    Gapcursor,
    Dropcursor,
    Placeholder.configure({
      includeChildren: false,
      placeholder: ({ node }) =>
        placeholderFor((node.attrs.element as ElementType) ?? "action"),
    }),
  ];
  if (opts?.collaboration) {
    extensions.push(
      Collaboration.configure({
        document: opts.collaboration.doc,
        field: "default",
        provider: opts.collaboration.provider,
      }),
      CollaborationCaret.configure({
        provider: opts.collaboration.provider,
        user: opts.collaboration.user,
      })
    );
  } else {
    // Collaboration owns undo/redo through Yjs. Installing both history
    // systems produces incorrect undo boundaries and can replay remote work.
    extensions.push(UndoRedo);
  }
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
  // Auto (CONT'D) markers, gated by a live-read toggle.
  if (opts?.isContdEnabled) {
    extensions.push(buildContdMarkers(opts.isContdEnabled));
  }
  // In-script breakdown highlights, gated by a live-read toggle.
  if (opts?.getBreakdownItems) {
    extensions.push(
      buildBreakdownMarks(opts.getBreakdownItems, opts.isBreakdownEnabled ?? (() => true))
    );
  }
  // Onboarding ghost line for a new empty screenplay (widget decoration).
  if (opts?.showGhostHint) {
    extensions.push(buildGhostHint(true));
  }
  return extensions;
}
