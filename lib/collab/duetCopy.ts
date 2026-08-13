import type { JSONContent } from "@tiptap/core";
import { docText } from "@/lib/editor/docUtils";
import { lsGet, lsSet } from "@/lib/storage/localStore";
import { MAX_LIBRARY_NAME_LENGTH, normalizeLibraryName } from "@/lib/storage/library";
import type { ProjectType } from "@/lib/storage/projects";

/**
 * Duet stage 3: a guest keeps a shared script by saving a SNAPSHOT of it into
 * their own library as an ordinary project. Everything here is one-way. The
 * room is only read, never written, and the saved project has a fresh id of its
 * own, so the copy and the shared document diverge from that moment.
 *
 * The one piece of state kept per link is which project it was last saved into
 * (an additive local key), so a second save is never an indistinguishable
 * duplicate of the first.
 */

const COPY_KEY_PREFIX = "less:duet:copy:";
const DEFAULT_COPY_TITLE = "Shared screenplay";
/** How many numbered variants to try before falling back to a timestamp. */
const MAX_TITLE_ATTEMPTS = 500;

export interface DuetCopyRecord {
  /** The library project this link was last saved into. */
  projectId: string;
  title: string;
  savedAt: string;
}

/** What the library needs to create the copy as an ordinary project. */
export interface DuetCopyInput {
  type: ProjectType;
  title: string;
  content: JSONContent;
}

/** The app's create-a-project callback, narrowed to what stage 3 uses. */
export type SaveDuetCopy = (input: DuetCopyInput) => { id: string; title: string };

export interface DuetCopyPlan extends DuetCopyInput {
  /** A copy of this same link that is still in the library, if any. */
  previous: DuetCopyRecord | null;
}

/**
 * Should this editor mirror its text into the local project index? A guest's
 * duet room has no project row of its own, so the mirror would land in their
 * library as a phantom recovered-conflict project (saveProjectDoc creates one
 * for an unknown id). The room's own local Y.Doc cache is the guest's crash
 * backup, and saving a copy is how they deliberately keep it.
 */
export function duetMirrorsToLibrary(access: { owner: boolean } | null): boolean {
  return access === null || access.owner;
}

/** Same rule the project index uses: a screenplay has screenplay lines. */
export function duetCopyType(content: JSONContent | null | undefined): ProjectType {
  return content?.content?.some((node) => node.type === "screenplayLine")
    ? "screenplay"
    : "plain";
}

/** Is there anything in the shared document yet? An empty room is not savable. */
export function duetCopyHasText(content: JSONContent | null | undefined): boolean {
  return Boolean(content && docText(content));
}

/** Trim a base title so a " (2)" style suffix still fits the library limit. */
function withSuffix(base: string, suffix: string): string {
  const room = MAX_LIBRARY_NAME_LENGTH - suffix.length;
  return `${base.slice(0, Math.max(1, room)).trimEnd()}${suffix}`;
}

/**
 * A title that no project in the library is already using, so two saves of the
 * same link are always tellable apart on the home screen.
 */
export function uniqueCopyTitle(base: string, taken: Iterable<string>): string {
  const used = new Set<string>();
  for (const title of taken) used.add(title.trim().toLowerCase());
  const clean = normalizeLibraryName(base, DEFAULT_COPY_TITLE);
  if (!used.has(clean.toLowerCase())) return clean;
  for (let attempt = 2; attempt < MAX_TITLE_ATTEMPTS; attempt++) {
    const candidate = withSuffix(clean, ` (${attempt})`);
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return withSuffix(clean, ` (${Date.now()})`);
}

/** Everything the save-a-copy modal needs, decided before it opens. */
export function planDuetCopy(input: {
  content: JSONContent;
  sharedTitle: string | null;
  /** Every title already in the library. */
  existingTitles: Iterable<string>;
  previous?: DuetCopyRecord | null;
}): DuetCopyPlan {
  return {
    type: duetCopyType(input.content),
    title: uniqueCopyTitle(
      normalizeLibraryName(input.sharedTitle, DEFAULT_COPY_TITLE),
      input.existingTitles
    ),
    content: input.content,
    previous: input.previous ?? null,
  };
}

function copyKey(token: string): string {
  return COPY_KEY_PREFIX + token;
}

/**
 * The project this link was last saved into, but only while that project is
 * still in the library: a record whose project was deleted is stale and must
 * not warn about a copy the writer no longer has.
 */
export function readDuetCopyRecord(
  token: string,
  stillInLibrary: (projectId: string) => boolean
): DuetCopyRecord | null {
  const raw = lsGet(copyKey(token));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DuetCopyRecord>;
    if (typeof parsed?.projectId !== "string" || !parsed.projectId) return null;
    if (!stillInLibrary(parsed.projectId)) return null;
    return {
      projectId: parsed.projectId,
      title: normalizeLibraryName(parsed.title, "Untitled"),
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : "",
    };
  } catch {
    return null;
  }
}

/** Remember the saved copy. Best effort: a failure only costs the warning. */
export function writeDuetCopyRecord(token: string, record: DuetCopyRecord): boolean {
  return lsSet(copyKey(token), JSON.stringify(record));
}
