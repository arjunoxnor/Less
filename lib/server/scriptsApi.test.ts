// The scripts API run for real: the handler in functions/api/[[path]].ts
// against an in-memory SQLite database built from the migration files, the
// same SQL that D1 runs. It pins what "edited" means on the server: edited_at
// moves when the writing changes (a body save, a rename, a create) and never
// for a move, a status change or a regrouping, all of which bump updated_at.

import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// node:sqlite ships with Node 22.13 and later. On an older runtime these tests
// skip rather than fail the deploy gate. It is loaded through Node's own
// require: Vite drops the "node:" prefix from this one, then cannot find it.
type Sqlite = typeof import("node:sqlite");
let sqlite: Sqlite | null = null;
try {
  sqlite = createRequire(import.meta.url)("node:sqlite") as Sqlite;
} catch {
  sqlite = null;
}

type Api = { onRequest: (ctx: unknown) => Promise<Response> };
// Loaded at run time so the app's typecheck stays out of the Workers file.
const API_FILE = fileURLToPath(new URL("../../functions/api/[[path]].ts", import.meta.url));
const { onRequest } = (await import(/* @vite-ignore */ API_FILE)) as Api;

const MIGRATIONS = fileURLToPath(new URL("../../migrations/d1/", import.meta.url));
const CODE = "TESTCODE0123456789ABCDEF"; // a sync code: the identity is its hash

type Db = InstanceType<Sqlite["DatabaseSync"]>;
type Param = string | number | bigint | null | Uint8Array;
let db: Db;

/** Apply the migrations in order: all of them, or those from / before a number. */
function migrate(range: { from?: string; before?: string } = {}) {
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    if (range.from && file < range.from) continue;
    if (range.before && file >= range.before) break;
    db.exec(readFileSync(MIGRATIONS + file, "utf8"));
  }
}

/** The slice of D1's interface the API uses, over node:sqlite. */
function d1() {
  return {
    prepare(query: string) {
      let params: Param[] = [];
      const statement = {
        bind(...values: unknown[]) {
          params = values as Param[];
          return statement;
        },
        async all() {
          return { results: db.prepare(query).all(...params), success: true };
        },
        async first() {
          return db.prepare(query).get(...params) ?? null;
        },
        async run() {
          const result = db.prepare(query).run(...params);
          return { success: true, meta: { changes: Number(result.changes) } };
        },
      };
      return statement;
    },
  };
}

