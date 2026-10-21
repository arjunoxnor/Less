// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { freeHistorySpace, listLocalVersions } from "./projects";

const ring = (n: number) =>
  JSON.stringify(Array.from({ length: n }, (_, i) => ({ at: new Date(2026, 9, 21, 12, 60 - i).toISOString(), content: { type: "doc" } })));

describe("a full device", () => {
  it("gives up old on-device history before the writing", () => {
    localStorage.setItem("less:project:a:localvers", ring(8));
    localStorage.setItem("less:project:b:localvers", ring(8));
    expect(freeHistorySpace("a")).toBe(true);
    expect(listLocalVersions("a")).toHaveLength(2);
    expect(listLocalVersions("b")).toHaveLength(1);
    // The newest survives.
    expect(listLocalVersions("b")[0].at).toBe(JSON.parse(ring(1))[0].at);
    expect(freeHistorySpace("a")).toBe(false);
  });
});
