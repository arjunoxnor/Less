/**
 * Pure last-write-wins decision logic for the sync reconcile, extracted so it
 * can be unit-tested without the network, localStorage, or the editor. The
 * reconcile in useProjects performs the side effects; the WHO-WINS decision
 * lives here. This is the logic that has historically regressed (the
 * cross-device rename/status clobber), so it is the part that most needs tests.
 */

/**
 * Run an async function over items with a bounded number in flight at once.
 * Used so reconcile's independent per-project / per-tombstone network calls run
 * concurrently (instead of a serial round-trip storm on first sign-in) without
 * firing all N requests at the server at once. Order of results matches input.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker)
  );
  return out;
}

/** Is the cloud's clock strictly newer than the local one? Missing clocks fall
 *  back to a provided default (usually updated_at / createdAt). */
export function clockNewer(
  cloudClock: string | null | undefined,
  cloudFallback: string,
  localClock: string | null | undefined,
  localFallback: string
): boolean {
  const c = new Date(cloudClock ?? cloudFallback).getTime();
  const l = new Date(localClock ?? localFallback).getTime();
  return c > l;
}

export type FieldAction =
  | "pull" // adopt the cloud value locally
  | "push" // upload the local value to the cloud
  | "clearDirty" // local matches cloud already; just drop the dirty flag
  | "noop";

/**
 * Decide what to do with a single per-field value (title or status) given
 * whether we have a pending local edit (dirty) and whether the cloud's own
 * field clock is newer.
 *
 *   - A pending local edit is never discarded based on wall-clock order. Device
 *     clocks can be hours wrong; the dirty bit is the durable evidence that the
 *     writer changed this value and it has not reached the cloud yet.
 *   - A pending edit is pushed, or the flag is cleared if it already matches.
 *   - With no pending edit, a differing newer cloud value is pulled.
 */
export function decideField(opts: {
  dirty: boolean;
  cloudNewer: boolean;
  localValue: string | null | undefined;
  cloudValue: string | null | undefined;
}): FieldAction {
  const { dirty, cloudNewer, localValue, cloudValue } = opts;
  if (dirty) return localValue && localValue !== cloudValue ? "push" : "clearDirty";
  if (cloudNewer && cloudValue && cloudValue !== localValue) return "pull";
  return "noop";
}

/**
 * Decide placement (folder + position). Placement rides its own placed_at clock;
 * a device that never explicitly placed a project falls back to createdAt (NOT
 * updatedAt, which a content/status save bumps) so a default-loose local copy
 * cannot out-rank a real cloud folder filing.
 */
export function decidePlacement(opts: {
  localFolderId: string | null | undefined;
  localPosition: number | null | undefined;
  localPlacedAt: string | null | undefined;
  localCreatedAt: string;
  cloudFolderId: string | null | undefined;
  cloudPosition: number | null | undefined;
  cloudPlacedAt: string | null | undefined;
  cloudUpdatedAt: string;
}): "pull" | "push" | "noop" {
  const same =
    (opts.localFolderId ?? null) === (opts.cloudFolderId ?? null) &&
    (opts.localPosition ?? null) === (opts.cloudPosition ?? null);
  if (same) return "noop";
  const cloudWins = clockNewer(
    opts.cloudPlacedAt,
    opts.cloudUpdatedAt,
    opts.localPlacedAt,
    opts.localCreatedAt
  );
  return cloudWins ? "pull" : "push";
}