async function call(method: string, path: string, body?: unknown) {
  const res = await onRequest({
    request: new Request(`https://less.test/api/${path}`, {
      method,
      headers: { authorization: `Bearer code:${CODE}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env: { DB: d1(), GOOGLE_CLIENT_ID: "", SESSION_SECRET: "" },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

type ListedRow = { id: string; updated_at: string; edited_at: string | null; placed_at: string };
async function listed(id: string): Promise<ListedRow> {
  const rows = (await call("GET", "scripts")) as unknown as ListedRow[];
  return rows.find((row) => row.id === id)!;
}

const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

/** Each request at its own moment, so "moved" and "stayed" are unambiguous. */
let clock = Date.parse("2026-10-01T09:00:00.000Z");
function tick(): string {
  clock += 60_000;
  vi.setSystemTime(clock);
  return new Date(clock).toISOString();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  if (sqlite) db = new sqlite.DatabaseSync(":memory:");
});

afterEach(() => {
  vi.useRealTimers();
  db?.close();
});

describe.skipIf(!sqlite)("edited_at: when a document's writing last changed", () => {
  it("moves for writing and a create, never for a move, a status change or a regrouping", async () => {
    migrate();
    const created = tick();
    await call("POST", "scripts", { id: "s1", title: "Pilot", content: doc("one"), type: "plain" });
    expect((await listed("s1")).edited_at).toBe(created);

    const wrote = tick();
    await call("PATCH", "scripts/s1", { content: doc("one, two") });
    expect((await listed("s1")).edited_at).toBe(wrote);

    // Arranging and tagging: updated_at moves every time, edited_at never.
    const moved = tick();
    await call("PATCH", "scripts/s1", { folder_id: "f1", position: 2 });
    let row = await listed("s1");
    expect(row.updated_at).toBe(moved);
    expect(row.placed_at).toBe(moved);
    expect(row.edited_at).toBe(wrote);
    tick();
    await call("PATCH", "scripts/s1", { status: "done" });
    tick();
    await call("PATCH", "scripts/s1", { kind: "treatment", stack_id: "stack1" });
    row = await listed("s1");
    expect(row.updated_at).not.toBe(wrote);
    expect(row.edited_at).toBe(wrote);

    // A title PATCH that changes nothing is not an edit; a real rename is.
    tick();
    await call("PATCH", "scripts/s1", { title: "Pilot" });
    expect((await listed("s1")).edited_at).toBe(wrote);
    const renamed = tick();
    await call("PATCH", "scripts/s1", { title: "Pilot, network draft" });
    expect((await listed("s1")).edited_at).toBe(renamed);

    // A title page saved with the body is part of the writing.
    const titlePaged = tick();
    await call("PATCH", "scripts/s1", { content: doc("one, two"), title_page: { author: "A. Writer" } });
    expect((await listed("s1")).edited_at).toBe(titlePaged);
    // Opening it on another device fetches the one row: it carries the time too.
    expect((await call("GET", "scripts/s1")).edited_at).toBe(titlePaged);
  });

  it("re-sending a whole document over an existing row counts as writing", async () => {
    migrate();
    tick();
    await call("POST", "scripts", { id: "s2", title: "Draft", content: doc("first") });
    tick();
    await call("PATCH", "scripts/s2", { folder_id: "f1", position: 0 });
    const resent = tick();
    await call("POST", "scripts", { id: "s2", title: "Draft", content: doc("second") });
    expect((await listed("s2")).edited_at).toBe(resent);
  });

  it("dates existing documents by their writing when the column arrives", async () => {
    migrate({ before: "0008" });
    const U = "c_owner";
    const insert = db.prepare(
      `INSERT INTO scripts (user_id,id,type,title,status,content,created_at,updated_at,placed_at,title_at,status_at,org_at)
       VALUES (?,?,'plain','t','writing','{}',?,?,?,?,?,?)`
    );
    const version = db.prepare(
      "INSERT INTO script_versions (id,user_id,script_id,content,created_at) VALUES (?,?,?,'{}',?)"
    );
    const t = (day: number, hour = 9) => `2026-09-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`;

    // Last touched by a save of its words.
    insert.run(U, "saved", t(1), t(5), t(2), t(1), t(1), null);
    // Created, written (a History snapshot on day 4), then dragged on day 9.
    insert.run(U, "moved", t(1), t(9), t(9), t(1), t(1), null);
    version.run("v1", U, "moved", t(4));
    version.run("v2", U, "moved", t(3));
    // Written, renamed on day 6, then its status changed on day 8.
    insert.run(U, "renamed", t(1), t(8), t(1), t(6), t(8), null);
    version.run("v3", U, "renamed", t(2));
    // Regrouped into a stack on day 7, with no History at all.
    insert.run(U, "stacked", t(2), t(7), t(2), t(2), t(2), t(7));
    // Never touched since it was made: every clock the same.
    insert.run(U, "fresh", t(3), t(3), t(3), t(3), t(3), null);
    // Renamed last: a rename is writing, so updated_at stands.
    insert.run(U, "lastRenamed", t(1), t(6), t(1), t(6), t(1), null);
    // A snapshot from after the move (taken while reading on another device)
    // must not date the writing later than the row itself.
    insert.run(U, "lateSnapshot", t(1), t(5), t(5), t(1), t(1), null);
    version.run("v4", U, "lateSnapshot", t(2));
    version.run("v5", U, "lateSnapshot", t(6));

    migrate({ from: "0008" });
    const edited = Object.fromEntries(
      (db.prepare("SELECT id, edited_at FROM scripts").all() as { id: string; edited_at: string }[]).map(
        (row) => [row.id, row.edited_at]
      )
    );
    expect(edited).toEqual({
      saved: t(5),
      moved: t(4),
      renamed: t(6),
      stacked: t(2),
      fresh: t(3),
      lastRenamed: t(6),
      lateSnapshot: t(2),
    });
  });
});

describe.skipIf(!sqlite)("place: where the writer last was", () => {
  it("is stored on its own clock, never as an edit or a move", async () => {
    migrate();
    tick();
    await call("POST", "scripts", { id: "s1", title: "Pilot", content: doc("one"), type: "plain" });
    const before = await listed("s1");
    const at = tick();
    const saved = await call("PATCH", "scripts/s1/place", { place: { pos: 42, line: "INT. HOUSE", off: 3, junk: 1 } });
    expect(saved.place_at).toBe(at);
    expect(await call("GET", "scripts/s1/place")).toEqual({ place: { pos: 42, line: "INT. HOUSE", off: 3 }, place_at: at });
    const after = await listed("s1");
    expect(after.updated_at).toBe(before.updated_at);
    expect(after.edited_at).toBe(before.edited_at);
  });

  it("refuses a malformed place, and says so for a script that is not there", async () => {
    migrate();
    const res = await onRequest({
      request: new Request("https://less.test/api/scripts/s1/place", {
        method: "PATCH",
        headers: { authorization: `Bearer code:${CODE}`, "content-type": "application/json" },
        body: JSON.stringify({ place: { pos: "x" } }),
      }),
      env: { DB: d1(), GOOGLE_CLIENT_ID: "", SESSION_SECRET: "" },
    });
    expect(res.status).toBe(400);
    expect((await call("PATCH", "scripts/nope/place", { place: { pos: 1, line: "", off: 0 } })).place_at).toBeNull();
  });
});

describe.skipIf(!sqlite)("bookmarks in the list's cover digest", () => {
  it("lists each document's bookmarks without sending its body", async () => {
    migrate();
    tick();
    const content = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "One." }] },
        {
          type: "paragraph",
          attrs: { bookmark: { id: "abc123", color: "blue", name: "Fix this" } },
          content: [{ type: "text", text: "Two." }],
        },
        { type: "paragraph", attrs: { bookmark: { id: "x", color: "pink" } }, content: [{ type: "text", text: "Bad." }] },
      ],
    };
    await call("POST", "scripts", { id: "s1", title: "Notes", content, type: "plain" });
    const row = (await listed("s1")) as unknown as { digest: unknown };
    const digest = typeof row.digest === "string" ? JSON.parse(row.digest) : row.digest;
    expect(digest.bookmarks).toEqual([{ id: "abc123", color: "blue", name: "Fix this", text: "Two.", pos: 6 }]);
  });
});
