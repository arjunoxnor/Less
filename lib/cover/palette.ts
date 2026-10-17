import type { DocKind } from "./kinds";

/**
 * Color and shape for the desk. Every document gets its own palette and
 * composition, seeded from its id, so a cover is unique, recognizable, and the
 * same on every device without storing anything. Palettes are hand-picked
 * (poster and book-jacket colors, not random hues) and readable in both
 * themes: a cover is a printed object, so it does not change in the dark;
 * the desk around it does.
 */

export interface Palette {
  /** The jacket. */
  bg: string;
  /** Type on the jacket. */
  ink: string;
  /** The loud shape. */
  accent: string;
  /** The second shape. */
  alt: string;
}

export const PALETTES: readonly Palette[] = [
  { bg: "#E8432E", ink: "#1B1B1F", accent: "#F5D547", alt: "#2B59C3" }, // tomato
  { bg: "#2B4BD8", ink: "#FFF6E5", accent: "#FF7A59", alt: "#F5D547" }, // ultramarine
  { bg: "#F2B33D", ink: "#1E1A16", accent: "#D7263D", alt: "#1B6F6A" }, // saffron
  { bg: "#127C6A", ink: "#FDF6EC", accent: "#F4A259", alt: "#F25F5C" }, // jade
  { bg: "#6B2D8F", ink: "#FFF1F6", accent: "#FFB703", alt: "#2EC4B6" }, // plum
  { bg: "#FF6F91", ink: "#2A1033", accent: "#FFC75F", alt: "#3A47D5" }, // flamingo
  { bg: "#14213D", ink: "#FCF5E5", accent: "#FCA311", alt: "#E5383B" }, // midnight
  { bg: "#6A994E", ink: "#102A13", accent: "#F2E8CF", alt: "#BC4749" }, // moss
  { bg: "#2EC4B6", ink: "#0F1B2D", accent: "#FF3366", alt: "#FDFFFC" }, // lagoon
  { bg: "#D9622B", ink: "#FFF4E6", accent: "#2D3047", alt: "#F7C548" }, // ember
  { bg: "#A78BFA", ink: "#1E1B4B", accent: "#FDE047", alt: "#F43F5E" }, // lilac
  { bg: "#26262B", ink: "#F5F1E8", accent: "#E85D75", alt: "#4CC9F0" }, // carbon
  { bg: "#0096C7", ink: "#FFFDF7", accent: "#FFD23F", alt: "#EE4266" }, // cobalt
  { bg: "#C8553D", ink: "#FFF8F0", accent: "#F2D0A4", alt: "#2E4057" }, // terracotta
  { bg: "#F7D046", ink: "#1D1A12", accent: "#3D5A80", alt: "#EE6C4D" }, // mustard
  { bg: "#9B2335", ink: "#FFF3E8", accent: "#F4D35E", alt: "#5FA8D3" }, // claret
];

/** Sticky-note colors for Notes covers: pastel, dark ink. */
export const STICKIES: readonly string[] = ["#FFE27A", "#FFB5C8", "#B8F0D2", "#BFE3FF", "#FFD1A9", "#D9C9FF"];

/** The warm paper of a title page or an index card. */
export const PAPER = "#F7F2E8";
export const PAPER_INK = "#1F1C18";

/** Each kind's signature color: its badge, its filter chip, its counts. */
export const KIND_COLOR: Record<DocKind, string> = {
  script: "#E8432E",
  treatment: "#7B3FA8",
  onepager: "#F0507D",
  outline: "#E0A11B",
  characters: "#11806B",
  notes: "#C9A400",
  document: "#6B7A90",
  board: "#2B4BD8",
  voice: "#16A5A0",
};

/** FNV-1a: a fast, stable 32-bit hash of a string. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a tiny seeded generator, so a cover's art is reproducible. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function paletteFor(id: string): Palette {
  return PALETTES[hashString(id) % PALETTES.length];
}

export function stickyFor(id: string): string {
  return STICKIES[hashString(id + ":note") % STICKIES.length];
}

/* ---- Shapes ---------------------------------------------------------------- */

