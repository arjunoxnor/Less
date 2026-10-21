import { describe, expect, it } from "vitest";
import { pickVersions } from "./versionPick";

const now = Date.parse("2026-10-21T12:00:00Z");
const at = (msAgo: number, id: string, label: string | null = null) => ({ id, label, created_at: new Date(now - msAgo).toISOString() });

describe("which versions History shows", () => {
  it("keeps every version of the last day, one an hour for a week, one a day before that", () => {
    const rows = [];
    // A snapshot every 3 minutes for 30 days.
    for (let m = 0; m < 30 * 24 * 60; m += 3) rows.push(at(m * 60_000, `v${m}`));
    const picked = pickVersions(rows, now, 100);
    expect(picked.length).toBeLessThanOrEqual(100);
    // The newest is there, and so is one from the very first day.
    expect(picked[0]).toBe("v0");
    const oldest = rows[rows.length - 1].id;
    const lastPicked = picked[picked.length - 1];
    expect(Number(lastPicked.slice(1))).toBeGreaterThan(Number(oldest.slice(1)) - 24 * 60);
  });

  it("always keeps a named draft", () => {
    const rows = [at(40 * 86_400_000, "draft", "Draft 1"), at(40 * 86_400_000 + 60_000, "auto")];
    expect(pickVersions(rows, now)).toEqual(["draft", "auto"]);
  });

  it("keeps everything when there are few", () => {
    const rows = [at(60_000, "a"), at(120_000, "b"), at(5 * 86_400_000, "c")];
    expect(pickVersions(rows, now)).toEqual(["a", "b", "c"]);
  });
});
