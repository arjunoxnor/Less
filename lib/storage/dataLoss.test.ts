// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JSONContent } from "@tiptap/core";
import * as projects from "./projects";

type SetBehavior = (
  key: string,
  value: string,
  values: Map<string, string>
) => "stored" | "handled";

let values: Map<string, string>;
let setBehavior: SetBehavior | null;

function installStorage(opts?: { throwEverywhere?: boolean }) {
  values = new Map<string, string>();
  setBehavior = null;
  const storage = {
    get length() {
      if (opts?.throwEverywhere) throw new DOMException("disabled", "SecurityError");
      return values.size;
    },
    key(index: number) {
      if (opts?.throwEverywhere) throw new DOMException("disabled", "SecurityError");
      return [...values.keys()][index] ?? null;
    },
    getItem(key: string) {
      if (opts?.throwEverywhere) throw new DOMException("disabled", "SecurityError");
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      if (opts?.throwEverywhere) throw new DOMException("disabled", "SecurityError");
      if (setBehavior?.(key, String(value), values) === "handled") return;
      values.set(key, String(value));
    },
    removeItem(key: string) {
      if (opts?.throwEverywhere) throw new DOMException("disabled", "SecurityError");
      values.delete(key);
    },
    clear() {
      if (opts?.throwEverywhere) throw new DOMException("disabled", "SecurityError");
      values.clear();
    },
  };
  Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
}

const doc = (text: string): JSONContent => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

