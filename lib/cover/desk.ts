import { reorderIdsAtSlot } from "@/lib/storage/library";
import { headOf, type Stackable } from "./stacks";

/**
 * The desk's actions on version stacks, as plans: each returns the field
 * changes to make (one entry per document), and the home applies them through
 * the normal kind/stack write, so every change syncs on its own clock. Pure,
 * so the rules are pinned by tests rather than by hand.
 *
 * Two rules run through all of them:
 *   - the version you are adding to stays on top; a version only becomes
 *     current when the writer says so (or saves it as the current draft)
 *   - a stack is never left with one version in it: that version simply goes
 *     back to being a document on its own
 */

export interface OrgFields {
  kind?: string | null;
  stackId?: string | null;
  stackTop?: string | null;
}

export interface OrgPatch {
  id: string;
  fields: OrgFields;
}

/** The key a document is grouped under on the desk (matches groupStacks). */
export const groupKeyOf = (d: { id: string; stackId?: string }) =>
  d.stackId ? `s:${d.stackId}` : `d:${d.id}`;

/**
 * What a cover's colors are seeded from: the stack, so every version of one
 * thing wears the same colors, or the document itself.
 */
export const paletteSeedOf = (d: { id: string; stackId?: string }) => d.stackId ?? d.id;

/**
 * A new stack's id. It is the id of the document the stack grew from, so that
 * document keeps its colors and the versions joining it take them on. A fresh
 * id only when that one is already in use (the document once started a stack
 * it has since left).
 */
export function newStackId(seedId: string, all: readonly Stackable[], fresh: () => string): string {
  return all.some((d) => d.stackId === seedId) ? fresh() : seedId;
}

/** Stacks that `leaving` walk out of, left with a single version: dissolve them. */
function tidy(leaving: ReadonlySet<string>, all: readonly Stackable[], joining?: string): OrgPatch[] {
  const left = new Set(
    all
      .filter((d) => leaving.has(d.id) && d.stackId && d.stackId !== joining)
      .map((d) => d.stackId as string)
  );
  const out: OrgPatch[] = [];
  for (const stackId of left) {
    const remaining = all.filter((d) => d.stackId === stackId && !leaving.has(d.id));
    if (remaining.length === 1) out.push({ id: remaining[0].id, fields: { stackId: null, stackTop: null } });
  }
  return out;
}

/**
 * Put documents into the stack `targetId` belongs to, starting one when it is
 * on its own. Carrying a whole stack onto another merges the two.
 */
export function planStack(
  sourceIds: readonly string[],
  targetId: string,
  all: readonly Stackable[],
  now: string,
  fresh: () => string
): OrgPatch[] {
  const target = all.find((d) => d.id === targetId);
  if (!target) return [];
  const stackId = target.stackId ?? newStackId(target.id, all, fresh);
  const moving = [...new Set(sourceIds)].filter((id) => {
    if (id === targetId) return false;
    const doc = all.find((d) => d.id === id);
    return !!doc && (!target.stackId || doc.stackId !== target.stackId);
  });
  if (moving.length === 0) return [];

  const out: OrgPatch[] = [];
  if (!target.stackId) {
    out.push({ id: target.id, fields: { stackId, stackTop: now } });
  } else {
    // Pin the current version, so a newer arrival cannot take the top just by
    // having been edited more recently.
    const head = headOf(all.filter((d) => d.stackId === target.stackId));
    if (!head.stackTop) out.push({ id: head.id, fields: { stackTop: now } });
  }
  for (const id of moving) out.push({ id, fields: { stackId, stackTop: null } });
  out.push(...tidy(new Set(moving), all, stackId));
  return out;
}

