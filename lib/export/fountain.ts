import type { ElementType } from "@/lib/editor/elements";
import type { ScriptLine } from "@/types/screenplay";
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
  return /[A-Za-z]/.test(text) && text === text.toUpperCase();
}

/** Backslash-escape literal emphasis markers so they survive a round trip. */
function escapeInline(text: string): string {
  return text.replace(/([*_])/g, "\\$1");
}

/**
 * Strip Fountain inline emphasis (*ital* **bold** _underline_) down to plain
 * text, while unescaping any backslash-escaped markers. LESS stores no inline
 * styling, so import yields clean text. Scans character by character so a
 * "\*" survives as a literal "*" but a bare "*" is removed.
 */
function stripInline(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\" && (text[i + 1] === "*" || text[i + 1] === "_")) {
      out += text[i + 1];
      i++;
      continue;
    }
    if (ch === "*" || ch === "_") continue;
    out += ch;
  }
  return out;
}

/** Wrap parenthetical text in parentheses if it is not already wrapped. */
function ensureParens(text: string): string {
  const t = text.trim();
  return /^\(.*\)$/.test(t) ? t : `(${t})`;
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
      out.push(`${key}: ${parts[0]}`);
    } else {
      // Multi-line value: key on its own line, continuations indented 3 spaces.
      out.push(`${key}:`);
      for (const p of parts) out.push(`   ${p}`);
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

export function toFountain(lines: ScriptLine[], titlePage?: TitlePage | null): string {
  const blocks: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const { element, text } = lines[i];

    if (element === "character") {
      // Start a cue cluster: the character line plus the parentheticals and
      // dialogue that immediately follow, joined by single newlines so they
      // re-import as one cue (no blank line breaks the cluster).
      const cluster: string[] = [isAllCaps(text) ? text : `@${text}`];
      i++;
      while (
        i < lines.length &&
        (lines[i].element === "parenthetical" || lines[i].element === "dialogue")
      ) {
        const l = lines[i];
        cluster.push(
          l.element === "parenthetical" ? ensureParens(l.text) : escapeInline(l.text)
        );
        i++;
      }
      blocks.push(cluster.join("\n"));
      continue;
    }

    switch (element) {
      case "scene_heading":
        blocks.push(SCENE_PREFIX.test(text) ? text : `.${text}`);
        break;
      case "transition":
        blocks.push(/TO:$/.test(text.trim()) ? text.trim() : `>${text.trim()}`);
        break;
      case "parenthetical":
        // Orphaned parenthetical (no preceding cue): keep it as its own block.
        blocks.push(ensureParens(text));
        break;
      case "dialogue":
        // Orphaned dialogue: keep it so nothing is lost.
        blocks.push(escapeInline(text));
        break;
      case "action":
      default:
        // Force an uppercase action line with "!" so it is not read as a cue.
        blocks.push(isAllCaps(text) ? `!${escapeInline(text)}` : escapeInline(text));
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
  const get = (k: string) => (map[k]?.length ? map[k].join("\n") : undefined);
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
  let body = text
    .replace(/\r\n?/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\[\[[\s\S]*?\]\]/g, "");

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
    let j = start;
    while (j < rawLines.length && rawLines[j].trim() !== "") j++;
    const parsed = parseTitleBlock(rawLines.slice(start, j));
    titlePage = hasTitlePage(parsed) ? parsed : null;
    body = rawLines.slice(j).join("\n");
  }

  const all = body.split("\n");
  const out: ScriptLine[] = [];
  let inDialogue = false;

  const isBlank = (idx: number) =>
    idx < 0 || idx >= all.length || all[idx].trim() === "";

  for (let idx = 0; idx < all.length; idx++) {
    const raw = all[idx];
    if (raw.trim() === "") {
      inDialogue = false;
      continue;
    }

    const prevBlank = isBlank(idx - 1);
    const nextBlank = isBlank(idx + 1);
    const line = raw.trim();

    const push = (element: ElementType, value: string) => {
      out.push({ element, text: stripInline(value) });
    };

    // 1. Forced markers (highest priority).
    if (/^\.[A-Za-z0-9]/.test(line)) {
      // Single leading "." forces a scene heading; ".." / "..." do not.
      push("scene_heading", line.slice(1));
      inDialogue = false;
      continue;
    }
    if (line.startsWith("@")) {
      push("character", line.slice(1).trim());
      inDialogue = true;
      continue;
    }
    if (line.startsWith("!")) {
      // Action forced with "!"; preserve leading whitespace after the marker.
      out.push({ element: "action", text: stripInline(raw.replace(/^\s*!/, "")) });
      inDialogue = false;
      continue;
    }
    if (line.startsWith(">") && !line.endsWith("<")) {
      push("transition", line.slice(1).trim());
      inDialogue = false;
      continue;
    }

    // 2. Centered text ">...<" is an Action element per spec.
    if (line.startsWith(">") && line.endsWith("<")) {
      push("action", line.slice(1, -1).trim());
      inDialogue = false;
      continue;
    }

    // 3. Drop-only structural markers: sections, synopses, page breaks.
    if (line.startsWith("#") || /^=\s/.test(line) || /^=+$/.test(line)) {
      inDialogue = false;
      continue;
    }

    // 4. Lyrics map to dialogue.
    if (line.startsWith("~")) {
      push("dialogue", line.slice(1).trim());
      inDialogue = true;
      continue;
    }

    // 5. Scene heading (auto): INT/EXT prefix, blank line before and after.
    if (SCENE_PREFIX.test(line) && prevBlank && nextBlank) {
      push("scene_heading", line);
      inDialogue = false;
      continue;
    }

    // 6. Parenthetical: any line wrapped entirely in parentheses. (Not gated on
    //    inDialogue, so an orphaned parenthetical round-trips as a parenthetical
    //    rather than degrading to action.)
    if (/^\(.*\)$/.test(line)) {
      push("parenthetical", line);
      inDialogue = true;
      continue;
    }

    // 7. Character (auto): uppercase (allowing a lower-case extension), a blank
    //    line before, and NO blank line after.
    const core = line.replace(/\s*\([^)]*\)\s*$/, "");
    if (isAllCaps(core) && prevBlank && !nextBlank) {
      push("character", line.replace(/\s*\^\s*$/, "")); // drop dual-dialogue caret
      inDialogue = true;
      continue;
    }

    // 8. Transition (auto): uppercase ending in "TO:", blank lines around.
    if (isAllCaps(line) && /TO:$/.test(line) && prevBlank && nextBlank) {
      push("transition", line);
      inDialogue = false;
      continue;
    }

    // 9. Dialogue continuation.
    if (inDialogue) {
      push("dialogue", line);
      continue;
    }

    // 10. Default: action (trim a trailing newline artifact only).
    out.push({ element: "action", text: stripInline(raw.replace(/\s+$/, "")) });
  }

  return { lines: out, titlePage };
}
