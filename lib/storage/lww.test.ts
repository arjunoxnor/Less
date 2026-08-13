import { describe, it, expect } from "vitest";
import { clockNewer, decideField, decidePlacement, mapLimit } from "./lww";

describe("mapLimit", () => {
  it("preserves result order and never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(peak).toBeLessThanOrEqual(3);
  });
  it("handles an empty list", async () => {
    expect(await mapLimit([], 4, async () => 1)).toEqual([]);
  });
});

// These tests pin the sync conflict-resolution rules that have historically
// regressed (the cross-device rename / status clobber). If a future change to
// the reconcile decision breaks one of these, it fails here instead of silently
// losing a writer's rename.

describe("clockNewer", () => {
  it("compares the field clocks, not the fallbacks, when both are present", () => {
    expect(clockNewer("2026-02-02", "2020", "2026-01-01", "2030")).toBe(true);
    expect(clockNewer("2026-01-01", "2030", "2026-02-02", "2020")).toBe(false);
  });
  it("uses the fallback only when a clock is missing", () => {
    expect(clockNewer(null, "2026-02-02", null, "2026-01-01")).toBe(true);
  });
});

describe("decideField (title/status conflict)", () => {
  const T = { localValue: "A", cloudValue: "B" };

  it("pulls a strictly-newer cloud value when we have no pending edit", () => {
    expect(decideField({ dirty: false, cloudNewer: true, ...T })).toBe("pull");
  });

  it("does nothing when the cloud is not newer and we are not dirty", () => {
    expect(decideField({ dirty: false, cloudNewer: false, ...T })).toBe("noop");
  });

  it("pushes our pending edit when the cloud is NOT newer (offline rename self-heal)", () => {
    expect(decideField({ dirty: true, cloudNewer: false, ...T })).toBe("push");
  });

  it("lets a strictly-newer remote edit supersede our pending one (no stale clobber)", () => {
    // This is the F1/F41 class: our local rename is stale relative to a newer
    // remote rename, so we must adopt the remote, not push over it.
    expect(decideField({ dirty: true, cloudNewer: true, ...T })).toBe("pull");
  });

  it("just clears the dirty flag when our value already matches the cloud", () => {
    expect(
      decideField({ dirty: true, cloudNewer: false, localValue: "A", cloudValue: "A" })
    ).toBe("clearDirty");
  });

  it("never pulls an empty/absent cloud value over a local one", () => {
    expect(
      decideField({ dirty: false, cloudNewer: true, localValue: "A", cloudValue: "" })
    ).toBe("noop");
  });
});

describe("decidePlacement", () => {
  const base = {
    localCreatedAt: "2026-01-01T00:00:00Z",
    cloudUpdatedAt: "2026-01-01T00:00:00Z",
  };

  it("does nothing when folder and position already match", () => {
    expect(
      decidePlacement({
        ...base,
        localFolderId: "f1",
        localPosition: 0,
        localPlacedAt: "2026-05-01",
        cloudFolderId: "f1",
        cloudPosition: 0,
        cloudPlacedAt: "2026-06-01",
      })
    ).toBe("noop");
  });

  it("adopts a newer cloud filing", () => {
    expect(
      decidePlacement({
        ...base,
        localFolderId: null,
        localPosition: null,
        localPlacedAt: "2026-05-01",
        cloudFolderId: "f1",
        cloudPosition: 2,
        cloudPlacedAt: "2026-06-01",
      })
    ).toBe("pull");
  });

  it("does NOT let a never-placed local copy (placedAt unset) erase a real cloud filing", () => {
    // The dangerous case: a loose local project whose updatedAt got bumped by a
    // content save must fall back to createdAt, so an older-created-but-recently-
    // edited loose copy cannot out-rank the cloud's deliberate folder filing.
    expect(
      decidePlacement({
        localFolderId: null,
        localPosition: null,
        localPlacedAt: undefined, // never explicitly placed here
        localCreatedAt: "2026-01-01T00:00:00Z",
        cloudFolderId: "f1",
        cloudPosition: 0,
        cloudPlacedAt: "2026-03-01T00:00:00Z", // filed after creation
        cloudUpdatedAt: "2026-03-01T00:00:00Z",
      })
    ).toBe("pull");
  });

  it("pushes a genuinely newer local placement to the cloud", () => {
    expect(
      decidePlacement({
        ...base,
        localFolderId: "f2",
        localPosition: 1,
        localPlacedAt: "2026-07-01",
        cloudFolderId: null,
        cloudPosition: null,
        cloudPlacedAt: "2026-06-01",
      })
    ).toBe("push");
  });
});
