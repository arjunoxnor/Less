import { describe, expect, it } from "vitest";
import {
  type OrgPatch,
  groupKeyOf,
  insertAtGroupSlot,
  newStackId,
  planDraftStack,
  planMakeCurrent,
  planStack,
  planStackAll,
  planUnstack,
  reorderGroups,
} from "./desk";
import { groupStacks, type Stackable } from "./stacks";

const NOW = "2026-10-17T12:00:00.000Z";
let n = 0;
const fresh = () => `fresh${++n}`;
const doc = (id: string, extra: Partial<Stackable> = {}): Stackable => ({
  id,
  title: id,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...extra,
});

/** Apply plans the way the home does, so the result can be read back as stacks. */
function apply(all: Stackable[], plan: OrgPatch[]) {
  return all.map((d) => {
    const patch = plan.filter((p) => p.id === d.id);
    const next = { ...d };
    for (const p of patch) {
      for (const [key, value] of Object.entries(p.fields)) {
        (next as Record<string, unknown>)[key] = value ?? undefined;
      }
    }
    return next;
  });
}

describe("planStack", () => {
  it("starts a stack named after the target, which keeps its colors and stays on top", () => {
    const all = [doc("a", { updatedAt: "2026-10-09T00:00:00Z" }), doc("b")];
    const plan = planStack(["a"], "b", all, NOW, fresh);
    expect(plan).toEqual([
      { id: "b", fields: { stackId: "b", stackTop: NOW } },
      { id: "a", fields: { stackId: "b", stackTop: null } },
    ]);
    const [group] = groupStacks(apply(all, plan));
    // a was edited more recently, but b was the one dropped on: b is current.
    expect(group.head.id).toBe("b");
    expect(group.members.map((m) => m.id)).toEqual(["b", "a"]);
  });

  it("pins an unpinned current version so a newer arrival cannot take the top", () => {
    const all = [
      doc("h", { stackId: "s", updatedAt: "2026-10-05T00:00:00Z" }),
      doc("o", { stackId: "s" }),
      doc("new", { updatedAt: "2026-10-10T00:00:00Z" }),
    ];
    const plan = planStack(["new"], "o", all, NOW, fresh);
    expect(plan).toContainEqual({ id: "h", fields: { stackTop: NOW } });
    expect(groupStacks(apply(all, plan))[0].head.id).toBe("h");
  });

  it("merges a whole stack carried onto another, and ignores members already there", () => {
    const all = [doc("a1", { stackId: "A" }), doc("a2", { stackId: "A" }), doc("b1", { stackId: "B", stackTop: NOW })];
    const plan = planStack(["a1", "a2", "b1"], "b1", all, NOW, fresh);
    const after = apply(all, plan);
    expect(new Set(after.map((d) => d.stackId))).toEqual(new Set(["B"]));
    expect(planStack(["b1"], "b1", all, NOW, fresh)).toEqual([]);
  });

  it("dissolves the stack a version leaves when only one is left behind", () => {
    const all = [doc("a1", { stackId: "A" }), doc("a2", { stackId: "A" }), doc("x")];
    const plan = planStack(["a2"], "x", all, NOW, fresh);
    expect(plan).toContainEqual({ id: "a1", fields: { stackId: null, stackTop: null } });
  });

  it("uses a fresh id when the target's own id is already a stack's", () => {
    const all = [doc("t"), doc("old1", { stackId: "t" }), doc("old2", { stackId: "t" }), doc("s")];
    expect(newStackId("t", all, () => "zz")).toBe("zz");
    const plan = planStack(["s"], "t", all, NOW, () => "zz");
    expect(plan[0]).toEqual({ id: "t", fields: { stackId: "zz", stackTop: NOW } });
  });
});

describe("planStackAll, planUnstack, planMakeCurrent", () => {
  it("stacks a suggestion with its first member current", () => {
    const all = [doc("v1"), doc("v2"), doc("v3")];
    const plan = planStackAll(["v3", "v1", "v2"], all, NOW, fresh);
    const [group] = groupStacks(apply(all, plan));
    expect(group.head.id).toBe("v3");
    expect(group.members).toHaveLength(3);
  });

  it("takes a version out, and a stack of two becomes two documents", () => {
    const all = [doc("a", { stackId: "S", stackTop: NOW }), doc("b", { stackId: "S" })];
    const after = apply(all, planUnstack("b", all));
    expect(after.every((d) => !d.stackId && !d.stackTop)).toBe(true);
    expect(planUnstack("loose", [doc("loose")])).toEqual([]);
  });

  it("makes a version current", () => {
    const all = [doc("a", { stackId: "S", stackTop: "2026-10-02T00:00:00Z" }), doc("b", { stackId: "S" })];
    const after = apply(all, planMakeCurrent("b", all, NOW));
    expect(groupStacks(after)[0].head.id).toBe("b");
  });
});

describe("planDraftStack", () => {
  it("starts a stack for a draft of a document on its own, the original on top", () => {
    const original = doc("orig");
    const { stackId, originalPatch } = planDraftStack(original, [original], NOW, fresh);
    expect(stackId).toBe("orig");
    expect(originalPatch).toEqual({ id: "orig", fields: { stackId: "orig", stackTop: NOW } });
  });

  it("keeps the original current inside an existing stack", () => {
    const pinned = doc("o", { stackId: "S", stackTop: NOW });
    expect(planDraftStack(pinned, [pinned, doc("x", { stackId: "S" })], NOW, fresh).originalPatch).toBeNull();
    const unpinned = doc("o", { stackId: "S", updatedAt: "2026-10-09T00:00:00Z" });
    expect(planDraftStack(unpinned, [unpinned, doc("x", { stackId: "S" })], NOW, fresh).originalPatch).toEqual({
      id: "o",
      fields: { stackTop: NOW },
    });
  });
});

describe("desk order", () => {
  const all = [doc("a"), doc("b", { stackId: "S" }), doc("c"), doc("d", { stackId: "S" })];
  const keyOf = (id: string) => groupKeyOf(all.find((d) => d.id === id)!);
  const order = all.map((d) => d.id);

  it("moves a whole stack as one, keeping its versions together", () => {
    expect(reorderGroups(order, keyOf, "s:S", 0)).toEqual(["b", "d", "a", "c"]);
    expect(reorderGroups(order, keyOf, "d:c", 1)).toEqual(["a", "c", "b", "d"]);
  });

  it("returns null when a group is dropped where it already is", () => {
    expect(reorderGroups(order, keyOf, "d:a", 0)).toBeNull();
    expect(reorderGroups(order, keyOf, "d:a", 1)).toBeNull();
  });

  it("places arrivals at a slot among the groups", () => {
    expect(insertAtGroupSlot(order, keyOf, ["z"], 1)).toEqual(["a", "z", "b", "d", "c"]);
    expect(insertAtGroupSlot(order, keyOf, ["z"], 99)).toEqual(["a", "b", "d", "c", "z"]);
  });
});
