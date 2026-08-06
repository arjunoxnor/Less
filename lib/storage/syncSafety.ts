/** Compare live structured state with the exact value sent by an async save. */
export function stillMatchesSnapshot(value: unknown, snapshot: string): boolean {
  return JSON.stringify(value) === snapshot;
}

/** A field request may clear its dirty flag only while that value is current. */
export function stillMatchesField(current: string, requested: string): boolean {
  return current === requested;
}
