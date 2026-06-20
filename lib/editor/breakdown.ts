/**
 * Production breakdown tagging.
 *
 * A breakdown is the first-AD's pass over a locked script: every physical thing
 * a scene needs (props, wardrobe, vehicles, stunts, effects...) is tagged and
 * rolled up per scene and per category so the production office can schedule and
 * budget. Here a "tag" is an element NAME under a category; the breakdown is
 * computed by scanning the script for each name, so it stays live as the script
 * changes (tag "REVOLVER" once and every scene that mentions it lights up).
 *
 * Pure and editor-agnostic: the decoration plugin, the panel, and the report all
 * read from these functions. No React, no ProseMirror.
 */

export interface BreakdownCategory {
  id: string;
  label: string;
  /** The conventional breakdown-sheet color, used for the in-script underline. */
  color: string;
}

/** The standard production breakdown categories, in sheet order. */
export const BREAKDOWN_CATEGORIES: BreakdownCategory[] = [
  { id: "cast", label: "Cast", color: "#d83a3a" },
  { id: "background", label: "Background", color: "#b67a00" },
  { id: "props", label: "Props", color: "#2f8f4e" },
  { id: "wardrobe", label: "Wardrobe", color: "#8a5cf6" },
  { id: "makeup", label: "Makeup / Hair", color: "#d6457f" },
  { id: "vehicles", label: "Vehicles", color: "#1f8fb0" },
  { id: "animals", label: "Animals", color: "#7a8a1f" },
  { id: "sfx", label: "Special Effects", color: "#e2680f" },
  { id: "sound", label: "Sound", color: "#5a6cc0" },
  { id: "setdressing", label: "Set Dressing", color: "#9a6b3f" },
  { id: "stunts", label: "Stunts", color: "#b02a2a" },
  { id: "vfx", label: "Visual Effects", color: "#0f9aa0" },
  { id: "equipment", label: "Special Equipment", color: "#6b7280" },
];

const CATEGORY_BY_ID = new Map(BREAKDOWN_CATEGORIES.map((c) => [c.id, c]));
const CATEGORY_ORDER = new Map(BREAKDOWN_CATEGORIES.map((c, i) => [c.id, i]));

export function categoryById(id: string): BreakdownCategory | undefined {
  return CATEGORY_BY_ID.get(id);
}

/** One tagged element: a name to find in the script, filed under a category. */
export interface BreakdownItem {
  id: string;
  category: string;
  name: string;
}

function isWordChar(ch: string | undefined): boolean {
  return !!ch && /[A-Za-z0-9]/.test(ch);
}

/**
 * Boundary-aware, non-overlapping occurrence start indices of `needleLower`
 * within `hayLower` (both already lowercased). A boundary is enforced only on a
 * side whose needle edge is itself alphanumeric, so "cat" does not match inside
 * "category" yet ".38" or "P-90" (which begin/end on punctuation) still match.
 */
export function occurrences(hayLower: string, needleLower: string): number[] {
  const out: number[] = [];
  const n = needleLower.length;
  if (n === 0) return out;
  const startW = isWordChar(needleLower[0]);
  const endW = isWordChar(needleLower[n - 1]);
  let i = hayLower.indexOf(needleLower);
  while (i !== -1) {
    const before = i > 0 ? hayLower[i - 1] : undefined;
    const after = i + n < hayLower.length ? hayLower[i + n] : undefined;
    if ((!startW || !isWordChar(before)) && (!endW || !isWordChar(after))) {
      out.push(i);
    }
    i = hayLower.indexOf(needleLower, i + n);
  }
  return out;
}

export interface TagRange {
  start: number;
  end: number;
  item: BreakdownItem;
}

/** Every tagged occurrence within a single line of text, sorted by position. */
export function tagRangesIn(text: string, items: BreakdownItem[]): TagRange[] {
  if (!text) return [];
  const hay = text.toLowerCase();
  const ranges: TagRange[] = [];
  for (const it of items) {
    const needle = it.name.trim().toLowerCase();
    if (!needle) continue;
    for (const i of occurrences(hay, needle)) {
      ranges.push({ start: i, end: i + needle.length, item: it });
    }
  }
  return ranges.sort((a, b) => a.start - b.start || b.end - a.end);
}

export interface BreakdownMatch {
  item: BreakdownItem;
  count: number;
}
export interface BreakdownScene {
  number: number;
  heading: string;
  matches: BreakdownMatch[];
}
export interface BreakdownCategoryRollup {
  category: BreakdownCategory;
  items: { item: BreakdownItem; scenes: number; total: number }[];
}
export interface BreakdownResult {
  /** Scenes that contain at least one tagged element. */
  scenes: BreakdownScene[];
  /** Every category that has tagged elements, with per-element totals. */
  byCategory: BreakdownCategoryRollup[];
  /** How many elements are tagged in total (the catalog size). */
  itemCount: number;
}

