/**
 * The screenplay title page: metadata that lives BESIDE the script, never inside
 * the strict screenplayLine+ document. All fields are optional; an absent or
 * all-empty title page means "no title page" and every exporter skips it.
 */
export interface TitlePage {
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
export const TITLE_PAGE_FIELDS: (keyof TitlePage)[] = [
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
    if (typeof v === "string" && v.trim() !== "") out[key] = v.trim();
  }
  return hasTitlePage(out) ? out : null;
}
