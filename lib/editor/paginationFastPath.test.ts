import { describe, expect, it } from "vitest";

import { passCostTracker, planPages, textSplitModel, type PlanBlock } from "./pagination";

/**
 * What keeps typing cheap on a long script.
 *
 * A keystroke skips the full page pass when it cannot have moved a break (see
 * editKeepsPages in pagination.ts). One of the things that rules the shortcut
 * out is a block whose words the last pass read, because its sentence ends
 * decide where it breaks. So the planner must read the words only of blocks
 * that actually have to break at a page bottom: when it read every speech and
 * every paragraph, typing in any of them ran the whole pass, every key.
 */

const SPEECH =
  "I told you already. I am not going back there, not tonight, not ever. " +
  "You can ask me again in the morning and the answer will be the same.";

function script(scenes: number): { blocks: PlanBlock[]; reads: Set<number> } {
  const reads = new Set<number>();
  const blocks: PlanBlock[] = [];
  const push = (kind: string, rows: number, spaceBefore: number, text?: string) => {
    const index = blocks.length;
    const block: PlanBlock = { kind, rows, spaceBefore, dual: false, cue: kind === "dialogue" };
    if (text != null) {
      const model = textSplitModel(text, kind === "dialogue" ? 35 : 61);
      Object.defineProperty(block, "model", {
        enumerable: true,
        get: () => {
          reads.add(index);
          return model;
        },
      });
    }
    blocks.push(block);
  };
  for (let s = 0; s < scenes; s++) {
    push("scene_heading", 1, 1);
    push("action", 3, 1, SPEECH + " " + SPEECH.slice(0, 40));
    for (let k = 0; k < 4; k++) {
      push("character", 1, 1);
      push("dialogue", 4, 0, SPEECH);
    }
  }
  return { blocks, reads };
}

describe("typing stays on the fast path", () => {
  it("reads the words only of blocks that break at a page bottom", () => {
    const { blocks, reads } = script(120);
    const plan = planPages(blocks, 54);
    const breakable = blocks.filter((b) => b.kind === "dialogue" || b.kind === "action").length;
    expect(plan.pageCount).toBeGreaterThan(50);
    // A page bottom asks at most a couple of blocks (the one that breaks, and
    // the speech a cue keeps with it), never the page's whole contents.
    expect(reads.size).toBeLessThanOrEqual(plan.pageCount * 2);
    expect(reads.size).toBeLessThan(breakable / 4);
  });

  it("keeps the same-frame pass after one slow outlier", () => {
    const cost = passCostTracker();
    expect(cost.typical()).toBe(0);
    // A whole script arriving costs a lot once; ordinary passes after it are
    // cheap, and the very next keystroke should already run in the same frame.
    cost.record(220);
    cost.record(9);
    expect(cost.typical()).toBeLessThan(24);
    for (const ms of [10, 11, 9, 300]) cost.record(ms);
    expect(cost.typical()).toBeLessThan(24);
  });

  it("still defers on a machine that is slow every time", () => {
    const cost = passCostTracker();
    for (const ms of [40, 38, 45, 41, 39]) cost.record(ms);
    expect(cost.typical()).toBeGreaterThan(24);
  });
});