export const EMPTY_BREAKDOWN: BreakdownResult = {
  scenes: [],
  byCategory: [],
  itemCount: 0,
};

function sortMatches(a: BreakdownMatch, b: BreakdownMatch): number {
  const ca = CATEGORY_ORDER.get(a.item.category) ?? 99;
  const cb = CATEGORY_ORDER.get(b.item.category) ?? 99;
  return ca - cb || a.item.name.localeCompare(b.item.name);
}

/**
 * Scan the script (as flat lines) for every tagged element and roll the results
 * up per scene and per category. Scenes are numbered 1..N by scene heading, the
 * same numbering the outline and reports use, so the panel can map a scene back
 * to a jump position via the outline.
 */
export function computeBreakdown(
  lines: { element: string; text: string }[],
  items: BreakdownItem[]
): BreakdownResult {
  interface SceneAcc {
    number: number;
    heading: string;
    counts: Map<string, number>;
  }
  const sceneAccs: SceneAcc[] = [];
  let cur: SceneAcc = { number: 0, heading: "(before scene 1)", counts: new Map() };
  let sceneCounter = 0;

  const flush = () => {
    if (cur.counts.size > 0) sceneAccs.push(cur);
  };

  for (const line of lines) {
    if (line.element === "scene_heading") {
      flush();
      sceneCounter++;
      cur = { number: sceneCounter, heading: (line.text ?? "").trim(), counts: new Map() };
    }
    const hay = (line.text ?? "").toLowerCase();
    if (!hay) continue;
    for (const it of items) {
      const needle = it.name.trim().toLowerCase();
      if (!needle) continue;
      const c = occurrences(hay, needle).length;
      if (c > 0) cur.counts.set(it.id, (cur.counts.get(it.id) ?? 0) + c);
    }
  }
  flush();

  const byId = new Map(items.map((it) => [it.id, it]));
  const itemScenes = new Map<string, number>();
  const itemTotal = new Map<string, number>();
  for (const sc of sceneAccs) {
    for (const [id, c] of sc.counts) {
      itemScenes.set(id, (itemScenes.get(id) ?? 0) + 1);
      itemTotal.set(id, (itemTotal.get(id) ?? 0) + c);
    }
  }

  const scenes: BreakdownScene[] = sceneAccs.map((sc) => ({
    number: sc.number,
    heading: sc.heading,
    matches: [...sc.counts.entries()]
      .map(([id, count]) => ({ item: byId.get(id)!, count }))
      .filter((m) => m.item)
      .sort(sortMatches),
  }));

  // The category rollup includes EVERY tagged element (even those not found in
  // the script, total 0) so it doubles as the master list and surfaces typos.
  const byCategory: BreakdownCategoryRollup[] = BREAKDOWN_CATEGORIES.map((category) => ({
    category,
    items: items
      .filter((it) => it.category === category.id)
      .map((it) => ({
        item: it,
        scenes: itemScenes.get(it.id) ?? 0,
        total: itemTotal.get(it.id) ?? 0,
      }))
      .sort((a, b) => b.total - a.total || a.item.name.localeCompare(b.item.name)),
  })).filter((g) => g.items.length > 0);

  return { scenes, byCategory, itemCount: items.length };
}

/** A plain-text breakdown report, suitable for download. */
export function breakdownToText(result: BreakdownResult, title: string): string {
  const out: string[] = [];
  out.push(`BREAKDOWN — ${title || "Untitled"}`);
  out.push("");
  out.push("BY CATEGORY");
  if (result.byCategory.length === 0) {
    out.push("  (nothing tagged yet)");
  } else {
    for (const g of result.byCategory) {
      out.push(`  ${g.category.label}`);
      for (const row of g.items) {
        out.push(`    - ${row.item.name}  (${row.total} in ${row.scenes} ${row.scenes === 1 ? "scene" : "scenes"})`);
      }
    }
  }
  out.push("");
  out.push("BY SCENE");
  if (result.scenes.length === 0) {
    out.push("  (no tagged elements appear in any scene)");
  } else {
    for (const sc of result.scenes) {
      out.push(`  ${sc.number}. ${sc.heading || "(untitled scene)"}`);
      for (const m of sc.matches) {
        const cat = categoryById(m.item.category)?.label ?? m.item.category;
        out.push(`    - [${cat}] ${m.item.name}${m.count > 1 ? ` ×${m.count}` : ""}`);
      }
    }
  }
  out.push("");
  return out.join("\n");
}
