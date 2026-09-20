/**
 * The outside writer: how a Claude Code session edits a LESS document on the
 * writer's behalf without ever costing him words.
 *
 * LESS is local-first. The browser holds its own copy of every document and the
 * cloud row is last-write-wins, so a careless outside write is either lost (an
 * open tab saves over it) or destructive (it replaces words typed since it was
 * read). Four rules, enforced here rather than remembered:
 *
 *  1. Read before writing. `put` refuses to run without the updated_at that
 *     `get` printed, and the UPDATE is conditional on it. Exit code 3 means the
 *     document changed in between: get it again and redo the work on top.
 *  2. Both versions go to History first. The body being replaced and the body
 *     replacing it are each stored in script_versions with a label, so either
 *     is one click away in the document's History panel.
 *  3. Body only. Title, status, and folder have their own sync clocks and their
 *     own endpoints; this tool never touches them on an existing row.
 *  4. One account. Every statement is scoped to LESS_USER_ID. LESS has other
 *     users, and their rows are out of reach by construction.
 *
 * The app does its half since the synced-baseline change (lib/storage/
 * syncBaseline.ts): an open document notices the new body when the writer
 * returns to the tab, or within about 20 seconds, and loads it in place. Before
 * that change an open tab silently replaced outside writes; a browser still
 * running an older cached build behaves the old way until it reloads.
 *
 *   node --import ./tools/voice/register.mjs tools/write/write.ts get <id> [out.json]
 *   node --import ./tools/voice/register.mjs tools/write/write.ts put <id> <updated_at> <file> "<label>"
 *   node --import ./tools/voice/register.mjs tools/write/write.ts new "<title>" <file> [folderId]
 *
 * <file> is a .fountain scene (screenplays only; parsed with the app's own
 * parser, so it lands exactly as an import would) or a .json TipTap document.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { parseFountain } from "../../lib/export/fountain.ts";
import { linesToDoc } from "../../lib/export/flatten.ts";

const DB = "ec14ff01-64ae-48e0-b176-0ffa0bf596e9";
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const USER = process.env.LESS_USER_ID ?? process.env.LESS_VOICE_USER_ID;

if (!ACCOUNT || !TOKEN) {
  console.error("Missing Cloudflare credentials. Source secrets/cloudflare.env first.");
  process.exit(2);
}
if (!USER) {
  console.error("Missing LESS_USER_ID: the one account this tool may touch.");
  process.exit(2);
}

interface Row {
  id: string;
  type: string;
  title: string;
  content: string | null;
  title_page: string | null;
  folder_id: string | null;
  updated_at: string;
}
interface D1Result {
  results?: Row[];
  meta?: { changes?: number };
}
interface Doc {
  type: string;
  content?: Doc[];
  text?: string;
}

async function sql(statement: string, params: unknown[] = []): Promise<D1Result> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DB}/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sql: statement, params }),
    }
  );
  const body = (await res.json()) as { success: boolean; result: D1Result[]; errors?: unknown };
  if (!body.success) throw new Error(`D1: ${JSON.stringify(body.errors ?? body)}`);
  return body.result[0];
}

const emit = (value: unknown) => console.log(JSON.stringify(value, null, 2));
const now = () => new Date().toISOString();

function words(doc: Doc | null): number {
  if (!doc) return 0;
  const own = typeof doc.text === "string" ? doc.text.split(/\s+/).filter(Boolean).length : 0;
  return own + (doc.content ?? []).reduce((sum, child) => sum + words(child), 0);
}

async function load(id: string): Promise<Row> {
  const out = await sql(
    "SELECT id, type, title, content, title_page, folder_id, updated_at FROM scripts WHERE user_id = ? AND id = ?",
    [USER, id]
  );
  const row = (out.results ?? [])[0];
  if (!row) throw new Error(`No document ${id} for this account`);
  return row;
}

/** Read a .fountain or .json file into a body that fits the given row type. */
function bodyFrom(file: string, rowType: string): Doc {
  const text = readFileSync(file, "utf8");
  let doc: Doc;
  if (file.toLowerCase().endsWith(".fountain")) {
    if (rowType !== "screenplay") throw new Error("A .fountain file can only go into a screenplay");
    doc = linesToDoc(parseFountain(text).lines) as Doc;
  } else {
    doc = JSON.parse(text) as Doc;
  }
  if (doc?.type !== "doc" || !Array.isArray(doc.content) || doc.content.length === 0) {
    throw new Error("Not a document: expected { type: 'doc', content: [...] } with at least one block");
  }
  const lines = doc.content.filter((node) => node.type === "screenplayLine").length;
  if (rowType === "screenplay" && lines !== doc.content.length) {
    throw new Error("A screenplay body must be screenplayLine nodes only");
  }
  if (rowType !== "screenplay" && lines > 0) {
    throw new Error("screenplayLine nodes do not belong in a plain document");
  }
  if (words(doc) === 0) throw new Error("Refusing to write a body with no words in it");
  return doc;
}

