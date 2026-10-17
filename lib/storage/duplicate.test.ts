import { afterEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, string>();
vi.stubGlobal("window", {
  localStorage: {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  },
  dispatchEvent: () => true,
});

const fetchScript = vi.fn();
vi.mock("@/lib/cloud/scripts", () => ({ fetchScript: (id: string) => fetchScript(id) }));

const { copyTitle, loadBodyForCopy } = await import("./duplicate");
import type { ProjectMeta } from "./projects";

const meta = (over: Partial<ProjectMeta> = {}): ProjectMeta => ({
  id: "p1",
  title: "Pilot",
  type: "screenplay",
  status: "writing",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  cloudCreated: true,
  ...over,
});

afterEach(() => {
  storage.clear();
  fetchScript.mockReset();
});

describe("copyTitle", () => {
  it("adds (copy), then counts up so names never collide", () => {
    expect(copyTitle("Pilot", ["Pilot"])).toBe("Pilot (copy)");
    expect(copyTitle("Pilot", ["Pilot", "Pilot (copy)"])).toBe("Pilot (copy 2)");
    expect(copyTitle("Pilot", ["pilot (COPY)", "Pilot (copy 2)"])).toBe("Pilot (copy 3)");
  });

  it("copies a copy from the original name instead of stacking suffixes", () => {
    expect(copyTitle("Pilot (copy)", ["Pilot", "Pilot (copy)"])).toBe("Pilot (copy 2)");
    expect(copyTitle("Pilot (copy 4)", ["Pilot (copy 4)"])).toBe("Pilot (copy)");
  });

  it("names an untitled document's copy", () => {
    expect(copyTitle("   ", [])).toBe("Untitled (copy)");
  });
});

describe("loadBodyForCopy", () => {
  it("uses the local body and title page without touching the cloud", async () => {
    const doc = { type: "doc", content: [{ type: "paragraph" }] };
    storage.set("less:project:p1:doc", JSON.stringify(doc));
    storage.set("less:project:p1:titlePage", JSON.stringify({ title: "PILOT" }));
    const body = await loadBodyForCopy(meta());
    expect(body?.content).toEqual(doc);
    expect(body?.titlePage).toEqual({ title: "PILOT" });
    expect(fetchScript).not.toHaveBeenCalled();
  });

  it("fetches the cloud copy when this device never loaded the body", async () => {
    const doc = { type: "doc", content: [{ type: "paragraph" }] };
    fetchScript.mockResolvedValue({ content: doc, title_page: { title: "PILOT" } });
    const body = await loadBodyForCopy(meta());
    expect(fetchScript).toHaveBeenCalledWith("p1");
    expect(body).toEqual({ content: doc, titlePage: { title: "PILOT" } });
  });

  it("refuses rather than making an empty copy of a script it cannot read", async () => {
    fetchScript.mockResolvedValue(null);
    expect(await loadBodyForCopy(meta())).toBeNull();
  });

  it("copies a never-synced empty project as empty", async () => {
    const body = await loadBodyForCopy(meta({ cloudCreated: false }));
    expect(body).toEqual({ content: undefined, titlePage: null });
    expect(fetchScript).not.toHaveBeenCalled();
  });
});
