import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { cueBaseName } from "./outline";

/**
 * Rename a character everywhere: their cues, and optionally their mentions in
 * action and dialogue. Renaming runs as a single transaction (one undo) with a
 * mandatory preview-then-confirm step in the UI.
 *
 * Mentions are matched on Unicode word boundaries so renaming "AL" never
 * touches "ALICE" or "PAL", and they default OFF behind a checkbox because a
 * short name can collide with ordinary words.
 */

export interface RenamePlan {
  cues: number;
  mentions: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word, case-insensitive matcher for a name (Unicode aware). */
function mentionRegex(name: string): RegExp {
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`,
    "giu"
  );
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s;
}

/** Reproduce the casing of `original` on `replacement`. */
function matchCase(original: string, replacement: string): string {
  if (original === original.toUpperCase()) return replacement.toUpperCase();
  const rest = original.slice(1);
  if (original[0] === original[0]?.toUpperCase() && rest === rest.toLowerCase()) {
    return capitalize(replacement);
  }
  return replacement.toLowerCase();
}

function elementOf(node: PMNode): string {
  return (node.attrs as { element?: string }).element ?? "action";
}

/** Count what a rename would change, without mutating anything. */
export function previewRename(
  doc: PMNode,
  fromName: string,
  toName: string,
  opts: { includeMentions: boolean }
): RenamePlan {
  const from = fromName.trim();
  const to = toName.trim();
  if (!from || from === to) return { cues: 0, mentions: 0 };
  const fromUpper = from.toUpperCase();
  const re = opts.includeMentions ? mentionRegex(from) : null;

  let cues = 0;
  let mentions = 0;
  doc.forEach((node) => {
    const element = elementOf(node);
    const text = node.textContent;
    if (element === "character") {
      if (cueBaseName(text).toUpperCase() === fromUpper) cues++;
    } else if (re && (element === "action" || element === "dialogue")) {
      const found = text.match(re);
      if (found) mentions += found.length;
    }
  });
  return { cues, mentions };
}

/** Apply the rename as one transaction and report how much changed. */
export function renameCharacterEverywhere(
  view: EditorView,
  fromName: string,
  toName: string,
  opts: { includeMentions: boolean }
): RenamePlan {
  const from = fromName.trim();
  const to = toName.trim();
  // Nothing to do (and no empty undo step) when renaming to the same name.
  if (!from || !to || from === to) return { cues: 0, mentions: 0 };

  const fromUpper = from.toUpperCase();
  const re = opts.includeMentions ? mentionRegex(from) : null;
  const doc = view.state.doc;
  const edits: { from: number; to: number; text: string }[] = [];
  let cues = 0;
  let mentions = 0;

  doc.forEach((node, offset) => {
    const element = elementOf(node);
    const text = node.textContent;
    const base = offset + 1;

    if (element === "character") {
      const baseName = cueBaseName(text);
      if (baseName && baseName.toUpperCase() === fromUpper) {
        // Replace only the leading base-name span, preserving any extension.
        const lead = text.length - text.trimStart().length;
        const start = base + lead;
        edits.push({ from: start, to: start + baseName.length, text: to.toUpperCase() });
        cues++;
      }
    } else if (re && (element === "action" || element === "dialogue")) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const start = base + m.index;
        edits.push({ from: start, to: start + m[0].length, text: matchCase(m[0], to) });
        mentions++;
      }
    }
  });

  if (edits.length === 0) return { cues: 0, mentions: 0 };

  // Apply right-to-left so positions computed against the original doc stay valid.
  edits.sort((a, b) => b.from - a.from);
  const tr = view.state.tr;
  for (const e of edits) tr.insertText(e.text, e.from, e.to);
  tr.setMeta("addToHistory", true);
  view.dispatch(tr);

  return { cues, mentions };
}