/** Stack a set that looks like versions of one thing; the first becomes current. */
export function planStackAll(
  ids: readonly string[],
  all: readonly Stackable[],
  now: string,
  fresh: () => string
): OrgPatch[] {
  const docs = [...new Set(ids)]
    .map((id) => all.find((d) => d.id === id))
    .filter((d): d is Stackable => !!d);
  if (docs.length < 2) return [];
  const head = docs[0];
  const stackId = docs.find((d) => d.stackId)?.stackId ?? newStackId(head.id, all, fresh);
  const out: OrgPatch[] = [{ id: head.id, fields: { stackId, stackTop: now } }];
  for (const d of docs.slice(1)) {
    if (d.stackId !== stackId || d.stackTop) out.push({ id: d.id, fields: { stackId, stackTop: null } });
  }
  out.push(...tidy(new Set(docs.map((d) => d.id)), all, stackId));
  return out;
}

/** Take one version out of its stack. */
export function planUnstack(id: string, all: readonly Stackable[]): OrgPatch[] {
  const doc = all.find((d) => d.id === id);
  if (!doc?.stackId) return [];
  return [{ id, fields: { stackId: null, stackTop: null } }, ...tidy(new Set([id]), all)];
}

/** Make one version the current one: it goes on top of its stack. */
export function planMakeCurrent(id: string, all: readonly Stackable[], now: string): OrgPatch[] {
  const doc = all.find((d) => d.id === id);
  if (!doc?.stackId) return [];
  return [{ id, fields: { stackTop: now } }];
}

/**
 * Save a draft: a frozen copy filed with the original. The copy joins the
 * original's stack (starting one when it has none) and the original stays
 * current, because the writer keeps writing in it.
 */
export function planDraftStack(
  original: Stackable,
  all: readonly Stackable[],
  now: string,
  fresh: () => string
): { stackId: string; originalPatch: OrgPatch | null } {
  if (original.stackId) {
    // The writer is still in this one, so it is (or becomes) the current
    // version. Already pinned on top: nothing to change. On top only by being
    // the most recently edited, it must be pinned, or the brand-new copy would
    // take the top for being newer still.
    const head = headOf(all.filter((d) => d.stackId === original.stackId));
    const pinned = head.id === original.id && !!original.stackTop;
    return {
      stackId: original.stackId,
      originalPatch: pinned ? null : { id: original.id, fields: { stackTop: now } },
    };
  }
  const stackId = newStackId(original.id, all, fresh);
  return { stackId, originalPatch: { id: original.id, fields: { stackId, stackTop: now } } };
}

/* ---- Order on the desk ------------------------------------------------- */

function groupsOf(order: readonly string[], keyOf: (id: string) => string) {
  const keys: string[] = [];
  const members = new Map<string, string[]>();
  for (const id of order) {
    const key = keyOf(id);
    const list = members.get(key);
    if (list) list.push(id);
    else {
      members.set(key, [id]);
      keys.push(key);
    }
  }
  return { keys, members };
}

/**
 * A container's order after carrying one group (a stack, or a document on its
 * own) to a slot among the groups. Versions keep their order inside the stack.
 * Null when nothing would move, so no placement clock is stamped.
 */
export function reorderGroups(
  order: readonly string[],
  keyOf: (id: string) => string,
  sourceKey: string,
  slot: number
): string[] | null {
  const { keys, members } = groupsOf(order, keyOf);
  const next = reorderIdsAtSlot(keys, sourceKey, slot);
  return next ? next.flatMap((key) => members.get(key) ?? []) : null;
}

/** A container's order with arriving documents placed at a slot among the groups. */
export function insertAtGroupSlot(
  order: readonly string[],
  keyOf: (id: string) => string,
  ids: readonly string[],
  slot: number
): string[] {
  const arriving = new Set(ids);
  const { keys, members } = groupsOf(
    order.filter((id) => !arriving.has(id)),
    keyOf
  );
  const at = Math.max(0, Math.min(slot, keys.length));
  return [
    ...keys.slice(0, at).flatMap((key) => members.get(key) ?? []),
    ...ids,
    ...keys.slice(at).flatMap((key) => members.get(key) ?? []),
  ];
}
