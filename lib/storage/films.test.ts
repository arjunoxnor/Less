import { describe, it, expect } from "vitest";
import {
  filmForFolder,
  filmForProject,
  IMPLICIT_FILM_COLOR,
  listFilms,
  listIdeas,
} from "./films";
import type { ProjectMeta, ProjectType } from "./projects";
import type { Folder } from "./folders";

// These pin the reinterpretation rules the films home renders from. The data
// underneath is frozen, so if one of these fails, the view layer broke, not
// the storage.

let n = 0;
function proj(
  over: Partial<ProjectMeta> & { type: ProjectType; updatedAt: string }
): ProjectMeta {
  n++;
  return {
    id: over.id ?? `p${n}`,
    title: over.title ?? `Project ${n}`,
    status: "writing",
    createdAt: "2026-01-01T00:00:00.000Z",
    cloudCreated: false,
    ...over,
  };
}

function folder(over: Partial<Folder> & { id: string }): Folder {
  return {
    name: over.id,
    color: "#1d9e75",
    stage: "in_progress",
    order: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

const t = (day: number) => `2026-07-${String(day).padStart(2, "0")}T12:00:00.000Z`;

describe("listFilms", () => {
  it("flattens nested folders into their top-level film", () => {
    const folders = [
      folder({ id: "root" }),
      folder({ id: "sub", parentId: "root" }),
      folder({ id: "subsub", parentId: "sub" }),
    ];
    const projects = [
      proj({ id: "d1", type: "screenplay", folderId: "root", updatedAt: t(1) }),
      proj({ id: "d2", type: "screenplay", folderId: "sub", updatedAt: t(5) }),
      proj({ id: "doc", type: "plain", folderId: "subsub", updatedAt: t(3) }),
    ];
    const films = listFilms(projects, folders);
    // One film: the nested folders are views into "root", not films themselves.
    expect(films).toHaveLength(1);
    const film = films[0];
    expect(film.id).toBe("root");
    expect(film.currentDraft?.id).toBe("d2"); // newest screenplay, wherever nested
    expect(film.earlierDrafts.map((p) => p.id)).toEqual(["d1"]);
    expect(film.documents.map((p) => p.id)).toEqual(["doc"]);
    expect(film.lastTouched).toBe(t(5));
  });

  it("treats an orphan folderId as loose, so nothing vanishes", () => {
    const projects = [
      proj({ id: "s", type: "screenplay", folderId: "ghost", updatedAt: t(2) }),
      proj({ id: "d", type: "plain", folderId: "ghost", updatedAt: t(1) }),
    ];
    const films = listFilms(projects, []);
    expect(films).toHaveLength(1);
    expect(films[0].kind).toBe("implicit");
    expect(films[0].currentDraft?.id).toBe("s");
    expect(listIdeas(projects, []).map((p) => p.id)).toEqual(["d"]);
  });

  it("turns a loose screenplay into an implicit film", () => {
    const projects = [
      proj({ id: "s", title: "Cold Open", type: "screenplay", status: "done", updatedAt: t(4) }),
    ];
    const films = listFilms(projects, []);
    expect(films).toHaveLength(1);
    expect(films[0]).toMatchObject({
      kind: "implicit",
      id: "s",
      name: "Cold Open",
      color: IMPLICIT_FILM_COLOR,
      status: "done",
      earlierDrafts: [],
      documents: [],
      lastTouched: t(4),
    });
    expect(films[0].currentDraft?.id).toBe("s");
    // The implicit film's project is also reachable by filmForProject.
    expect(filmForProject("s", projects, [])?.id).toBe("s");
  });

  it("orders films by last touch and makes the freshest one the lead", () => {
    const folders = [folder({ id: "old" }), folder({ id: "hot" })];
    const projects = [
      proj({ id: "a", type: "screenplay", folderId: "old", updatedAt: t(2) }),
      proj({ id: "b", type: "screenplay", folderId: "hot", updatedAt: t(3) }),
      // Touching a mere document in "old" later than everything else must
      // still raise that film to the lead: any touch counts.
      proj({ id: "c", type: "plain", folderId: "old", updatedAt: t(9) }),
      proj({ id: "loose", type: "screenplay", updatedAt: t(5) }),
    ];
    const films = listFilms(projects, folders);
    expect(films.map((f) => f.id)).toEqual(["old", "loose", "hot"]);
    expect(films[0].lastTouched).toBe(t(9));
  });

  it("keeps a folder with zero screenplays as a film without a script", () => {
    const folders = [folder({ id: "f", name: "Notes Only", updatedAt: t(1) })];
    const projects = [
      proj({ id: "doc", type: "plain", folderId: "f", updatedAt: t(6) }),
    ];
    const films = listFilms(projects, folders);
    expect(films).toHaveLength(1);
    expect(films[0].currentDraft).toBeNull();
    expect(films[0].status).toBe("not_started");
    expect(films[0].documents.map((p) => p.id)).toEqual(["doc"]);
    expect(films[0].lastTouched).toBe(t(6));
    // A completely empty folder is still a film, timed by its own clock.
    const empty = listFilms([], [folder({ id: "e", updatedAt: t(2) })]);
    expect(empty).toHaveLength(1);
    expect(empty[0].lastTouched).toBe(t(2));
    expect(filmForFolder("e", [], [folder({ id: "e", updatedAt: t(2) })])?.id).toBe("e");
  });

  it("excludes filed documents from the ideas band", () => {
    const folders = [folder({ id: "f" })];
    const projects = [
      proj({ id: "filed", type: "plain", folderId: "f", updatedAt: t(8) }),
      proj({ id: "loose1", type: "plain", updatedAt: t(2) }),
      proj({ id: "loose2", type: "plain", updatedAt: t(7) }),
      proj({ id: "script", type: "screenplay", updatedAt: t(3) }),
    ];
    // Newest first, filed one absent, screenplay absent (it is a film).
    expect(listIdeas(projects, folders).map((p) => p.id)).toEqual(["loose2", "loose1"]);
    // And the filed document belongs to its film.
    expect(filmForProject("filed", projects, folders)?.id).toBe("f");
  });
});
