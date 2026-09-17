/**
 * The Mac-side half of voice scripts.
 *
 * LESS is a static site, so nothing can call into this machine. The writer
 * presses Process in the browser, that request rides the ordinary cloud sync
 * into D1 as a line of text, and this script is what notices.
 *
 * Three rules it must never break:
 *
 *  1. It touches rows of type 'voice' and nothing else. Every statement carries
 *     that filter. The writer's screenplays are out of reach by construction,
 *     not by care.
 *  2. It serves ONE account, named by LESS_VOICE_USER_ID. LESS has other users;
 *     their voice notes are theirs, and this Mac's model plan is not a shared
 *     service.
 *  3. It never overwrites an edit it has not seen. Every write is conditional on
 *     the updated_at it read, because a locally-dirty browser PUSHES and ignores
 *     the cloud (useCloudSync.ts): words dictated while this script was thinking
 *     would otherwise be replaced by a stale copy. A rejected write means re-read
 *     and redo, which is cheap. Losing dictation is not.
 *
 * Runs on plain Node (25+, which strips types natively), so the state machine
 * is imported straight from the app and there is no second copy to drift:
 *
 *   node tools/voice/voice.ts poll
 *   node tools/voice/voice.ts claim <id>
 *   node tools/voice/voice.ts deliver <id> <formatted.txt>
 *   node tools/voice/voice.ts fail <id> "<message>"
 *   node tools/voice/voice.ts seed <id> <transcript.txt>   (audio transcribed here -> note)
 *   node tools/voice/voice.ts selftest        (proves auth + endpoint, writes nothing)
 */

import { readFileSync } from "node:fs";
import {
  docToLines,
  linesToDoc,
  readVoiceDoc,
  markWorking,
  applyResult,
  markError,
  requestProcess,
} from "../../lib/voice/markers.ts";

const DB = "ec14ff01-64ae-48e0-b176-0ffa0bf596e9";
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const USER = process.env.LESS_VOICE_USER_ID;

if (!ACCOUNT || !TOKEN) {
  console.error("Missing Cloudflare credentials. Source secrets/cloudflare.env first.");
  process.exit(2);
}
if (!USER) {
  console.error("Missing LESS_VOICE_USER_ID. Source secrets/less-voice.env first.");
  process.exit(2);
}

interface Row {
  user_id: string;
  id: string;
  title?: string;
  content: string | null;
  updated_at: string;
}

