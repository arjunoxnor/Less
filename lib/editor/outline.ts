import type { Node as PMNode } from "@tiptap/pm/model";
import { isElementType } from "@/lib/export/flatten";
import type {
  CastEntry,
  CharacterEntry,
  LocationEntry,
  NoteEntry,
  Outline,
  SceneEntry,
  TransitionEntry,
} from "@/types/screenplay";
import type { ElementType } from "@/lib/editor/elements";

/**
 * Pure, editor-agnostic derivation. One walk of the document yields everything
 * the navigation panels and autocomplete need: ordered scenes (with jump
 * positions), the locations and character names used so far, and the cast list.
 *
 * Kept free of React and ProseMirror commands so it is trivially testable and
 * can run on any ProseMirror Node.
 */

/**
 * A rough page estimate for the scene-navigator badges only: ~55 NON-BLANK
 * lines. This is intentionally distinct from the geometry-exact LINES_PER_PAGE
 * (54, counting blanks and (MORE) markers) in lib/export/layout.ts that drives
 * the PDF and the status-bar count. The badges are estimates; a follow-up can
 * have buildOutline consume the pagination engine so they match the export.
 */
const LINES_PER_PAGE = 55;

/**
 * Standard times of day, multi-word entries first so "MOMENTS LATER" is matched
 * before "LATER". Used to split a slugline's time-of-day off the location and
 * to power time-of-day autocomplete.
 */
export const TIME_OF_DAY: readonly string[] = [
  "MOMENTS LATER",
  "CONTINUOUS",
  "LATER",
  "DAY",
  "NIGHT",
  "MORNING",
  "EVENING",
  "AFTERNOON",
  "DAWN",
  "DUSK",
  "SUNSET",
  "SUNRISE",
];

/** Leading slugline prefix (INT./EXT./EST./I/E and the combined forms). */
const SLUG_PREFIX = /^\s*(INT\.?\/EXT\.?|EXT\.?\/INT\.?|I\/E\.?|INT\.?|EXT\.?|EST\.?)\b[.\s-]*/i;

/** Separator between location and time-of-day in a slugline. */
const TIME_SEP = /\s+-{1,2}\s+/g;

/**
 * Split a scene heading into its location and time-of-day. Returns an empty
 * location when the heading has no recognized slugline prefix (so non-sluglines
 * contribute nothing to the location list).
 */
export function parseLocation(heading: string): {
  location: string;
  time: string | null;
} {
  const m = SLUG_PREFIX.exec(heading);
  if (!m) return { location: "", time: null };

  const rest = heading.slice(m[0].length).trim();

  // Find the LAST " - " / " -- "; the segment after it may be a time of day.
  let lastIdx = -1;
  let lastLen = 0;
  TIME_SEP.lastIndex = 0;
  let sep: RegExpExecArray | null;
  while ((sep = TIME_SEP.exec(rest)) !== null) {
    lastIdx = sep.index;
    lastLen = sep[0].length;
  }

  if (lastIdx >= 0) {
    const before = rest.slice(0, lastIdx).trim();
    const after = rest.slice(lastIdx + lastLen).trim();
    const up = after.toUpperCase();
    const isTime = TIME_OF_DAY.some((t) => up === t || up.startsWith(t + " "));
    if (isTime) return { location: before, time: after };
  }

  // A "location" that is itself a bare time of day (e.g. "INT. - DAY", where the
  // prefix ate the dash) is not a real location: treat it as time-only so the
  // location list is not polluted with DAY / NIGHT / etc.
  if (TIME_OF_DAY.some((t) => rest.toUpperCase() === t)) {
    return { location: "", time: rest };
  }
  return { location: rest, time: null };
}

/**
 * The base character name, with any trailing extensions (V.O.), (O.S.),
 * (CONT'D) and a trailing scene number "#3" stripped. Returns the stored
 * (uppercase) casing.
 */
export function cueBaseName(cue: string): string {
  let s = cue.trim();
  let prev: string;
  do {
    prev = s;
    s = s
      .replace(/\s*\([^)]*\)\s*$/, "")
      .replace(/\s*#\d+\s*$/, "")
      .trim();
  } while (s !== prev);
  return s;
}

interface CharAccum {
  pos: number;
  lines: number;
  scenes: Set<number>;
  firstName: string;
  lastIndex: number;
  lastExtension?: string;
}

interface LocAccum {
  scenes: Set<number>;
  lastIndex: number;
}

/** Find the last " - " / " -- " separator in a location, splitting parent/sub. */
function splitSubLocation(location: string): { parent: string; sub: string } | null {
  let lastIdx = -1;
  let lastLen = 0;
  TIME_SEP.lastIndex = 0;
  let sep: RegExpExecArray | null;
  while ((sep = TIME_SEP.exec(location)) !== null) {
    lastIdx = sep.index;
    lastLen = sep[0].length;
  }
  if (lastIdx <= 0) return null;
  const parent = location.slice(0, lastIdx).trim();
  const sub = location.slice(lastIdx + lastLen).trim();
  if (!parent || !sub) return null;
  return { parent, sub };
}

