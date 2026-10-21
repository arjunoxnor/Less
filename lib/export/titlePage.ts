import type { BreakdownItem } from "@/lib/editor/breakdown";
import type { PageLock } from "./pageLock";
/**
 * The screenplay title page: metadata that lives BESIDE the script, never inside
 * the strict screenplayLine+ document. All fields are optional; an absent or
 * all-empty title page means "no title page" and every exporter skips it.
 */
/**
 * A script's own settings. They change what its PDF says, so they belong to
 * the script, not the app: kept with its title page, they sync with it. A
 * script that never set one follows the app's default.
 */
export interface ScriptSettings {
  sceneNumbers?: boolean;
  autoContd?: boolean;
  revisionMode?: boolean;
  /** Locked pages (null: unlocked on purpose). */
  pageLock?: PageLock | null;
  /** Breakdown tags. */
  breakdown?: BreakdownItem[];
  /** About how many pages the script aims for (null: no target). */
  pageTarget?: number | null;
}

export interface TitlePage {
  /** Not part of the page: the script's own settings (see ScriptSettings). */
  settings?: ScriptSettings;
  title?: string;
  credit?: string; // e.g. "Written by"
  author?: string;
  source?: string; // e.g. "Based on the novel by ..."
  draftDate?: string;
  contact?: string; // may be multi-line
  copyright?: string;
}

export const EMPTY_TITLE_PAGE: TitlePage = {};

/** The field order used for the Fountain title block and the PDF layout. */
export const TITLE_PAGE_FIELDS: Exclude<keyof TitlePage, "settings">[] = [
  "title",
  "credit",
  "author",
  "source",
  "draftDate",
  "contact",
  "copyright",
];

/** True only if some field carries non-whitespace text. */
export function hasTitlePage(tp: TitlePage | null | undefined): boolean {
  return (
    !!tp && Object.values(tp).some((v) => typeof v === "string" && v.trim() !== "")
  );
}

/**
 * Trim every field, drop the empty ones, and return null when nothing remains,
 * so we never persist a whitespace-only title page.
 */
export function trimTitlePage(tp: TitlePage | null | undefined): TitlePage | null {
  if (!tp) return null;
  const out: TitlePage = {};
  for (const key of TITLE_PAGE_FIELDS) {
    const v = tp[key];
    if (typeof v === "string" && v.trim() !== "") (out as Record<string, string>)[key] = v.trim();
  }
  const settings: ScriptSettings = {};
  const raw = tp.settings;
  for (const key of ["sceneNumbers", "autoContd", "revisionMode"] as const) {
    const v = raw?.[key];
    if (typeof v === "boolean") settings[key] = v;
  }
  if (raw?.pageLock === null || (raw?.pageLock && Array.isArray(raw.pageLock.anchors))) settings.pageLock = raw.pageLock;
  if (Array.isArray(raw?.breakdown)) {
    settings.breakdown = raw.breakdown.filter(
      (it) => it && typeof it.id === "string" && typeof it.name === "string" && typeof it.category === "string"
    );
  }
  if (raw?.pageTarget === null) settings.pageTarget = null;
  else if (typeof raw?.pageTarget === "number" && raw.pageTarget >= 1 && raw.pageTarget <= 999) {
    settings.pageTarget = Math.round(raw.pageTarget);
  }
  if (Object.keys(settings).length) out.settings = settings;
  return hasTitlePage(out) || out.settings ? out : null;
}
