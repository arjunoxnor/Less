import { describe, expect, it } from "vitest";
import { listLibrary, folderView, cardForProject } from "./library";
import type { ProjectMeta } from "./projects";
import type { Folder } from "./folders";

/**
 * The fixture is deliberately shaped like a real library that broke the old
 * model: the top level is stages (Completed / InProgress / IdeaFactory), the
 * projects live one level down, and drafts live two levels down. The old code
 * called a top-level folder a "film" and flattened everything under it, which
 * hid every name that mattered. These tests pin the replacement: a folder is a
 * folder, at the depth the writer built it.
 */

let clock = 0;
const t = (n: number) => `2026-07-${String(n).padStart(2, "0")}T00:00:00.000Z`;

function folder(id: string, name: string, parentId?: string, order = clock++): Folder {
  return {
    id,
    name,
    color: "#3F7D5C",
    stage: "idea",
    ...(parentId ? { parentId } : {}),
    order,
    createdAt: t(1),
    updatedAt: t(1),
  };
}

function proj(
  id: string,
  title: string,
  folderId: string | undefined,
  day: number,
  type: ProjectMeta["type"] = "screenplay",
  createdDay = 1
): ProjectMeta {
  return {
    id,
    title,
    type,
    status: "writing",
    createdAt: t(createdDay),
    updatedAt: t(day),
    cloudCreated: true,
    ...(folderId ? { folderId } : {}),
  };
}

const FOLDERS: Folder[] = [
  folder("completed", "Completed"),
  folder("shorts", "Shorts", "completed"),
  folder("features", "Feature Length", "completed"),
  folder("inprogress", "InProgress"),
  folder("gooa", "GodsOfOurAncestors", "inprogress"),
  folder("olddrafts", "Old Drafts", "gooa"),
  folder("chess", "ChessMaster", "inprogress"),
  folder("onepagers", "One Pagers", "chess"),
  folder("ideafactory", "IdeaFactory"),
  folder("junk", "Archive/Junk", "ideafactory"),
];

const PROJECTS: ProjectMeta[] = [
  proj("s1", "Midnight Drive", "shorts", 2),
  proj("f1", "The Innocent", "features", 3),
  proj("g1", "GooA D5", "gooa", 20, "screenplay", 2),
  proj("g2", "GooA brainstorming", "gooa", 22, "plain", 8),
  proj("o1", "GOOA Draft 1", "olddrafts", 5, "screenplay", 3),
  proj("o2", "GooA draft 4", "olddrafts", 6, "screenplay", 4),
  proj("c1", "3.1 One Pager", "onepagers", 10, "plain"),
  proj("j1", "Chapatis", "junk", 4),
  proj("loose1", "Random Brainstorm", "ideafactory", 8, "plain"),
  proj("free1", "Lighthouse idea", undefined, 9, "plain"),
];

