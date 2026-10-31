/**
 * The revision passes, in the order the industry prints them (white, blue,
 * pink, yellow, green, goldenrod, buff, salmon, cherry). The first draft's
 * pass is white, stored as a plain `true` on the line, as every revision mark
 * was before colours existed. Pure, so the exporters read it too.
 */
export const REVISION_COLORS = [
  { id: "white", label: "White", hex: "#c0392b" },
  { id: "blue", label: "Blue", hex: "#2f6df6" },
  { id: "pink", label: "Pink", hex: "#e0559a" },
  { id: "yellow", label: "Yellow", hex: "#c9a400" },
  { id: "green", label: "Green", hex: "#2f9e64" },
  { id: "goldenrod", label: "Goldenrod", hex: "#b8860b" },
  { id: "buff", label: "Buff", hex: "#a08858" },
  { id: "salmon", label: "Salmon", hex: "#e9806e" },
  { id: "cherry", label: "Cherry", hex: "#b3123f" },
] as const;

export type RevisionColor = (typeof REVISION_COLORS)[number]["id"];

export const isRevisionColor = (v: unknown): v is RevisionColor =>
  typeof v === "string" && REVISION_COLORS.some((c) => c.id === v);

/** What a line edited in this pass is marked with. */
export const revisionMark = (color: unknown): true | RevisionColor =>
  isRevisionColor(color) && color !== "white" ? color : true;

/**
 * The header a revised page carries, for the latest pass on it: "Blue Rev.",
 * with the pass's date if it is the script's current one.
 */
export function revisionLabel(colors: readonly string[], current?: string, date?: string): string | null {
  let latest = -1;
  for (const c of colors) latest = Math.max(latest, REVISION_COLORS.findIndex((x) => x.id === c));
  if (latest < 0) return null;
  const color = REVISION_COLORS[latest];
  return `${color.label} Rev.${color.id === current && date ? ` ${date}` : ""}`;
}
