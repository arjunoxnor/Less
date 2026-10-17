/**
 * What a document IS, for the desk: a script, a treatment, a one-pager and so
 * on. The storage type (screenplay / plain / board / voice) decides the editor;
 * the kind decides the cover and the label. Screenplays, boards and voice notes
 * have one kind each. A plain document can be any of the prose kinds, chosen by
 * the writer, or, until they choose, read from its title and the folders it
 * sits in (a document filed under "One Pagers" is a one-pager).
 */

export type DocKind =
  | "script"
  | "treatment"
  | "onepager"
  | "outline"
  | "characters"
  | "notes"
  | "document"
  | "board"
  | "voice";

/** The kinds a plain document can be. */
export const PROSE_KINDS: readonly DocKind[] = [
  "treatment",
  "onepager",
  "outline",
  "characters",
  "notes",
  "document",
];

export const ALL_KINDS: readonly DocKind[] = ["script", ...PROSE_KINDS, "board", "voice"];

export const KIND_LABEL: Record<DocKind, string> = {
  script: "Script",
  treatment: "Treatment",
  onepager: "One-pager",
  outline: "Outline",
  characters: "Characters",
  notes: "Notes",
  document: "Document",
  board: "Board",
  voice: "Voice note",
};

/** Plural labels for counts ("3 one-pagers"). */
export const KIND_PLURAL: Record<DocKind, string> = {
  script: "scripts",
  treatment: "treatments",
  onepager: "one-pagers",
  outline: "outlines",
  characters: "character docs",
  notes: "notes",
  document: "documents",
  board: "boards",
  voice: "voice notes",
};

export function isDocKind(v: unknown): v is DocKind {
  return typeof v === "string" && (ALL_KINDS as readonly string[]).includes(v);
}

export function isProseKind(v: unknown): v is DocKind {
  return typeof v === "string" && (PROSE_KINDS as readonly string[]).includes(v);
}

// Checked in order; the first match wins. Words, not substrings, so "Outlines
// of the Coast" in a title still reads as an outline but "Pitchfork" does not
// read as a pitch.
const RULES: Array<[RegExp, DocKind]> = [
  [/\b(one[\s-]?pagers?|1[\s-]?pagers?|one[\s-]?sheets?|pitch(es)?|log\s?lines?|synops[ie]s)\b/i, "onepager"],
  [/\btreatments?\b/i, "treatment"],
  [/\b(outlines?|beat[\s-]?sheets?|beats|step[\s-]?outlines?|scene[\s-]?lists?)\b/i, "outline"],
  [/\b(characters?|character[\s-]?bios?|cast)\b/i, "characters"],
  [/\b(notes?|ideas?|research|brainstorm(ing)?|thoughts|jots?)\b/i, "notes"],
];

/** A prose kind read from a title, or null when the title says nothing. */
export function kindFromWords(text: string): DocKind | null {
  for (const [re, kind] of RULES) if (re.test(text)) return kind;
  return null;
}

/**
 * The kind to show. `kind` is the writer's explicit choice (plain docs only);
 * `folderNames` runs from the document's own folder outward.
 */
export function kindOf(
  type: string,
  title: string,
  kind?: string | null,
  folderNames: readonly string[] = []
): DocKind {
  if (type === "screenplay") return "script";
  if (type === "board") return "board";
  if (type === "voice") return "voice";
  if (isProseKind(kind)) return kind;
  const fromTitle = kindFromWords(title);
  if (fromTitle) return fromTitle;
  for (const name of folderNames) {
    const fromFolder = kindFromWords(name);
    if (fromFolder) return fromFolder;
  }
  return "document";
}