async function snapshot(row: Pick<Row, "id" | "title_page">, content: string, label: string) {
  await sql(
    "INSERT INTO script_versions (id, user_id, script_id, content, title_page, label, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [randomUUID(), USER, row.id, content, row.title_page, label, now()]
  );
}

async function get(id: string, outFile?: string) {
  const row = await load(id);
  const doc = row.content ? (JSON.parse(row.content) as Doc) : null;
  if (outFile) writeFileSync(outFile, JSON.stringify(doc, null, 2) + "\n");
  emit({
    id: row.id,
    type: row.type,
    title: row.title,
    updatedAt: row.updated_at,
    blocks: doc?.content?.length ?? 0,
    words: words(doc),
    savedTo: outFile ?? null,
  });
}

async function put(id: string, readAt: string, file: string, label: string) {
  const row = await load(id);
  if (row.updated_at !== readAt) {
    console.error(
      `Changed since it was read (now ${row.updated_at}, read at ${readAt}). Get it again and redo the edit on top.`
    );
    process.exitCode = 3;
    return;
  }
  const next = JSON.stringify(bodyFrom(file, row.type));
  if (row.content && words(JSON.parse(row.content) as Doc) > 0) {
    await snapshot(row, row.content, `Before outside edit: ${label}`);
  }
  const at = now();
  const out = await sql(
    "UPDATE scripts SET content = ?, updated_at = ? WHERE user_id = ? AND id = ? AND updated_at = ?",
    [next, at, USER, id, readAt]
  );
  if ((out.meta?.changes ?? 0) === 0) {
    console.error("Changed while writing. Nothing was replaced. Get it again and redo the edit on top.");
    process.exitCode = 3;
    return;
  }
  await snapshot(row, next, `Outside edit: ${label}`);
  const after = await load(id);
  emit({
    id,
    title: row.title,
    written: after.content === next,
    updatedAt: after.updated_at,
    words: words(JSON.parse(next) as Doc),
    note: "An open tab picks this up when the writer returns to it, or within about 20 seconds.",
  });
}

async function create(title: string, file: string, folderId?: string) {
  const type = file.toLowerCase().endsWith(".fountain") ? "screenplay" : "plain";
  const probe = JSON.parse(file.toLowerCase().endsWith(".json") ? readFileSync(file, "utf8") : "{}") as Doc;
  const rowType = probe.content?.some((n) => n.type === "screenplayLine") ? "screenplay" : type;
  const body = JSON.stringify(bodyFrom(file, rowType));
  const id = randomUUID();
  const at = now();
  await sql(
    "INSERT INTO scripts (user_id, id, type, title, status, content, title_page, folder_id, position, created_at, updated_at, placed_at, title_at, status_at) VALUES (?, ?, ?, ?, 'not_started', ?, NULL, ?, NULL, ?, ?, ?, ?, ?)",
    [USER, id, rowType, title, body, folderId ?? null, at, at, at, at, at]
  );
  emit({
    id,
    type: rowType,
    title,
    url: `https://less.oxnorhub.com/#/p/${id}`,
    note: "A new document appears on the home after a full page reload (or Sync now).",
  });
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === "get" && args[0]) await get(args[0], args[1]);
  else if (command === "put" && args.length >= 4) await put(args[0], args[1], args[2], args[3]);
  else if (command === "new" && args.length >= 2) await create(args[0], args[1], args[2]);
  else {
    console.error('Usage: write.ts get <id> [out.json] | put <id> <updated_at> <file> "<label>" | new "<title>" <file> [folderId]');
    process.exitCode = 2;
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
}