beforeEach(() => installStorage());

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("quota and unavailable storage", () => {
  it("keeps the old body when quota rejects the pending copy", () => {
    const project = projects.createProject("plain", { content: doc("entire first draft") });
    expect(projects.loadProjectDoc(project.id)).toEqual(doc("entire first draft"));
    setBehavior = (key) => {
      if (key === `less:project:${project.id}:doc:pending`) {
        throw new DOMException("full", "QuotaExceededError");
      }
      return "stored";
    };

    expect(projects.saveProjectDoc(project.id, doc("new paragraph"))).toBe(false);
    expect(projects.loadProjectDoc(project.id)).toEqual(doc("entire first draft"));
  });

  it("commits a new project through the pending index when the index key is full", () => {
    setBehavior = (key) => {
      if (key === "less:projects:index") {
        throw new DOMException("full", "QuotaExceededError");
      }
      return "stored";
    };
    const created = projects.createProject("plain", { content: doc("quota-index work") });

    expect(projects.listProjects().map((entry) => entry.id)).toContain(created.id);
    expect(projects.loadProjectDoc(created.id)).toEqual(doc("quota-index work"));
  });

  it("keeps exactly one body and one backup after a successful save", () => {
    // Three full copies of every body (doc + doc:pending + doc:backup) put ten
    // features past the ~5M char quota, after which every autosave fails and
    // the writer's text lives only in the tab. The mirror exists to cover a
    // failed primary write, so a verified primary must retire it.
    const project = projects.createProject("plain", { content: doc("first draft") });
    expect(projects.saveProjectDoc(project.id, doc("second draft"))).toBe(true);

    expect(values.has(`less:project:${project.id}:doc:pending`)).toBe(false);
    expect(JSON.parse(values.get(`less:project:${project.id}:doc`)!)).toEqual(doc("second draft"));
    expect(JSON.parse(values.get(`less:project:${project.id}:doc:backup`)!)).toEqual(
      doc("first draft")
    );
    expect(projects.loadProjectDoc(project.id)).toEqual(doc("second draft"));
  });

  it("keeps exactly one title page and one backup after a successful save", () => {
    const project = projects.createProject("screenplay", { content: doc("script") });
    expect(projects.saveProjectTitlePage(project.id, { title: "First" })).toBe(true);
    expect(projects.saveProjectTitlePage(project.id, { title: "Second" })).toBe(true);

    expect(values.has(`less:project:${project.id}:titlePage:pending`)).toBe(false);
    expect(projects.loadProjectTitlePage(project.id)).toEqual({ title: "Second" });
  });

  it("renders the index without parsing any project body", () => {
    // The file header's invariant, and the reason it matters: readIndex runs
    // three times per autosave, so parsing every body made each save cost tens
    // of milliseconds of synchronous main-thread work.
    const project = projects.createProject("plain", { content: doc("a whole feature") });
    const stored = values.get(`less:project:${project.id}:doc`)!;
    const parse = vi.spyOn(JSON, "parse");

    expect(projects.listProjects().map((entry) => entry.id)).toContain(project.id);
    expect(parse.mock.calls.some(([value]) => value === stored)).toBe(false);
  });

  it("evicts a synced body once it falls out of the recently-opened window", () => {
    // The protection list is what eviction draws from, so an append-only list
    // made the quota relief valve permanently return 0: a full disk stayed full
    // and every later autosave failed.
    const older = projects.createProject("plain", { content: doc("older synced work") });
    const recent = Array.from({ length: 4 }, (_, index) =>
      projects.createProject("plain", { content: doc(`recent ${index}`) })
    );
    for (const project of [older, ...recent]) {
      projects.markCloudCreated(project.id);
      projects.setLastSavedAt(project.id, "2026-08-05T00:00:00.000Z");
      projects.setLastOpenedId(project.id);
    }

    expect(projects.evictSyncedBodies({ exceptId: null, max: 5 })).toBe(1);
    expect(projects.loadProjectDoc(older.id)).toBeNull();
    expect(projects.getProjectMeta(older.id)?.bodyEvicted).toBe(true);
    for (const project of recent) {
      expect(projects.loadProjectDoc(project.id)).not.toBeNull();
    }
  });

  it("does not evict either project open in two tabs", () => {
    const first = projects.createProject("plain", { content: doc("tab one") });
    const second = projects.createProject("plain", { content: doc("tab two") });
    for (const project of [first, second]) {
      projects.markCloudCreated(project.id);
      projects.setLastSavedAt(project.id, "2026-08-05T00:00:00.000Z");
      projects.setLastOpenedId(project.id);
    }

    expect(projects.evictSyncedBodies({ exceptId: null, max: 5 })).toBe(0);
    expect(projects.loadProjectDoc(first.id)).toEqual(doc("tab one"));
    expect(projects.loadProjectDoc(second.id)).toEqual(doc("tab two"));
  });

  it("fails loudly without inventing a saved project when every access throws", async () => {
    installStorage({ throwEverywhere: true });
    vi.resetModules();
    const privateMode = await import("./projects");

    expect(privateMode.listProjects()).toEqual([]);
    expect(() => privateMode.createProject("plain", { content: doc("memory only") })).toThrow(
      /could not be saved/
    );
    expect(privateMode.saveProjectDoc("missing", doc("memory only"))).toBe(false);
  });
});

