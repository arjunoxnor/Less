/**
 * The project desk: where everything inside a project sits.
 *
 * A project (a folder one level down, like "Chess Master") is a desk, not a
 * list. Its documents, its stacks of drafts and its own folders sit wherever
 * the writer puts them, at the size they like, overlapping if they want. The
 * layout is a list of spots, back to front, stored on the project's folder and
 * synced on its own clock (desk_at), so arranging a desk can never out-rank a
 * rename or a move made somewhere else.
 *
 * Nothing about a document changes when it is moved on its desk: a spot is
 * only where it sits. Filing (into a folder) and stacking stay separate,
 * deliberate actions, each one undoable.
 *
 * A desk is laid out for one width (w0). Opened on a smaller or bigger screen,
 * the whole desk is drawn scaled to fit it, so an arrangement made on a big
 * monitor still sits right on a laptop, and the other way round.
 *
 * Pure and dependency-free: the API sanitizes layouts with the same function.
 */

export interface DeskSpot {
  /** "d:<document id>", "s:<stack id>" or "f:<folder id>". */
  k: string;
  x: number;
  y: number;
  /** Width, when the writer resized it (a cover, or a folder while shut). */
  w?: number;
  /** A folder shown open, as a column of what it holds. */
  open?: boolean;
  /** An open folder's own size, kept apart from its size while shut. */
  ow?: number;
  oh?: number;
}

export interface DeskLayout {
  v: 1;
  /** Back to front: a later spot sits on top of an earlier one. */
  spots: DeskSpot[];
  /** The width (px) the desk is laid out for: shown at any other, it scales to fit. */
  w0?: number;
}

export const DESK_MAX_SPOTS = 600;
export const DESK_MAX_COORD = 40_000;
export const DESK_MIN_W = 96;
export const DESK_MAX_W = 520;
/** An open folder (a column) can be narrow or wide, short (it scrolls) or tall. */
export const COLUMN_MIN_W = 220;
export const COLUMN_MAX_W = 720;
export const COLUMN_MIN_H = 150;
export const COLUMN_MAX_H = 2400;
/** Room around the edge of the desk, and between things placed for you. */
export const DESK_PAD = 28;
export const DESK_GAP = 30;
/** The widths a desk can be laid out for. */
export const DESK_W0_MIN = 480;
export const DESK_W0_MAX = 8000;
/**
 * How far a desk scales to fit a screen. Smaller than this the covers would
 * be too small to tell apart, so it scrolls instead (names never shrink past
 * a readable size, see desk.css); bigger, the extra room just shows.
 */
export const DESK_SCALE_MIN = 0.4;
export const DESK_SCALE_MAX = 1.8;

const KEY = /^[dsf]:[A-Za-z0-9_-]{1,64}$/;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A layout read from storage or the network: shape-checked, never trusted. */
export function sanitizeDesk(value: unknown): DeskLayout | null {
  let v = value;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object") return null;
  const raw = v as { v?: unknown; spots?: unknown; w0?: unknown };
  if (raw.v !== 1 || !Array.isArray(raw.spots)) return null;
  const byKey = new Map<string, DeskSpot>();
  for (const item of raw.spots.slice(0, DESK_MAX_SPOTS * 2)) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.k !== "string" || !KEY.test(r.k)) continue;
    const x = num(r.x);
    const y = num(r.y);
    if (x === null || y === null) continue;
    const spot: DeskSpot = {
      k: r.k,
      x: clamp(Math.round(x), 0, DESK_MAX_COORD),
      y: clamp(Math.round(y), 0, DESK_MAX_COORD),
    };
    const w = num(r.w);
    if (w !== null) spot.w = clamp(Math.round(w), DESK_MIN_W, DESK_MAX_W);
    if (r.open === true) spot.open = true;
    const ow = num(r.ow);
    if (ow !== null) spot.ow = clamp(Math.round(ow), COLUMN_MIN_W, COLUMN_MAX_W);
    const oh = num(r.oh);
    if (oh !== null) spot.oh = clamp(Math.round(oh), COLUMN_MIN_H, COLUMN_MAX_H);
    // A repeated key: the later one wins, and moves to the top.
    byKey.delete(r.k);
    byKey.set(r.k, spot);
  }
  const w0 = num(raw.w0);
  return {
    v: 1,
    spots: [...byKey.values()].slice(-DESK_MAX_SPOTS),
    ...(w0 !== null && w0 > 0 ? { w0: clamp(Math.round(w0), DESK_W0_MIN, DESK_W0_MAX) } : {}),
  };
}

/** A layout's laid-out width, carried over to the layout that replaces it. */
const keepW0 = (layout: DeskLayout | null | undefined) => (layout?.w0 ? { w0: layout.w0 } : {});

/**
 * The width a desk is laid out for: its own once it has one. A desk arranged
 * before desks scaled is taken as laid out for the screen it is on (or for
 * its rightmost thing, if that reaches further), so it only ever scales down
 * to fit, never up, until it is next arranged.
 */