interface D1Result {
  results?: Row[];
  meta?: { changes?: number };
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

/** Parse a row's content, tolerating a body that is not valid JSON rather than
    crashing the whole poll over one bad document. */
function linesOf(row: Row): string[] | null {
  try {
    return docToLines(JSON.parse(row.content ?? "{}"));
  } catch {
    return null;
  }
}

function emit(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

async function poll(): Promise<void> {
  const out = await sql(
    "SELECT user_id, id, title, content, updated_at FROM scripts WHERE type = 'voice' AND user_id = ?",
    [USER]
  );
  const jobs = [];
  for (const row of out.results ?? []) {
    const lines = linesOf(row);
    if (!lines) continue;
    const doc = readVoiceDoc(lines);
    if (doc.state !== "pending") continue;
    jobs.push({
      id: row.id,
      title: row.title,
      updatedAt: row.updated_at,
      words: doc.pending.join(" ").split(/\s+/).filter(Boolean).length,
      pending: doc.pending,
    });
  }
  emit({ jobs });
}

async function loadOne(id: string): Promise<{ row: Row; lines: string[] }> {
  const out = await sql(
    "SELECT user_id, id, content, updated_at FROM scripts WHERE type = 'voice' AND user_id = ? AND id = ?",
    [USER, id]
  );
  const row = (out.results ?? [])[0];
  if (!row) throw new Error(`No voice script with id ${id} for this user`);
  const lines = linesOf(row);
  if (!lines) throw new Error(`Voice script ${id} has unreadable content`);
  return { row, lines };
}

/** Conditional write. Zero changed rows means the writer edited the document
    while we were thinking, so the caller must start over with what they now
    have. Exit code 3 makes that distinguishable from a real failure. */
async function writeLines(row: Row, lines: string[]): Promise<void> {
  const at = new Date().toISOString();
  const res = await sql(
    `UPDATE scripts SET content = ?, updated_at = ?
     WHERE type = 'voice' AND user_id = ? AND id = ? AND updated_at = ?`,
    [JSON.stringify(linesToDoc(lines)), at, row.user_id, row.id, row.updated_at]
  );
  if (!(res.meta?.changes ?? 0)) {
    emit({ ok: false, reason: "changed-underneath" });
    process.exitCode = 3;
    return;
  }
  emit({ ok: true, updatedAt: at });
}

async function claim(id: string): Promise<void> {
  const { row, lines } = await loadOne(id);
  const doc = readVoiceDoc(lines);
  if (doc.state !== "pending") {
    emit({ ok: false, reason: `state is ${doc.state}` });
    process.exitCode = 3;
    return;
  }
  await writeLines(row, markWorking(lines));
}

async function deliver(id: string, file: string): Promise<void> {
  const { row, lines } = await loadOne(id);
  const doc = readVoiceDoc(lines);
  if (doc.state !== "working" && doc.state !== "pending") {
    emit({ ok: false, reason: `state is ${doc.state}` });
    process.exitCode = 3;
    return;
  }
  const formatted = readFileSync(file, "utf8").replace(/\s+$/, "").split("\n");
  await writeLines(row, applyResult(lines, formatted, doc.pending, new Date().toISOString()));
}

async function fail(id: string, message: string): Promise<void> {
  const { row, lines } = await loadOne(id);
  await writeLines(row, markError(lines, message));
}

/**
 * Place a transcript into a voice note that has no unprocessed words, as the
 * writer's raw lines plus a Process request, so claim and deliver then run
 * exactly as they would for in-browser dictation and the note ends up in the
 * same shape: formatted lines, the RAW block, the PROCESSED boundary. For the
 * case where the browser could not record and the words arrived as an audio
 * file transcribed on this Mac. Refuses a note that already holds words: those
 * are the writer's, and this is not an editing tool.
 */
async function seed(id: string, file: string): Promise<void> {
  const { row, lines } = await loadOne(id);
  const doc = readVoiceDoc(lines);
  if (doc.state !== "idle" || doc.pending.length) {
    emit({ ok: false, reason: `note is not empty (state ${doc.state}, ${doc.pending.length} pending lines)` });
    process.exitCode = 3;
    return;
  }
  const text = readFileSync(file, "utf8").replace(/\s+$/, "").split("\n");
  await writeLines(row, requestProcess([...lines, ...text]));
}

/** Exercise auth, the endpoint and parameter binding with a write that can
    match nothing, so the first real write is not also the first test. */
async function selftest(): Promise<void> {
  const res = await sql(
    "UPDATE scripts SET updated_at = updated_at WHERE type = 'voice' AND user_id = ? AND id = ?",
    [USER, "selftest-no-such-row"]
  );
  const count = await sql("SELECT COUNT(*) AS n FROM scripts WHERE type = 'voice' AND user_id = ?", [
    USER,
  ]);
  emit({
    ok: true,
    boundParams: true,
    changesOnNoMatch: res.meta?.changes ?? 0,
    voiceNotesForUser: (count.results?.[0] as unknown as { n: number } | undefined)?.n ?? 0,
  });
}

const [cmd, ...args] = process.argv.slice(2);
const commands: Record<string, () => Promise<void>> = {
  poll,
  claim: () => claim(args[0]),
  deliver: () => deliver(args[0], args[1]),
  fail: () => fail(args[0], args.slice(1).join(" ")),
  seed: () => seed(args[0], args[1]),
  selftest,
};

const run = commands[cmd ?? ""];
if (!run) {
  console.error("Usage: voice.ts poll | claim <id> | deliver <id> <file> | fail <id> <msg> | seed <id> <transcript> | selftest");
  process.exit(2);
}
run().catch((e: unknown) => {
  console.error(String((e as Error).message ?? e));
  process.exit(1);
});