/** Walk the document once and derive the full outline. */
export function buildOutline(doc: PMNode): Outline {
  const scenes: SceneEntry[] = [];
  const locMap = new Map<string, LocAccum>();
  const subLocMap = new Map<string, Set<string>>();
  const transMap = new Map<string, TransitionEntry>();
  const charMap = new Map<string, CharAccum>();
  const notes: NoteEntry[] = [];

  let sceneCounter = 0;
  let printedLines = 0;
  let currentSpeaker: string | null = null;

  doc.forEach((node, offset, index) => {
    const raw = (node.attrs as { element?: unknown }).element;
    const element = isElementType(raw) ? raw : "action";
    const text = node.textContent.trim();
    const pos = offset + 1; // inside the line's content

    const noteText = (node.attrs as { note?: unknown }).note;
    if (typeof noteText === "string" && noteText.trim()) {
      notes.push({ note: noteText, lineText: text, pos, element: element as ElementType });
    }

    if (element === "scene_heading") {
      sceneCounter++;
      scenes.push({
        number: sceneCounter,
        heading: text,
        pos,
        lineIndex: index,
        page: Math.floor(printedLines / LINES_PER_PAGE) + 1,
      });
      const { location } = parseLocation(text);
      if (location) {
        const key = location.toUpperCase();
        let le = locMap.get(key);
        if (!le) {
          le = { scenes: new Set(), lastIndex: index };
          locMap.set(key, le);
        }
        le.scenes.add(sceneCounter);
        le.lastIndex = index;
        // Record the sub-location under its parent (HOUSE -> KITCHEN), so a
        // later "INT. HOUSE - " can suggest the rooms used before.
        const split = splitSubLocation(location);
        if (split) {
          const pkey = split.parent.toUpperCase();
          if (!subLocMap.has(pkey)) subLocMap.set(pkey, new Set());
          subLocMap.get(pkey)!.add(split.sub.toUpperCase());
        }
      }
      // A new scene ends the current speaker's block.
      currentSpeaker = null;
    } else if (element === "character") {
      const base = cueBaseName(text);
      if (base) {
        const key = base.toUpperCase();
        let entry = charMap.get(key);
        if (!entry) {
          entry = { pos, lines: 0, scenes: new Set(), firstName: base, lastIndex: index };
          charMap.set(key, entry);
        }
        // Attribute pre-heading cues to scene 1 (not the phantom scene 0).
        entry.scenes.add(Math.max(1, sceneCounter));
        entry.lastIndex = index;
        // Remember the trailing extension (V.O.) / (O.S.) so the cue-extension
        // autocomplete can pin this character's last-used one to the top.
        const ext = text.match(/\(([^)]*)\)\s*$/);
        if (ext) entry.lastExtension = "(" + ext[1].trim() + ")";
        currentSpeaker = key;
      } else {
        currentSpeaker = null;
      }
    } else if (element === "dialogue") {
      if (currentSpeaker) {
        const entry = charMap.get(currentSpeaker);
        if (entry) entry.lines++;
      }
    } else if (element === "action" || element === "transition") {
      // Action and transitions also end the current speaker's block, so a
      // dangling dialogue line is never miscounted against the prior speaker.
      currentSpeaker = null;
      if (element === "transition" && text) {
        const key = text.toUpperCase();
        const cur = transMap.get(key);
        if (cur) {
          cur.count++;
          cur.lastIndex = index;
        } else {
          transMap.set(key, { text, count: 1, lastIndex: index });
        }
      }
    }
    // parenthetical keeps the current speaker (CHARACTER -> PARENTHETICAL ->
    // DIALOGUE is one block).

    if (text !== "") printedLines++;
  });

  const charValues = [...charMap.values()];

  const cast: CastEntry[] = charValues
    .map((e) => ({ name: e.firstName, pos: e.pos, lines: e.lines, scenes: e.scenes.size }))
    .sort(
      (a, b) =>
        b.lines - a.lines || b.scenes - a.scenes || a.name.localeCompare(b.name)
    );

  const characters: CharacterEntry[] = charValues
    .map((e) => ({
      name: e.firstName,
      lines: e.lines,
      lastIndex: e.lastIndex,
      lastExtension: e.lastExtension,
    }))
    .sort((a, b) => b.lines - a.lines || a.name.localeCompare(b.name));

  const locations: LocationEntry[] = [...locMap.entries()]
    .map(([name, v]) => ({
      name,
      scenes: v.scenes.size,
      lastIndex: v.lastIndex,
      subLocations: [...(subLocMap.get(name) ?? [])],
    }))
    .sort((a, b) => b.scenes - a.scenes || a.name.localeCompare(b.name));

  const transitions: TransitionEntry[] = [...transMap.values()].sort(
    (a, b) => b.count - a.count || b.lastIndex - a.lastIndex
  );

  return { scenes, locations, characters, cast, transitions, notes };
}

/** An empty outline, used before an editor exists. */
export const EMPTY_OUTLINE: Outline = {
  scenes: [],
  locations: [],
  characters: [],
  cast: [],
  transitions: [],
  notes: [],
};