export function designWidthOf(layout: DeskLayout | null, things: readonly DeskThing[], width: number): number {
  if (layout?.w0) return layout.w0;
  const sizes = new Map(things.map((t) => [t.key, t.w]));
  let right = 0;
  for (const spot of layout?.spots ?? []) right = Math.max(right, spot.x + (sizes.get(spot.k) ?? 0) + DESK_PAD);
  return clamp(Math.round(Math.max(width, right)), DESK_W0_MIN, DESK_W0_MAX);
}

/** How much a desk laid out for w0 is scaled to show on a screen this wide. */
export function deskScale(width: number, w0: number): number {
  if (!(width > 0) || !(w0 > 0)) return 1;
  const s = clamp(width / w0, DESK_SCALE_MIN, DESK_SCALE_MAX);
  // Within a hair of the width it was made for, it is drawn as it is.
  return Math.abs(s - 1) < 0.01 ? 1 : Math.round(s * 1000) / 1000;
}

/* ---- Placing things ------------------------------------------------------ */

/** Something to put on the desk, at its current size. */
export interface DeskThing {
  key: string;
  w: number;
  h: number;
  /** Older keys it may have been stored under (a document that became a stack). */
  aliases?: readonly string[];
}

export interface Placed {
  x: number;
  y: number;
  /** Stacking order: higher sits on top. */
  z: number;
  /** The spot that holds it, when the writer has placed it. */
  spot?: DeskSpot;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const clear = (a: Rect, b: Rect) =>
  a.x >= b.x + b.w + DESK_GAP ||
  b.x >= a.x + a.w + DESK_GAP ||
  a.y >= b.y + b.h + DESK_GAP ||
  b.y >= a.y + a.h + DESK_GAP;

/**
 * The first free place for a w x h thing, reading the desk like a page: the
 * highest row with room, then the leftmost spot in it. Candidate corners are
 * the desk's own edge and the right and bottom edges of what is already
 * there, which packs varied sizes into a loose masonry rather than a grid.
 */
export function firstFree(
  w: number,
  h: number,
  taken: readonly Rect[],
  width: number,
  fromY = DESK_PAD
): { x: number; y: number } {
  const right = Math.max(DESK_PAD + w, width - DESK_PAD);
  const xs = new Set<number>([DESK_PAD]);
  const ys = new Set<number>([Math.max(DESK_PAD, fromY)]);
  for (const r of taken) {
    xs.add(r.x);
    xs.add(r.x + r.w + DESK_GAP);
    ys.add(r.y);
    ys.add(r.y + r.h + DESK_GAP);
  }
  const xList = [...xs].filter((x) => x >= DESK_PAD && x + w <= right).sort((a, b) => a - b);
  const yList = [...ys].filter((y) => y >= fromY).sort((a, b) => a - b);
  for (const y of yList) {
    // Only what overlaps this band of the desk can be in the way.
    const band = taken.filter((r) => !(y >= r.y + r.h + DESK_GAP || r.y >= y + h + DESK_GAP));
    for (const x of xList) {
      const rect = { x, y, w, h };
      if (band.every((r) => clear(rect, r))) return { x, y };
    }
  }
  const bottom = taken.reduce((m, r) => Math.max(m, r.y + r.h + DESK_GAP), Math.max(DESK_PAD, fromY));
  return { x: DESK_PAD, y: bottom };
}

/**
 * Where everything sits: its stored spot when the writer has placed it, and
 * otherwise the first free place, in the order given (the most important
 * things first). Nothing already placed ever moves to make room.
 */
export function arrangeDesk(
  things: readonly DeskThing[],
  layout: DeskLayout | null,
  width: number
): Map<string, Placed> {
  const spots = new Map<string, { spot: DeskSpot; z: number }>();
  (layout?.spots ?? []).forEach((spot, z) => spots.set(spot.k, { spot, z }));
  const out = new Map<string, Placed>();
  const taken: Rect[] = [];
  const loose: DeskThing[] = [];
  for (const thing of things) {
    const hit = [thing.key, ...(thing.aliases ?? [])].map((k) => spots.get(k)).find(Boolean);
    if (hit) {
      out.set(thing.key, { x: hit.spot.x, y: hit.spot.y, z: hit.z, spot: hit.spot });
      taken.push({ x: hit.spot.x, y: hit.spot.y, w: thing.w, h: thing.h });
    } else loose.push(thing);
  }
  let z = layout?.spots.length ?? 0;
  for (const thing of loose) {
    const at = firstFree(thing.w, thing.h, taken, width);
    out.set(thing.key, { ...at, z: z++ });
    taken.push({ ...at, w: thing.w, h: thing.h });
  }
  return out;
}

/**
 * A layout that pins down everything as it sits right now (stored or placed
 * for you), back to front, so moving one thing never makes the others jump.
 * Spots for things no longer on this desk are dropped.
 */
export function freezeDesk(
  things: readonly DeskThing[],
  placed: ReadonlyMap<string, Placed>,
  layout: DeskLayout | null
): DeskLayout {
  const old = new Map((layout?.spots ?? []).map((s) => [s.k, s]));
  const rows = things
    .map((t) => {
      const p = placed.get(t.key);
      if (!p) return null;
      const prior = p.spot ?? [t.key, ...(t.aliases ?? [])].map((k) => old.get(k)).find(Boolean);
      const spot: DeskSpot = { k: t.key, x: Math.round(p.x), y: Math.round(p.y) };
      keepSizes(spot, prior);
      return { spot, z: p.z };
    })
    .filter((r): r is { spot: DeskSpot; z: number } => !!r)
    .sort((a, b) => a.z - b.z);
  return { v: 1, ...keepW0(layout), spots: rows.map((r) => r.spot) };
}

/** Carry a spot's sizes and open state over to its replacement. */
function keepSizes(spot: DeskSpot, prior: DeskSpot | undefined) {
  if (prior?.w !== undefined) spot.w = prior.w;
  if (prior?.open) spot.open = true;
  if (prior?.ow !== undefined) spot.ow = prior.ow;
  if (prior?.oh !== undefined) spot.oh = prior.oh;
}

/** Put a thing at a new spot (or change its size or open state), on top of the rest. */
export function placeOnDesk(layout: DeskLayout, key: string, patch: Partial<Omit<DeskSpot, "k">>): DeskLayout {
  const prior = layout.spots.find((s) => s.k === key);
  const next: DeskSpot = { k: key, x: prior?.x ?? DESK_PAD, y: prior?.y ?? DESK_PAD };
  keepSizes(next, prior);
  if (patch.x !== undefined) next.x = clamp(Math.round(patch.x), 0, DESK_MAX_COORD);
  if (patch.y !== undefined) next.y = clamp(Math.round(patch.y), 0, DESK_MAX_COORD);
  if ("w" in patch) {
    if (patch.w === undefined) delete next.w;
    else next.w = clamp(Math.round(patch.w), DESK_MIN_W, DESK_MAX_W);
  }
  if ("open" in patch) {
    if (patch.open) next.open = true;
    else delete next.open;
  }
  if ("ow" in patch) {
    if (patch.ow === undefined) delete next.ow;
    else next.ow = clamp(Math.round(patch.ow), COLUMN_MIN_W, COLUMN_MAX_W);
  }
  if ("oh" in patch) {
    if (patch.oh === undefined) delete next.oh;
    else next.oh = clamp(Math.round(patch.oh), COLUMN_MIN_H, COLUMN_MAX_H);
  }
  return { v: 1, ...keepW0(layout), spots: [...layout.spots.filter((s) => s.k !== key), next] };
}

/** Take things off a desk (they moved elsewhere). */
export function removeFromDesk(layout: DeskLayout, keys: readonly string[]): DeskLayout {
  const gone = new Set(keys);
  return { v: 1, ...keepW0(layout), spots: layout.spots.filter((s) => !gone.has(s.k)) };
}

/**
 * Tidy up: everything placed afresh, most important first; sizes and open
 * folders kept. The desk is laid out anew for the width it is tidied at.
 */
export function tidyDesk(things: readonly DeskThing[], layout: DeskLayout | null, width: number): DeskLayout {
  const fresh = arrangeDesk(things, null, width);
  const old = new Map((layout?.spots ?? []).map((s) => [s.k, s]));
  return {
    v: 1,
    w0: clamp(Math.round(width), DESK_W0_MIN, DESK_W0_MAX),
    spots: things.map((t) => {
      const p = fresh.get(t.key)!;
      const prior = [t.key, ...(t.aliases ?? [])].map((k) => old.get(k)).find(Boolean);
      const spot: DeskSpot = { k: t.key, x: p.x, y: p.y };
      keepSizes(spot, prior);
      return spot;
    }),
  };
}

/** How far down and across the desk reaches, for sizing the surface. */
export function deskExtent(
  things: readonly DeskThing[],
  placed: ReadonlyMap<string, Placed>
): { right: number; bottom: number } {
  let right = 0;
  let bottom = 0;
  for (const t of things) {
    const p = placed.get(t.key);
    if (!p) continue;
    right = Math.max(right, p.x + t.w);
    bottom = Math.max(bottom, p.y + t.h);
  }
  return { right, bottom };
}

/* ---- Sizes --------------------------------------------------------------- */

/** How wide each kind starts: a script is the biggest thing on its desk. */
export const KIND_WIDTH: Record<string, number> = {
  script: 236,
  onepager: 188,
  treatment: 188,
  outline: 188,
  characters: 176,
  board: 224,
  voice: 168,
  document: 176,
  notes: 156,
};

/** A cover (3:4) and the label under it. */
export const tileHeight = (w: number) => Math.round((w * 4) / 3) + 80;

/** A folder, shut: the folder itself and its name under it. It keeps its
 *  shape at any width (the folder is drawn in proportion to it). */
export const FOLDER_W = 214;
export const FOLDER_H = 262;
export const FOLDER_MIN_W = 140;
export const FOLDER_MAX_W = 460;
export const folderHeight = (w: number) => Math.round((w * 196) / 214) + 66;
/** A folder, open: a column of what it holds. */
export const COLUMN_W = 292;
export const columnHeight = (rows: number) => 98 + Math.max(1, rows) * 64 + 18;
