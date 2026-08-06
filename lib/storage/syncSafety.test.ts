import { describe, expect, it } from "vitest";
import { stillMatchesField, stillMatchesSnapshot } from "./syncSafety";

describe("async sync completion guards", () => {
  it("does not finalize a body save after the document changes in flight", () => {
    const sent = { type: "doc", content: [{ type: "paragraph", text: "A" }] };
    const snapshot = JSON.stringify(sent);
    const live = { type: "doc", content: [{ type: "paragraph", text: "AB" }] };
    expect(stillMatchesSnapshot(live, snapshot)).toBe(false);
  });

  it("does not finalize a title save after a newer rename", () => {
    expect(stillMatchesField("Third title", "Second title")).toBe(false);
  });

  it("does finalize the exact values that reached the cloud", () => {
    expect(stillMatchesSnapshot({ content: [] }, JSON.stringify({ content: [] }))).toBe(true);
    expect(stillMatchesField("Current", "Current")).toBe(true);
  });
});