export type Shape =
  | { t: "circle"; cx: number; cy: number; r: number; fill: string }
  | { t: "ring"; cx: number; cy: number; r: number; w: number; stroke: string }
  | { t: "half"; cx: number; cy: number; r: number; rot: number; fill: string }
  | { t: "quarter"; corner: 0 | 1 | 2 | 3; r: number; fill: string }
  | { t: "bar"; x: number; y: number; w: number; h: number; rot: number; fill: string }
  | { t: "dots"; x: number; y: number; cols: number; rows: number; gap: number; r: number; fill: string }
  | { t: "tri"; points: string; fill: string };

/** The cover canvas, in SVG units: 3:4, like a page or a book. */
export const ART_W = 120;
export const ART_H = 160;

/**
 * A seeded composition on the 120x160 canvas: one big shape, one counter
 * shape, and a small rhythm element (dots or a bar). Kinds choose how loud
 * their art is: a one-pager is a poster, a document barely decorated.
 */
export function artFor(id: string, kind: DocKind, p: Palette): Shape[] {
  const r = seeded(hashString(id + ":" + kind));
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  const out: Shape[] = [];
  const big = pick(["circle", "half", "quarter", "ring", "tri"] as const);
  const corner = Math.floor(r() * 4) as 0 | 1 | 2 | 3;

  if (kind === "onepager") {
    // The poster: one huge, centered-high shape.
    if (big === "tri") {
      out.push({ t: "tri", points: `${10 + r() * 20},104 60,${18 + r() * 14} ${90 + r() * 20},104`, fill: p.accent });
    } else if (big === "ring") {
      out.push({ t: "ring", cx: 60, cy: 58, r: 34 + r() * 8, w: 12 + r() * 6, stroke: p.accent });
    } else if (big === "half") {
      out.push({ t: "half", cx: 60, cy: 66, r: 44, rot: pick([0, 90, 180, 270]), fill: p.accent });
    } else {
      out.push({ t: "circle", cx: 46 + r() * 28, cy: 54 + r() * 12, r: 36 + r() * 10, fill: p.accent });
    }
    out.push({ t: "circle", cx: 18 + r() * 84, cy: 26 + r() * 30, r: 8 + r() * 8, fill: p.alt });
    return out;
  }

  const scale = kind === "document" || kind === "notes" ? 0.6 : 1;
  if (big === "quarter") out.push({ t: "quarter", corner, r: (70 + r() * 30) * scale, fill: p.accent });
  else if (big === "half")
    out.push({ t: "half", cx: r() > 0.5 ? 120 : 0, cy: 30 + r() * 100, r: (46 + r() * 20) * scale, rot: pick([0, 90, 180, 270]), fill: p.accent });
  else if (big === "ring")
    out.push({ t: "ring", cx: r() * 120, cy: r() * 160, r: (34 + r() * 22) * scale, w: 9 + r() * 7, stroke: p.accent });
  else if (big === "tri")
    out.push({ t: "tri", points: `${r() * 40},160 ${60 + r() * 60},${100 + r() * 40} ${120},160`, fill: p.accent });
  else out.push({ t: "circle", cx: r() > 0.5 ? 104 : 16, cy: r() > 0.5 ? 26 : 134, r: (40 + r() * 22) * scale, fill: p.accent });

  if (r() > 0.4)
    out.push({ t: "circle", cx: 14 + r() * 92, cy: 14 + r() * 132, r: (6 + r() * 10) * scale, fill: p.alt });
  else
    out.push({ t: "bar", x: r() * 70, y: r() * 150, w: 40 + r() * 40, h: 5 + r() * 5, rot: pick([0, -12, 12, 90]), fill: p.alt });

  if (r() > 0.55)
    out.push({ t: "dots", x: 8 + r() * 60, y: 8 + r() * 110, cols: 4, rows: 3, gap: 6, r: 1.4, fill: p.ink });
  return out;
}

/** Dark or light text, whichever reads better on a fill (WCAG luminance). */
export function readableOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return PAPER_INK;
  const n = parseInt(m[1], 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  // Contrast against near-black ink vs white; pick the larger.
  const onDark = (L + 0.05) / 0.05;
  const onLight = 1.05 / (L + 0.05);
  return onDark >= onLight ? PAPER_INK : "#FFFFFF";
}
