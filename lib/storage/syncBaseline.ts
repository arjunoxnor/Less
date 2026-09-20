import type { JSONContent } from "@tiptap/core";
import { trimTitlePage, type TitlePage } from "@/lib/export/titlePage";

/**
 * The synced baseline: a fingerprint of the body this device and the cloud last
 * agreed on, kept beside lastSavedAt.
 *
 * Why it exists. The open-document sync used to decide "push mine or pull
 * theirs" from the persisted dirty flag alone, and that flag is set by ANY
 * editor update, including ones that change nothing (opening an empty
 * screenplay is enough). A flagged document always pushed, so a stale or blank
 * local copy silently replaced newer work written from another device or by an
 * outside writer, every time it was opened. And an open tab never looked at the
 * cloud again after it mounted, so it could not know there was anything newer.
 *
 * With a baseline the questions become answerable from content, not flags:
 *   did I change it?      local fingerprint differs from the baseline
 *   did they change it?   cloud fingerprint differs from the baseline
 * Only when both are true is it a real conflict. The cloud's updated_at cannot
 * answer the second question on its own, because every PATCH bumps it (a rename,
 * a status change, a folder move), so content is compared directly.
 *
 * Everything here is pure so the who-wins rules can be tested without a
 * network, storage, or an editor. useCloudSync performs the side effects.
 */

/** JSON with object keys sorted, so key order can never read as a change. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] !== undefined) out[key] = sortKeys(source[key]);
    }
    return out;
  }
  return value;
}

/** cyrb53: a fast 53-bit string hash. Not cryptographic; it only has to tell
 *  two bodies apart, and the length suffix below covers the rest. */
function hash53(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Fingerprint of a body plus its title page (they sync as one unit). An empty
 *  title page and no title page are the same thing. */
export function syncFingerprint(
  content: JSONContent | null | undefined,
  titlePage: TitlePage | null | undefined
): string {
  const text = canonicalJson({ c: content ?? null, t: trimTitlePage(titlePage) });
  return `${hash53(text)}:${text.length}`;
}

/** True when the document holds no words at all. */
export function isBlankDoc(content: JSONContent | null | undefined): boolean {
  if (!content) return true;
  if (typeof content.text === "string" && content.text.trim() !== "") return false;
  for (const child of content.content ?? []) {
    if (!isBlankDoc(child)) return false;
  }
  return true;
}

export type RemoteDecision =
  | "noop" // in step already
  | "advance" // same body on both sides: just record the cloud's clock
  | "pull" // adopt the cloud body
  | "push" // send the local body
  | "conflict"; // both changed, differently: keep both, show the cloud's

/**
 * Who wins between the open editor and the cloud row.
 *
 *  1. Same body on both sides: nothing to move.
 *  2. A blank page never beats a page with words, in either direction. A blank
 *     local copy has nothing to lose, and a blank cloud copy over local words is
 *     the signature of the old clobber, so the words go back up.
 *  3. No baseline yet (a project last synced before baselines existed): the
 *     rule this replaced, unchanged, so nothing moves in a surprising way on the
 *     first open after the upgrade.
 *  4. With a baseline: whichever side actually changed wins; if both did, it is
 *     a conflict.
 */
export function decideRemote(opts: {
  baseline: string | null;
  localPrint: string;
  cloudPrint: string;
  localBlank: boolean;
  cloudBlank: boolean;
  /** The cloud's updated_at differs from the one this device last synced to. */
  cloudMoved: boolean;
  /** Legacy inputs, used only while there is no baseline. */
  legacyDirty: boolean;
  legacyCloudNewer: boolean;
}): RemoteDecision {
  if (opts.localPrint === opts.cloudPrint) {
    return opts.cloudMoved || opts.baseline !== opts.localPrint ? "advance" : "noop";
  }
  if (opts.localBlank !== opts.cloudBlank) return opts.localBlank ? "pull" : "push";
  if (opts.baseline === null) {
    if (opts.legacyDirty) return "push";
    return opts.legacyCloudNewer ? "pull" : "noop";
  }
  const localChanged = opts.localPrint !== opts.baseline;
  const cloudChanged = opts.cloudPrint !== opts.baseline;
  if (localChanged && cloudChanged) return "conflict";
  return cloudChanged ? "pull" : "push";
}
