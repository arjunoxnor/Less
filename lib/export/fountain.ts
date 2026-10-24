import type { ElementType } from "@/lib/editor/elements";
import type { ScriptLine, TextStyleRun } from "@/types/screenplay";
import { ensureParentheticalParens } from "./flatten";
import { isPlainStyle, normalizeRuns, segments } from "./styleRuns";
import { hasTitlePage, type TitlePage } from "./titlePage";

/**
 * Fountain (https://fountain.io) serializer and parser, both working on the
 * flat ScriptLine[] form.
 *
 * The load-bearing rule of Fountain is that element type is inferred from a
 * line's content AND the blank lines around it. Two facts drive everything
 * here:
 *
 *   - A Character cue is an uppercase line with a blank line BEFORE and NO
 *     blank line after; a Scene Heading / Transition is uppercase with a blank
 *     line before AND after. So the cue, its parenthetical and its dialogue are
 *     emitted as ONE block (single newlines, no blank between) and every other
 *     element gets a blank line on each side.
 *   - Where auto-detection would misfire (a heading that is not INT/EXT, a
 *     mixed-case character name, an uppercase action paragraph, a transition
 *     that does not end in "TO:") we emit a forcing prefix (".", "@", "!", ">")
 *     so the file round-trips back to the same element type.
 */

/** A heading that starts with one of these auto-detects without a "." prefix. */
const SCENE_PREFIX = /^(INT|EXT|EST|INT\.?\/EXT|INT\/EXT|I\/E)[.\s]/i;

/**
 * The recognized Fountain title-page keys. A leading "Key: value" block is only
 * treated as a title page when its key is one of these, so an ordinary first
 * line that merely contains a colon (a slug, a line of action, a transition) is
 * never mistaken for a title page and dropped.
 */
const TITLE_PAGE_KEYS: ReadonlySet<string> = new Set([
  "title",
  "credit",
  "author",
  "authors",
  "source",
  "draft date",
  "contact",
  "copyright",
  "notes",
]);

/** True if every cased letter in the text is uppercase and there is >=1 letter. */
function isAllCaps(text: string): boolean {
  return text.toUpperCase() !== text.toLowerCase() && text === text.toUpperCase();
}

/**
 * Backslash-escape syntax that would otherwise be consumed by our importer.
 * Besides emphasis, this protects literal notes/boneyards and terminal markers
 * whose position carries Fountain meaning.
 */
function escapeInline(text: string): string {
  return escapeLine(escapeChars(text));
}

