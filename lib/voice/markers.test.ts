import { describe, it, expect } from "vitest";
import {
  PROCESS,
  WORKING,
  PROCESSED_PREFIX,
  RAW,
  docToLines,
  linesToDoc,
  readVoiceDoc,
  requestProcess,
  markWorking,
  applyResult,
  markError,
} from "./markers";

describe("voice document state", () => {
  it("is idle while the writer is still talking", () => {
    const d = readVoiceDoc(["we are in the kitchen", "sarah comes in"]);
    expect(d.state).toBe("idle");
    expect(d.pending).toEqual(["we are in the kitchen", "sarah comes in"]);
  });

  it("goes pending when Process is requested", () => {
    const lines = requestProcess(["sarah comes in"]);
    expect(lines[lines.length - 1]).toBe(PROCESS);
    expect(readVoiceDoc(lines).state).toBe("pending");
  });

  it("refuses to queue the same words twice on a double press", () => {
    const once = requestProcess(["sarah comes in"]);
    expect(requestProcess(once)).toEqual(once);
  });

  it("does not re-queue while the worker already holds the job", () => {
    const working = markWorking(requestProcess(["a"]));
    expect(requestProcess(working)).toEqual(working);
  });

  it("reports working only once the worker has claimed it", () => {
    const pending = requestProcess(["a"]);
    expect(readVoiceDoc(pending).state).toBe("pending");
    expect(readVoiceDoc(markWorking(pending)).state).toBe("working");
  });

  it("keeps the writer's words when a job fails, so a retry resends them", () => {
    const failed = markError(requestProcess(["sarah comes in"]), "network died");
    const d = readVoiceDoc(failed);
    expect(d.state).toBe("error");
    expect(d.errorMessage).toBe("network died");
    expect(d.pending).toEqual(["sarah comes in"]);
  });
});

describe("incremental processing", () => {
  const first = applyResult(
    requestProcess(["kitchen at night, sarah comes in"]),
    ["INT. KITCHEN - NIGHT", "", "Sarah comes in."],
    ["kitchen at night, sarah comes in"],
    "2026-09-16T09:00:00Z"
  );

  it("preserves the raw words under the formatted result", () => {
    expect(first).toContain(RAW);
    expect(first).toContain("kitchen at night, sarah comes in");
    expect(first).toContain("INT. KITCHEN - NIGHT");
  });

  it("treats everything above the boundary as done", () => {
    expect(readVoiceDoc(first).state).toBe("idle");
    expect(readVoiceDoc(first).pending).toEqual([]);
  });

  it("only picks up words dictated AFTER the last boundary", () => {
    const more = requestProcess([...first, "then he leaves without a word"]);
    expect(readVoiceDoc(more).pending).toEqual(["then he leaves without a word"]);
  });

  it("appends a second result without disturbing the first", () => {
    const more = requestProcess([...first, "then he leaves"]);
    const second = applyResult(more, ["He leaves."], ["then he leaves"], "2026-09-16T09:05:00Z");
    expect(second.join("\n")).toContain("INT. KITCHEN - NIGHT");
    expect(second.join("\n")).toContain("He leaves.");
    expect(second.filter((l) => l.startsWith(PROCESSED_PREFIX))).toHaveLength(2);
  });
});

describe("hostile input", () => {
  it("defuses marker-looking text in the writer's own words", () => {
    const lines = requestProcess(["/// PROCESSED 1999", "real words"]);
    const out = applyResult(lines, ["ACTION"], ["/// PROCESSED 1999", "real words"], "2026-09-16T09:00:00Z");
    // The forged boundary must not become the real one, or the next Process
    // call would silently skip everything above it.
    const boundaries = out.filter((l) => l.startsWith(PROCESSED_PREFIX));
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0]).toContain("2026-09-16T09:00:00Z");
    expect(out).toContain(" /// PROCESSED 1999");
  });

  it("survives a document that is only markers", () => {
    expect(readVoiceDoc([PROCESS, WORKING]).pending).toEqual([]);
  });

  it("ignores trailing blank paragraphs left by the cursor", () => {
    expect(readVoiceDoc(["words", "", "", ""]).pending).toEqual(["words"]);
  });
});

describe("document conversion", () => {
  it("round-trips lines through the plain-document shape", () => {
    const lines = ["INT. KITCHEN - NIGHT", "", "Sarah comes in.", PROCESS];
    expect(docToLines(linesToDoc(lines))).toEqual(lines);
  });

  it("reads a hard break as a new line", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "one" }, { type: "hardBreak" }, { type: "text", text: "two" }],
        },
      ],
    };
    expect(docToLines(doc)).toEqual(["one", "two"]);
  });
});