describe("corruption and crash recovery", () => {
  it.each(["not json", JSON.stringify({ projects: [] })])(
    "rebuilds a corrupt/non-array index from independent bodies (%s)",
    (badIndex) => {
      values.set("less:projects:index", badIndex);
      values.set("less:project:orphan:doc", JSON.stringify(doc("orphaned manuscript")));

      const recovered = projects.listProjects();
      expect(recovered).toHaveLength(1);
      expect(recovered[0].id).toBe("orphan");
      expect(projects.loadProjectDoc("orphan")).toEqual(doc("orphaned manuscript"));
    }
  );

  it("repairs an index entry missing required fields without hiding its body", () => {
    values.set("less:projects:index", JSON.stringify([{ id: "damaged-meta" }]));
    values.set("less:project:damaged-meta:doc", JSON.stringify(doc("still here")));

    const [meta] = projects.listProjects();
    expect(meta).toMatchObject({ id: "damaged-meta", type: "plain", cloudCreated: false });
    expect(meta.title).toBeTruthy();
    expect(projects.loadProjectDoc(meta.id)).toEqual(doc("still here"));
  });

  it("recovers a body with no index and blocks an indexed row with no body from opening blank", () => {
    const ts = "2026-08-05T00:00:00.000Z";
    values.set(
      "less:projects:index",
      JSON.stringify([
        {
          id: "missing-body",
          title: "Do not blank me",
          type: "plain",
          status: "writing",
          createdAt: ts,
          updatedAt: ts,
          cloudCreated: true,
        },
      ])
    );
    values.set("less:project:body-only:doc", JSON.stringify(doc("found body")));

    expect(projects.getProjectMeta("body-only")).not.toBeNull();
    expect(projects.getProjectMeta("missing-body")?.bodyEvicted).toBe(true);
    expect(projects.loadProjectDoc("missing-body")).toBeNull();
  });

  it("deduplicates corrupt index ids and never reuses a colliding random id", () => {
    const first = projects.createProject("plain", { content: doc("first body") });
    const raw = JSON.parse(values.get("less:projects:index:pending")!) as unknown[];
    values.set("less:projects:index:pending", JSON.stringify([...raw, raw[0]]));
    expect(projects.listProjects().filter((entry) => entry.id === first.id)).toHaveLength(1);

    vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce(first.id as `${string}-${string}-${string}-${string}-${string}`)
      .mockReturnValue("00000000-0000-4000-8000-000000000002");
    const second = projects.createProject("plain", { content: doc("second body") });
    expect(second.id).not.toBe(first.id);
    expect(projects.loadProjectDoc(first.id)).toEqual(doc("first body"));
    expect(projects.loadProjectDoc(second.id)).toEqual(doc("second body"));
  });

  it("uses the complete mirror when a crash silently truncates the primary body", () => {
    const project = projects.createProject("plain", { content: doc("before crash") });
    projects.loadProjectDoc(project.id);
    setBehavior = (key, value, store) => {
      if (key === `less:project:${project.id}:doc`) {
        store.set(key, value.slice(0, Math.max(1, value.length - 7)));
        return "handled";
      }
      return "stored";
    };

    expect(projects.saveProjectDoc(project.id, doc("last complete sentence"))).toBe(true);
    expect(projects.loadProjectDoc(project.id)).toEqual(doc("last complete sentence"));
  });
});

describe("deleting is always possible", () => {
  it("deletes and frees the body even when the tombstone write fails", () => {
    // Deleting is the writer's own remedy for a full disk. If bookkeeping can
    // block it, clicking Delete does nothing, silently, exactly when it matters.
    const project = projects.createProject("plain", { content: doc("take this off my disk") });
    setBehavior = (key) => {
      if (key.startsWith("less:projects:tombstones")) {
        throw new DOMException("full", "QuotaExceededError");
      }
      return "stored";
    };

    expect(projects.deleteProject(project.id)).toBe(true);
    expect(projects.getProjectMeta(project.id)).toBeNull();
    expect(values.has(`less:project:${project.id}:doc`)).toBe(false);
    expect(values.has(`less:project:${project.id}:doc:backup`)).toBe(false);
  });

  it("is not blocked by a corrupt legacy deleted-copies archive, and clears it", () => {
    const project = projects.createProject("plain", { content: doc("still deletable") });
    values.set("less:projects:deletedCopies", "{ truncated");

    expect(projects.deleteProject(project.id)).toBe(true);
    expect(projects.getProjectMeta(project.id)).toBeNull();
    expect(values.has("less:projects:deletedCopies")).toBe(false);
  });
});