/** The character escapes: backslashes, emphasis markers, notes and boneyards. */
function escapeChars(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\/\*/g, "\\/*")
    .replace(/\[\[/g, "\\[[")
    .replace(/([*_])/g, "\\$1");
}

/** The line escapes: a leading control character, a trailing ^ or <. */
function escapeLine(escaped: string): string {
  let out = escaped;
  if (/^[.@!>~#=]/.test(out)) out = `\\${out}`;
  if (out.endsWith("^")) out = `${out.slice(0, -1)}\\^`;
  if (out.endsWith("<")) out = `${out.slice(0, -1)}\\<`;
  return out;
}

/**
 * A line's text as Fountain with its formatting written as emphasis:
 * *italic*, **bold**, ***bold italic***, _underline_ (Fountain has no
 * highlight, so a highlight is left out). Spaces at a styled stretch's edges
 * go outside its markers, where Fountain looks for them.
 */
function emphasized(text: string, marks: TextStyleRun[] | undefined): string {
  if (!marks?.length) return escapeInline(text);
  let body = "";
  for (const { text: piece, style } of segments(text, marks)) {
    const esc = escapeChars(piece);
    const core = esc.trim();
    const shown = { ...style, highlight: undefined };
    if (isPlainStyle(shown) || !core) {
      body += esc;
      continue;
    }
    const lead = esc.slice(0, esc.length - esc.trimStart().length);
    const trail = esc.slice(esc.trimEnd().length);
    const stars = style.bold && style.italic ? "***" : style.bold ? "**" : style.italic ? "*" : "";
    const open = (style.underline ? "_" : "") + stars;
    const close = stars + (style.underline ? "_" : "");
    body += lead + open + core + close + trail;
  }
  return escapeLine(body);
}

/**
 * Strip Fountain inline emphasis (*ital* **bold** ***both*** _underline_)
 * down to plain text, unescaping backslash-escaped markers. Only markers that
 * come in a matching pair are emphasis: a lone "*" or "_" (an email address,
 * a URL, "5 * 3", a "____" blank to fill in) is text and is kept.
 */
function stripInline(text: string): string {
  return parseInline(text).text;
}

// Placeholders that switch a style on and off while the emphasis is read.
const BOLD_MARK = "\uE010";
const ITALIC_MARK = "\uE011";
const UNDERLINE_MARK = "\uE012";

/**
 * Fountain inline emphasis read as formatting: the text without its markers,
 * and the stretches that were bold, italic or underlined. The same pairing
 * rules as before (a lone "*" or "_" is text).
 */
function parseInline(text: string): { text: string; marks: TextStyleRun[] } {
  const held: string[] = [];
  // Escaped markers are set aside first, so they never pair up.
  const hold = (c: string) => {
    held.push(c);
    return `\uE000${held.length - 1}\uE001`;
  };
  const B = BOLD_MARK;
  const I = ITALIC_MARK;
  const U = UNDERLINE_MARK;
  let t = text.replace(/\\([\\*_/.@!>~#=[\]^<])/g, (_, c: string) => hold(c));
  t = t.replace(/\*\*\*(?=[^\s*])(.+?)(?<=[^\s*])\*\*\*/g, `${B}${I}$1${I}${B}`);
  t = t.replace(/\*\*(?=[^\s*])(.+?)(?<=[^\s*])\*\*/g, `${B}$1${B}`);
  t = t.replace(/\*(?=[^\s*])(.+?)(?<=[^\s*])\*/g, `${I}$1${I}`);
  t = t.replace(/(^|[^\p{L}\p{N}_])_(?=[^\s_])(.+?)(?<=[^\s_])_(?=$|[^\p{L}\p{N}_])/gu, `$1${U}$2${U}`);
  t = t.replace(/\uE000(\d+)\uE001/g, (_, n: string) => held[Number(n)]);
  let out = "";
  const runs: TextStyleRun[] = [];
  let bold = false;
  let italic = false;
  let underline = false;
  for (const ch of t) {
    if (ch === B) bold = !bold;
    else if (ch === I) italic = !italic;
    else if (ch === U) underline = !underline;
    else {
      const from = out.length;
      out += ch;
      if (bold || italic || underline) {
        runs.push({
          from,
          to: out.length,
          ...(bold ? { bold: true as const } : {}),
          ...(italic ? { italic: true as const } : {}),
          ...(underline ? { underline: true as const } : {}),
        });
      }
    }
  }
  return { text: out, marks: normalizeRuns(runs, out.length) };
}

/** A parsed line, with its formatting when it has any. */
function lineOf(element: ElementType, value: string, dual = false): ScriptLine {
  const { text, marks } = parseInline(value);
  const line: ScriptLine = dual ? { element, text, dual: true } : { element, text };
  if (marks.length) line.marks = marks;
  return line;
}

/**
 * An action line whose text would be misread on re-import needs the "!" force
 * prefix: an all-caps line reads as a character cue, and a line starting with a
 * Fountain control character (. @ ! > ~ # =) or wrapped in parentheses reads as
 * a heading / cue / transition / lyric / section / parenthetical. "!" forces
 * Action and is stripped cleanly on import.
 */
function actionNeedsForce(text: string): boolean {
  const t = text.trim();
  const key = /^([^:]+):/.exec(t)?.[1].trim().toLowerCase();
  return isAllCaps(t) || /^[.@!>~#=(]/.test(t) || (key != null && TITLE_PAGE_KEYS.has(key));
}

/** True when the last non-space character is not backslash-escaped. */
function hasTerminalMarker(text: string, marker: string): boolean {
  let end = text.length - 1;
  while (end >= 0 && /\s/.test(text[end])) end--;
  if (end < 0 || text[end] !== marker) return false;
  let slashes = 0;
  for (let i = end - 1; i >= 0 && text[i] === "\\"; i--) slashes++;
  return slashes % 2 === 0;
}

function removeTerminalMarker(text: string, marker: string): string {
  if (!hasTerminalMarker(text, marker)) return text;
  return text.replace(new RegExp(`\\${marker}\\s*$`), "").trimEnd();
}

// ---------------------------------------------------------------------------
// Export: ScriptLine[] -> Fountain
// ---------------------------------------------------------------------------

/** Emit a Fountain title-page block (Key: value lines), or "" when empty. */
function toFountainTitlePage(tp: TitlePage): string {
  const out: string[] = [];
  const emit = (key: string, value: string | undefined) => {
    if (!value) return;
    const parts = value.split("\n");
    if (parts.length === 1) {
      out.push(`${key}: ${escapeInline(parts[0])}`);
    } else {
      // Multi-line value: key on its own line, continuations indented 3 spaces.
      out.push(`${key}:`);
      for (const p of parts) out.push(`   ${escapeInline(p)}`);
    }
  };
  emit("Title", tp.title);
  emit("Credit", tp.credit);
  emit("Author", tp.author);
  emit("Source", tp.source);
  emit("Draft date", tp.draftDate);
  emit("Contact", tp.contact);
  emit("Copyright", tp.copyright);
  return out.join("\n");
}

/** A parenthetical with its brackets; its formatting kept when they were already there. */
function parenthetical(line: ScriptLine): string {
  const printed = ensureParentheticalParens(line.text);
  return printed === line.text ? emphasized(line.text, line.marks) : escapeInline(printed);
}

export function toFountain(lines: ScriptLine[], titlePage?: TitlePage | null): string {
  const blocks: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const { element, text, marks } = lines[i];

    if (element === "character") {
      // Start a cue cluster: the character line plus the parentheticals and
      // dialogue that immediately follow, joined by single newlines so they
      // re-import as one cue (no blank line breaks the cluster).
      // Always force a cue. Besides allowing mixed case, this keeps a literal
      // leading Fountain control character from being reclassified.
      const cue = `@${emphasized(text, marks)}`;
      // A dual (right-column) cue carries a trailing caret.
      const cluster: string[] = [lines[i].dual ? `${cue} ^` : cue];
      i++;
      while (
        i < lines.length &&
        (lines[i].element === "parenthetical" || lines[i].element === "dialogue")
      ) {
        const l = lines[i];
        cluster.push(
          l.element === "parenthetical"
            ? parenthetical(l)
            : l.text
              ? /^\(.*\)$/.test(l.text.trim())
                ? `~${emphasized(l.text, l.marks)}`
                : emphasized(l.text, l.marks)
              : "~"
        );
        i++;
      }
      blocks.push(cluster.join("\n"));
      continue;
    }

    switch (element) {
      case "scene_heading":
        blocks.push(SCENE_PREFIX.test(text) ? emphasized(text, marks) : `.${emphasized(text, marks)}`);
        break;
      case "transition": {
        const t = text.trim() === text ? emphasized(text, marks) : escapeInline(text.trim());
        blocks.push(/TO:$/.test(text.trim()) ? t : `>${t}`);
        break;
      }
      case "parenthetical":
        // Orphaned parenthetical (no preceding cue): keep it as its own block.
        blocks.push(parenthetical(lines[i]));
        break;
      case "dialogue":
        // Orphaned dialogue: keep it so nothing is lost.
        blocks.push(`~${emphasized(text, marks)}`);
        break;
      case "action":
      default:
        // Force with "!" any action line that would otherwise re-import as a
        // different element (all-caps cue, or a leading control character).
        blocks.push(
          text === "" || actionNeedsForce(text)
            ? `!${emphasized(text, marks)}`
            : emphasized(text, marks)
        );
        break;
    }
    i++;
  }

  const body = blocks.join("\n\n") + "\n";
  if (hasTitlePage(titlePage)) {
    return `${toFountainTitlePage(titlePage!)}\n\n${body}`;
  }
  return body;
}

// ---------------------------------------------------------------------------
// Import: Fountain -> ScriptLine[]
// ---------------------------------------------------------------------------

/** Parse a recognized leading title-page block into a TitlePage. */
function parseTitleBlock(blockLines: string[]): TitlePage {
  const map: Record<string, string[]> = {};
  let currentKey: string | null = null;
  for (const raw of blockLines) {
    if (/^(\s{2,}|\t)/.test(raw) && currentKey) {
      map[currentKey].push(raw.trim());
      continue;
    }
    const m = /^([^:]+):(.*)$/.exec(raw);
    if (!m) continue;
    currentKey = m[1].trim().toLowerCase();
    if (!map[currentKey]) map[currentKey] = [];
    const val = m[2].trim();
    if (val) map[currentKey].push(val);
  }
  const get = (k: string) =>
    map[k]?.length ? stripInline(map[k].join("\n")) : undefined;
  const tp: TitlePage = {};
  if (get("title")) tp.title = get("title");
  if (get("credit")) tp.credit = get("credit");
  if (get("author") ?? get("authors")) tp.author = get("author") ?? get("authors");
  if (get("source")) tp.source = get("source");
  if (get("draft date")) tp.draftDate = get("draft date");
  if (get("contact")) tp.contact = get("contact");
  if (get("copyright")) tp.copyright = get("copyright");
  return tp;
}

export function parseFountain(text: string): {
  lines: ScriptLine[];
  titlePage: TitlePage | null;
} {
  // Normalize newlines, then strip boneyard (spans line breaks) and inline
  // notes before any line-by-line work so neither pollutes the body.
  if (text.includes("\0")) {
    throw new Error("This Fountain file contains NUL bytes and cannot be read safely.");
  }
  let body = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/(?<!\\)\/\*[\s\S]*?\*\//g, "")
    .replace(/(?<!\\)\[\[[\s\S]*?\]\]/g, "");

  // Drop a leading title-page block, but ONLY when it genuinely is one: the
  // first non-blank line must be "Key: ..." with a recognized title-page key,
  // and must not be a forced element or a scene heading. Otherwise an ordinary
  // first paragraph that happens to contain a colon would be silently eaten.
  const rawLines = body.split("\n");
  let start = 0;
  while (start < rawLines.length && rawLines[start].trim() === "") start++;
  const firstLine = (start < rawLines.length ? rawLines[start] : "").trim();
  const keyMatch = /^([^:]+):/.exec(firstLine);
  const isForced = /^[.@!>~#=]/.test(firstLine);
  let titlePage: TitlePage | null = null;
  if (
    keyMatch &&
    !isForced &&
    !SCENE_PREFIX.test(firstLine) &&
    TITLE_PAGE_KEYS.has(keyMatch[1].trim().toLowerCase())
  ) {
    // The block ends at any visually blank line. Editors often leave spaces on
    // separator lines, and treating those as contact continuation eats the body.
    let j = start;
    while (j < rawLines.length && rawLines[j].trim() !== "") {
      j++;
    }
    const parsed = parseTitleBlock(rawLines.slice(start, j));
    // Only strip the block from the body when it actually yields a title page,
    // so a leading "Key:" line with no mapped value is never silently dropped.
    if (hasTitlePage(parsed)) {
      titlePage = parsed;
      body = rawLines.slice(j).join("\n");
    }
  }

  const all = body.split("\n");
  const out: ScriptLine[] = [];
  let inDialogue = false;
  // True while inside a dual (right-column) cue cluster, set by a "^" caret.
  let inDual = false;

  const isBlank = (idx: number) =>
    idx < 0 || idx >= all.length || all[idx].trim() === "";

  for (let idx = 0; idx < all.length; idx++) {
    const raw = all[idx];
    if (raw.trim() === "") {
      inDialogue = false;
      inDual = false;
      continue;
    }

    const prevBlank = isBlank(idx - 1);
    const nextBlank = isBlank(idx + 1);
    const line = raw.trim();

    const push = (element: ElementType, rawValue: string, dual = false) => {
      // A scene number written into the heading ("INT. HOUSE - DAY #12A#") is
      // not part of its text: LESS numbers scenes itself.
      const value = element === "scene_heading" ? rawValue.replace(/\s*#[^#\s]+#\s*$/, "") : rawValue;
      out.push(lineOf(element, value, dual));
    };

    // 1. Forced markers (highest priority).
    if (line.startsWith(".") && !line.startsWith("..")) {
      // Single leading "." forces a scene heading; ".." / "..." do not.
      push("scene_heading", line.slice(1));
      inDialogue = false;
      inDual = false;
      continue;
    }
    if (line.startsWith("@")) {
      const cueBody = line.slice(1).trim();
      const isDual = hasTerminalMarker(cueBody, "^");
      push("character", removeTerminalMarker(cueBody, "^"), isDual);
      inDialogue = true;
      inDual = isDual;
      continue;
    }
    if (line.startsWith("!")) {
      // Action forced with "!"; preserve leading whitespace after the marker.
      out.push(lineOf("action", raw.replace(/^\s*!/, "")));
      inDialogue = false;
      inDual = false;
      continue;
    }
    if (line.startsWith(">") && !hasTerminalMarker(line, "<")) {
      push("transition", line.slice(1).trim());
      inDialogue = false;
      inDual = false;
      continue;
    }

    // 2. Centered text ">...<" is an Action element per spec.
    if (line.startsWith(">") && hasTerminalMarker(line, "<")) {
      push("action", line.slice(1, -1).trim());
      inDialogue = false;
      inDual = false;
      continue;
    }

    // 3. Drop-only structural markers: sections, synopses, page breaks.
    if (line.startsWith("#") || /^=\s/.test(line) || /^=+$/.test(line)) {
      inDialogue = false;
      inDual = false;
      continue;
    }

    // 4. Lyrics map to dialogue.
    if (line.startsWith("~")) {
      push("dialogue", line.slice(1).trim(), inDual);
      inDialogue = true;
      continue;
    }

    // 5. Scene heading (auto): INT/EXT prefix, blank line before and after.
    if (SCENE_PREFIX.test(line) && prevBlank && nextBlank) {
      push("scene_heading", line);
      inDialogue = false;
      inDual = false;
      continue;
    }

    // 6. Parenthetical: any line wrapped entirely in parentheses. (Not gated on
    //    inDialogue, so an orphaned parenthetical round-trips as a parenthetical
    //    rather than degrading to action.)
    if (/^\(.*\)$/.test(line)) {
      push("parenthetical", line, inDual);
      inDialogue = true;
      continue;
    }

    // 7. Character (auto): uppercase (allowing a lower-case extension), a blank
    //    line before, and NO blank line after. A trailing "^" marks a dual cue.
    const isDual = hasTerminalMarker(line, "^");
    const lineNoCaret = removeTerminalMarker(line, "^");
    const core = lineNoCaret.replace(/\s*\([^)]*\)\s*$/, "");
    if (isAllCaps(core) && prevBlank && !nextBlank) {
      push("character", lineNoCaret, isDual);
      inDialogue = true;
      inDual = isDual;
      continue;
    }

    // 8. Transition (auto): uppercase ending in "TO:", blank lines around.
    if (isAllCaps(line) && /TO:$/.test(line) && prevBlank && nextBlank) {
      push("transition", line);
      inDialogue = false;
      inDual = false;
      continue;
    }

    // 9. Dialogue continuation.
    if (inDialogue) {
      push("dialogue", line, inDual);
      continue;
    }

    // 10. Default: action (trim a trailing newline artifact only).
    out.push(lineOf("action", raw.replace(/\s+$/, "")));
  }

  return { lines: out, titlePage };
}
