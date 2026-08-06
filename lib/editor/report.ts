import type { Outline } from "@/types/screenplay";

/**
 * Production reports derived from the outline + the real page count: statistics,
 * a scene list, a character breakdown, and a location breakdown. Pure functions
 * over data the editor already computes, plus a plain-text serializer for export.
 */

export interface ScriptReport {
  stats: {
    scenes: number;
    pages: number;
    runtimeMin: number;
    speakingCharacters: number;
    locations: number;
    words: number;
    intCount: number;
    extCount: number;
  };
  scenes: { number: number; heading: string; page: number | null }[];
  characters: { name: string; lines: number; scenes: number }[];
  locations: { name: string; scenes: number }[];
}

export function buildReport(
  outline: Outline,
  pageCount: number,
  words: number
): ScriptReport {
  const speakingCast = outline.cast.filter((character) => character.lines > 0);
  let intCount = 0;
  let extCount = 0;
  for (const s of outline.scenes) {
    const h = s.heading.toUpperCase().trimStart();
    if (h.startsWith("INT")) intCount++;
    else if (h.startsWith("EXT")) extCount++;
    else if (h.startsWith("I/E") || h.startsWith("INT./EXT")) intCount++;
  }
  return {
    stats: {
      scenes: outline.scenes.length,
      pages: pageCount,
      runtimeMin: pageCount,
      speakingCharacters: speakingCast.length,
      locations: outline.locations.length,
      words,
      intCount,
      extCount,
    },
    scenes: outline.scenes.map((s) => ({ number: s.number, heading: s.heading, page: s.page })),
    characters: speakingCast.map((c) => ({ name: c.name, lines: c.lines, scenes: c.scenes })),
    locations: outline.locations.map((l) => ({ name: l.name, scenes: l.scenes })),
  };
}

/** A plain-text rendering of the report for download. House-clean copy. */
export function reportToText(r: ScriptReport, title: string): string {
  const L: string[] = [];
  L.push(title || "Screenplay", "");
  L.push("STATISTICS");
  L.push(`  Pages: ${r.stats.pages} (about ${r.stats.runtimeMin} min)`);
  L.push(
    `  Scenes: ${r.stats.scenes} (${r.stats.intCount} INT, ${r.stats.extCount} EXT)`
  );
  L.push(`  Speaking characters: ${r.stats.speakingCharacters}`);
  L.push(`  Locations: ${r.stats.locations}`);
  L.push(`  Words: ${r.stats.words}`);
  L.push("", "SCENES");
  for (const s of r.scenes) {
    L.push(`  ${s.number}. ${s.heading}${s.page ? `  (p. ${s.page})` : ""}`);
  }
  L.push("", "CHARACTERS");
  for (const c of r.characters) {
    L.push(`  ${c.name}: ${c.lines} lines, ${c.scenes} scenes`);
  }
  L.push("", "LOCATIONS");
  for (const l of r.locations) {
    L.push(`  ${l.name}: ${l.scenes} scenes`);
  }
  return L.join("\n") + "\n";
}
