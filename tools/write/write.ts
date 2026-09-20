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
 *   node --import ./tools/voice/register.mjs tools/write/write.ts new "<title>" <file> [folderId] [type]
 *   node --import ./tools/voice/register.mjs tools/write/write.ts asset <image> [more images...]
 *
 * <file> is a .fountain scene (screenplays only; parsed with the app's own
 * parser, so it lands exactly as an import would) or a .json TipTap document.
 * [type] is "board" for a document that holds images (lib/editor/boardNodes.ts).
 *
 * `asset` uploads pictures for a board and prints the /api/assets/<id> link to
 * put in a figure's `src`. It stores them exactly where the app does (the
 * IMAGES KV namespace plus a row in `assets`) and under the app's own rules
 * (lib/server/assets.ts: real PNG/JPEG/WebP/GIF bytes, 3 MB a file, the account
 * quota), so an image placed from here is indistinguishable from a dropped one.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { parseFountain } from "../../lib/export/fountain.ts";
import { linesToDoc } from "../../lib/export/flatten.ts";
import { judgeUpload, newAssetId } from "../../lib/server/assets.ts";

const DB = "ec14ff01-64ae-48e0-b176-0ffa0bf596e9";
const KV_IMAGES = "56f5a9c08dac40e591e264bf379c983c";
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
interface D1Result<T = Row> {
  results?: T[];
  meta?: { changes?: number };
}
interface Doc {
  type: string;
  content?: Doc[];
  text?: string;
  attrs?: Record<string, unknown>;
}

async function sql<T = Row>(statement: string, params: unknown[] = []): Promise<D1Result<T>> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DB}/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sql: statement, params }),
    }
  );
  const body = (await res.json()) as { success: boolean; result: D1Result<T>[]; errors?: unknown };
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

const textOf = (doc: Doc): string =>
  (typeof doc.text === "string" ? doc.text : "") + (doc.content ?? []).map(textOf).join("");

/** The pictures on a board, and which of them the writer ticked. The votes are
 *  the point of a reference wall, so reading them back is part of `get`. */
function pictures(doc: Doc | null): { liked: boolean; caption: string; src: string }[] {
  if (!doc) return [];
  const own =
    doc.type === "figure" && typeof doc.attrs?.src === "string" && doc.attrs.src
      ? [{ liked: doc.attrs.liked === true, caption: textOf(doc), src: doc.attrs.src }]
      : [];
  return own.concat((doc.content ?? []).flatMap(pictures));
}

async function get(id: string, outFile?: string) {
  const row = await load(id);
  const doc = row.content ? (JSON.parse(row.content) as Doc) : null;
  const pics = pictures(doc);
  if (outFile) writeFileSync(outFile, JSON.stringify(doc, null, 2) + "\n");
  emit({
    id: row.id,
    type: row.type,
    title: row.title,
    updatedAt: row.updated_at,
    blocks: doc?.content?.length ?? 0,
    words: words(doc),
    ...(pics.length
      ? { pictures: pics.length, liked: pics.filter((p) => p.liked).map((p) => p.caption || p.src) }
      : {}),
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

/** Natural pixel size from the header, so a figure can hold its shape before
 *  the image loads. Null when the format keeps it somewhere this does not look. */
function imageSize(b: Uint8Array): { width: number; height: number } | null {
  const u16 = (i: number) => (b[i] << 8) | b[i + 1];
  const u32 = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  if (b[0] === 0x89 && b[1] === 0x50) return { width: u32(16), height: u32(20) }; // PNG IHDR
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      // Start-of-frame markers carry the size; skip the ones that are not frames.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: u16(i + 7), height: u16(i + 5) };
      }
      i += 2 + u16(i + 2);
    }
    return null;
  }
  if (b[0] === 0x47 && b[1] === 0x49) return { width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) }; // GIF
  if (b[8] === 0x57 && b[12] === 0x56 && b[13] === 0x50 && b[14] === 0x38 && b[15] === 0x58) {
    // WebP, extended header: 24-bit little-endian, stored minus one.
    const w = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
    const h = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
    return { width: w, height: h };
  }
  return null;
}

async function asset(files: string[]) {
  const out = [];
  for (const file of files) {
    const bytes = new Uint8Array(readFileSync(file));
    const used = (
      await sql<{ b: number; n: number }>(
        "SELECT COALESCE(SUM(bytes),0) AS b, COUNT(*) AS n FROM assets WHERE user_id = ?",
        [USER]
      )
    ).results?.[0];
    const verdict = judgeUpload({
      userId: USER as string,
      bytes,
      usedBytes: used?.b ?? 0,
      usedCount: used?.n ?? 0,
    });
    if (!verdict.ok) throw new Error(`${file}: ${verdict.error}`);
    const id = newAssetId();
    const form = new FormData();
    form.set("value", new Blob([bytes]));
    form.set("metadata", JSON.stringify({ type: verdict.type }));
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/storage/kv/namespaces/${KV_IMAGES}/values/${id}`,
      { method: "PUT", headers: { Authorization: `Bearer ${TOKEN}` }, body: form }
    );
    const stored = (await res.json()) as { success: boolean; errors?: unknown };
    if (!stored.success) throw new Error(`${file}: KV refused it: ${JSON.stringify(stored.errors)}`);
    await sql(
      "INSERT INTO assets (id, user_id, bytes, content_type, created_at) VALUES (?, ?, ?, ?, ?)",
      [id, USER, bytes.length, verdict.type, now()]
    );
    out.push({ file, src: `/api/assets/${id}`, type: verdict.type, bytes: bytes.length, ...imageSize(bytes) });
  }
  emit(out);
}

async function create(title: string, file: string, folderId?: string, asType?: string) {
  const type = file.toLowerCase().endsWith(".fountain") ? "screenplay" : asType === "board" ? "board" : "plain";
  const probe = JSON.parse(file.toLowerCase().endsWith(".json") ? readFileSync(file, "utf8") : "{}") as Doc;
  const rowType = probe.content?.some((n) => n.type === "screenplayLine") ? "screenplay" : type;
  const body = JSON.stringify(bodyFrom(file, rowType));
  const id = randomUUID();
  const at = now();
  await sql(
    "INSERT INTO scripts (user_id, id, type, title, status, content, title_page, folder_id, position, created_at, updated_at, placed_at, title_at, status_at) VALUES (?, ?, ?, ?, 'not_started', ?, NULL, ?, NULL, ?, ?, ?, ?, ?)",
    [USER, id, rowType, title, body, folderId ?? null, at, at, at, at, at]
  );
  // A new document has no History yet. Give it one entry, so the body written
  // here can be restored if a browser running an older build opens it, does not
  // know its blocks, and saves what is left.
  await snapshot({ id, title_page: null }, body, "As created from outside");
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
  else if (command === "new" && args.length >= 2) await create(args[0], args[1], args[2] || undefined, args[3]);
  else if (command === "asset" && args.length >= 1) await asset(args);
  else {
    console.error('Usage: write.ts get <id> [out.json] | put <id> <updated_at> <file> "<label>" | new "<title>" <file> [folderId] [board] | asset <image>...');
    process.exitCode = 2;
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
}