describe("cross-tab conflict copies", () => {
  async function twoTabs() {
    vi.stubGlobal("BroadcastChannel", undefined);
    vi.resetModules();
    const tabA = await import("./projects");
    const project = tabA.createProject("plain", { title: "Novel", content: doc("shared start") });
    tabA.loadProjectDoc(project.id);
    vi.resetModules();
    const tabB = await import("./projects");
    tabB.loadProjectDoc(project.id);
    return { tabA, tabB, project };
  }

  it("keeps both tabs' typing when BroadcastChannel is unavailable", async () => {
    const { tabA, tabB, project } = await twoTabs();
    expect(tabA.saveProjectDoc(project.id, doc("tab A ending"))).toBe(true);
    expect(tabB.saveProjectDoc(project.id, doc("tab B ending"))).toBe(true);

    const all = tabA.listProjects();
    const conflict = all.find((entry) => entry.id !== project.id)!;
    expect(all).toHaveLength(2);
    expect(conflict.title).toContain("Recovered conflict");
    expect(tabA.loadProjectDoc(project.id)).toEqual(doc("tab A ending"));
    expect(tabA.loadProjectDoc(conflict.id)).toEqual(doc("tab B ending"));
  });

  it("turns an edit after a sibling deletion into a new copy, not a resurrection", async () => {
    const { tabA, tabB, project } = await twoTabs();
    expect(tabA.deleteProject(project.id)).toBe(true);
    expect(tabB.saveProjectDoc(project.id, doc("typed after deletion"))).toBe(true);

    const all = tabA.listProjects();
    expect(tabA.getProjectMeta(project.id)).toBeNull();
    expect(tabA.listTombstones()).toContain(project.id);
    expect(all).toHaveLength(1);
    expect(tabA.loadProjectDoc(all[0].id)).toEqual(doc("typed after deletion"));
  });

  it("forks a history restore rather than overwriting a sibling's fresh save", async () => {
    const { tabA, tabB, project } = await twoTabs();
    expect(tabA.saveProjectDoc(project.id, doc("fresh sibling save"))).toBe(true);
    expect(tabB.saveProjectDoc(project.id, doc("restored older chapter"))).toBe(true);

    const all = tabA.listProjects();
    expect(tabA.loadProjectDoc(project.id)).toEqual(doc("fresh sibling save"));
    expect(
      all.some(
        (entry) => entry.id !== project.id && JSON.stringify(tabA.loadProjectDoc(entry.id)) === JSON.stringify(doc("restored older chapter"))
      )
    ).toBe(true);
  });
});

describe("version history and migration", () => {
  it("bounds the ring and makes a restore undoable", () => {
    const project = projects.createProject("plain", { content: doc("live draft") });
    for (let index = 0; index < 20; index++) {
      expect(projects.addLocalVersion(project.id, doc(`version ${index}`), null, undefined, { force: true })).toBe(true);
    }
    expect(projects.listLocalVersions(project.id)).toHaveLength(8);

    projects.loadProjectDoc(project.id);
    projects.addLocalVersion(project.id, doc("live draft"), null, "Before restore", { force: true });
    expect(projects.saveProjectDoc(project.id, doc("restored draft"))).toBe(true);
    expect(projects.listLocalVersions(project.id).some((version) => JSON.stringify(version.content) === JSON.stringify(doc("live draft")))).toBe(true);
    projects.addLocalVersion(project.id, doc("restored draft"), null, "Before undo", { force: true });
    expect(projects.saveProjectDoc(project.id, doc("live draft"))).toBe(true);
    expect(projects.listLocalVersions(project.id).some((version) => JSON.stringify(version.content) === JSON.stringify(doc("restored draft")))).toBe(true);
  });

  it("migrates the legacy document exactly once and leaves the original untouched", () => {
    const legacy = JSON.stringify({
      type: "doc",
      content: [{ type: "screenplayLine", attrs: { element: "action" }, content: [{ type: "text", text: "Legacy pages" }] }],
    });
    values.set("less:script:current", legacy);

    projects.migrateLegacyDoc();
    const once = projects.listProjects();
    projects.migrateLegacyDoc();
    const twice = projects.listProjects();

    expect(once).toHaveLength(1);
    expect(twice.map((entry) => entry.id)).toEqual(once.map((entry) => entry.id));
    expect(values.get("less:script:current")).toBe(legacy);
    expect(projects.loadProjectDoc(once[0].id)).toEqual(JSON.parse(legacy));
  });
});