describe("listLibrary", () => {
  it("makes top-level folders sections and their children cards", () => {
    const { sections } = listLibrary(PROJECTS, FOLDERS);
    // The writer's own folder order, not a clock: Completed was made first.
    expect(sections.map((s) => s.folder.name)).toEqual([
      "Completed",
      "InProgress",
      "IdeaFactory",
    ]);
    const inprogress = sections.find((s) => s.folder.id === "inprogress")!;
    expect(inprogress.cards.map((c) => c.folder.name)).toEqual([
      "GodsOfOurAncestors",
      "ChessMaster",
    ]);
  });

  it("keeps folders deeper than a card as shelves inside that card", () => {
    const { sections } = listLibrary(PROJECTS, FOLDERS);
    const gooa = sections
      .flatMap((s) => s.cards)
      .find((c) => c.folder.id === "gooa")!;
    // Its own two projects stay direct; Old Drafts becomes a labeled shelf.
    // Oldest first. By recency the brainstorming doc (day 22) would lead.
    expect(gooa.items.map((p) => p.title)).toEqual(["GooA D5", "GooA brainstorming"]);
    expect(gooa.shelves.map((s) => s.folder.name)).toEqual(["Old Drafts"]);
    expect(gooa.shelves[0].items.map((p) => p.title)).toEqual([
      "GOOA Draft 1",
      "GooA draft 4",
    ]);
    expect(gooa.total).toBe(4);
  });

  it("counts a card that only holds sub-folders", () => {
    const { sections } = listLibrary(PROJECTS, FOLDERS);
    const chess = sections
      .flatMap((s) => s.cards)
      .find((c) => c.folder.id === "chess")!;
    expect(chess.items).toEqual([]);
    expect(chess.total).toBe(1);
    expect(chess.current?.title).toBe("3.1 One Pager");
  });

  it("leads a card with its newest SCREENPLAY, not its newest note", () => {
    const { sections } = listLibrary(PROJECTS, FOLDERS);
    const gooa = sections.flatMap((s) => s.cards).find((c) => c.folder.id === "gooa")!;
    // The brainstorming doc is newer, but you continue a script.
    expect(gooa.current?.title).toBe("GooA D5");
  });

  it("surfaces a project filed straight into a section, and unfiled ones", () => {
    const { sections, unfiled } = listLibrary(PROJECTS, FOLDERS);
    const factory = sections.find((s) => s.folder.id === "ideafactory")!;
    expect(factory.loose.map((p) => p.title)).toEqual(["Random Brainstorm"]);
    expect(unfiled.map((p) => p.title)).toEqual(["Lighthouse idea"]);
  });

  it("never loses a project whose folder is gone", () => {
    const orphan = proj("x1", "Homeless", "deleted-folder", 7);
    const { unfiled } = listLibrary([...PROJECTS, orphan], FOLDERS);
    expect(unfiled.map((p) => p.title)).toContain("Homeless");
  });

  it("hoists a folder whose parent no longer exists to the top level", () => {
    const stray = folder("stray", "Stray", "missing-parent");
    const { sections } = listLibrary(PROJECTS, [...FOLDERS, stray]);
    expect(sections.map((s) => s.folder.name)).toContain("Stray");
  });

  it("survives a parent cycle without hanging or dropping a folder", () => {
    const a = { ...folder("a", "A"), parentId: "b" };
    const b = { ...folder("b", "B"), parentId: "a" };
    const { sections } = listLibrary([], [a, b]);
    const names = sections.map((s) => s.folder.name);
    expect(names).toContain("A");
    expect(names).toContain("B");
  });

  it("keeps cards in the writer's folder order, not in clock order", () => {
    const { sections } = listLibrary(PROJECTS, FOLDERS);
    const completed = sections.find((s) => s.folder.id === "completed")!;
    // Shorts was made before Feature Length, and holds the older script, so a
    // recency order would put Feature Length first.
    expect(completed.cards.map((c) => c.folder.name)).toEqual([
      "Shorts",
      "Feature Length",
    ]);
  });

  it("does not move anything when a project is filed into a folder", () => {
    // The exact complaint: dragging something into a folder stamps its clock,
    // and the page must not rearrange itself in response.
    const before = listLibrary(PROJECTS, FOLDERS);
    const positions = (lib: ReturnType<typeof listLibrary>) => ({
      sections: lib.sections.map((s) => s.folder.name),
      cards: lib.sections.flatMap((s) => s.cards.map((c) => c.folder.name)),
      shortsItems: lib.sections
        .flatMap((s) => s.cards)
        .find((c) => c.folder.id === "shorts")!
        .items.map((p) => p.title),
    });
    // "Midnight Drive" is filed into Shorts and its clock jumps to the newest
    // moment in the whole library.
    const moved = PROJECTS.map((p) =>
      p.id === "s1" ? { ...p, folderId: "shorts", updatedAt: t(28) } : p
    );
    expect(positions(listLibrary(moved, FOLDERS))).toEqual(positions(before));
  });

  it("respects a manual position over the created order", () => {
    const withOrder = PROJECTS.map((p) =>
      p.id === "g2" ? { ...p, order: 0 } : p.id === "g1" ? { ...p, order: 1 } : p
    );
    const gooa = listLibrary(withOrder, FOLDERS)
      .sections.flatMap((s) => s.cards)
      .find((c) => c.folder.id === "gooa")!;
    expect(gooa.items.map((p) => p.title)).toEqual(["GooA brainstorming", "GooA D5"]);
  });
});

describe("folderView", () => {
  it("gives a folder its breadcrumb, its items and its shelves", () => {
    const v = folderView("gooa", PROJECTS, FOLDERS)!;
    expect(v.trail.map((f) => f.name)).toEqual(["InProgress"]);
    expect(v.depth).toBe(1);
    expect(v.shelves.map((s) => s.folder.name)).toEqual(["Old Drafts"]);
    expect(v.current?.title).toBe("GooA D5");
  });

  it("works for a folder deeper than a card", () => {
    const v = folderView("olddrafts", PROJECTS, FOLDERS)!;
    expect(v.trail.map((f) => f.name)).toEqual(["InProgress", "GodsOfOurAncestors"]);
    expect(v.depth).toBe(2);
    expect(v.items.map((p) => p.title)).toEqual(["GOOA Draft 1", "GooA draft 4"]);
  });

  it("returns null for an unknown folder", () => {
    expect(folderView("nope", PROJECTS, FOLDERS)).toBeNull();
  });
});

describe("cardForProject", () => {
  it("climbs from a deep project to the card it lives on", () => {
    const card = cardForProject("o1", PROJECTS, FOLDERS)!;
    expect(card.folder.name).toBe("GodsOfOurAncestors");
    expect(card.total).toBe(4);
  });

  it("uses the section itself when a project has no card", () => {
    const card = cardForProject("loose1", PROJECTS, FOLDERS)!;
    expect(card.folder.name).toBe("IdeaFactory");
  });

  it("is null for an unfiled project", () => {
    expect(cardForProject("free1", PROJECTS, FOLDERS)).toBeNull();
  });
});
