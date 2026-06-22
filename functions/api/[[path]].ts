// The entire LESS sync + auth API, as one Cloudflare Pages Function.
//
// Routes live under /api/*. Auth is "Sign in with Google": the app sends the
// Google ID token once to /api/auth/google; we verify it against Google's
// public keys, then hand back a 30-day session token (a small signed JWT) that
// the app sends as `Authorization: Bearer ...` on every other call. Each query
// is scoped to the signed-in user's Google id, so the API never returns or
// touches another user's rows.

interface Env {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  SESSION_SECRET: string;
}

// Minimal D1 typings so this file is self-contained (no extra deps).
interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
}
interface D1PreparedStatement {
  bind(...vals: unknown[]): D1PreparedStatement;
  all<T = unknown>(): Promise<D1Result<T>>;
  first<T = unknown>(col?: string): Promise<T | null>;
  run(): Promise<unknown>;
}
interface D1Database {
  prepare(query: string): D1PreparedStatement;
}
interface PagesContext {
  request: Request;
  env: Env;
}

const enc = new TextEncoder();
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
const fail = (msg: string, status = 400) => json({ error: msg }, status);

/* ---------- base64url ---------- */
function b64urlToBytes(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64url(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const b64urlToString = (s: string) => new TextDecoder().decode(b64urlToBytes(s));

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ---------- session token (HS256) ---------- */
function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}
async function signSession(payload: object, secret: string): Promise<string> {
  const header = bytesToB64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = bytesToB64url(enc.encode(JSON.stringify(payload)));
  const data = `${header}.${body}`;
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(data)));
  return `${data}.${bytesToB64url(sig)}`;
}
async function verifySession(token: string, secret: string): Promise<Record<string, unknown> | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const ok = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    b64urlToBytes(parts[2]),
    enc.encode(`${parts[0]}.${parts[1]}`)
  );
  if (!ok) return null;
  try {
    const payload = JSON.parse(b64urlToString(parts[1]));
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

/* ---------- Google ID token (RS256 against Google's JWKS) ---------- */
async function verifyGoogleIdToken(
  idToken: string,
  clientId: string
): Promise<{ sub: string; email?: string; name?: string } | null> {
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  let header: { kid?: string };
  let payload: { iss?: string; aud?: string; exp?: number; sub?: string; email?: string; name?: string };
  try {
    header = JSON.parse(b64urlToString(parts[0]));
    payload = JSON.parse(b64urlToString(parts[1]));
  } catch {
    return null;
  }
  const certs = (await (await fetch("https://www.googleapis.com/oauth2/v3/certs")).json()) as {
    keys: Array<JsonWebKey & { kid: string }>;
  };
  const jwk = certs.keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlToBytes(parts[2]),
    enc.encode(`${parts[0]}.${parts[1]}`)
  );
  if (!ok) return null;
  if (payload.iss !== "accounts.google.com" && payload.iss !== "https://accounts.google.com") return null;
  if (payload.aud !== clientId) return null;
  if (payload.exp && Date.now() / 1000 > payload.exp) return null;
  if (!payload.sub) return null;
  return { sub: payload.sub, email: payload.email, name: payload.name };
}

async function userFrom(request: Request, env: Env): Promise<{ id: string; email?: string } | null> {
  const m = (request.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const raw = m[1];
  // Sync-code login: the code IS the identity. Possessing it grants access to
  // its data; the user id is a hash so the raw code never lands in the database.
  if (raw.startsWith("code:")) {
    const code = raw.slice(5);
    if (code.length < 16) return null;
    return { id: "c_" + (await sha256hex(code)).slice(0, 40) };
  }
  // Google login: a signed 30-day session token.
  const payload = await verifySession(raw, env.SESSION_SECRET);
  if (!payload || typeof payload.sub !== "string") return null;
  return { id: payload.sub, email: payload.email as string | undefined };
}

export const onRequest = async (ctx: PagesContext): Promise<Response> => {
  const { request, env } = ctx;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/+$/, "");
  const seg = path ? path.split("/") : [];
  const method = request.method.toUpperCase();
  const db = env.DB;

  try {
    // Exchange a Google ID token for a session token.
    if (method === "POST" && path === "auth/google") {
      const body = (await request.json().catch(() => ({}))) as { idToken?: string };
      const g = await verifyGoogleIdToken(body.idToken || "", env.GOOGLE_CLIENT_ID);
      if (!g) return fail("Google sign-in could not be verified", 401);
      const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;
      const token = await signSession({ sub: g.sub, email: g.email, exp }, env.SESSION_SECRET);
      return json({ token, user: { id: g.sub, email: g.email, name: g.name } });
    }

    const user = await userFrom(request, env);
    if (!user) return fail("Not signed in", 401);
    const uid = user.id;

    // Claim a sync code's data into the signed-in account (used when switching
    // from a sync code to Google sign-in). Moves rows whose id the destination
    // does not already own, so it is safe to run more than once.
    if (method === "POST" && path === "auth/claim") {
      const b = (await request.json().catch(() => ({}))) as { code?: string };
      const code = (b.code || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
      if (code.length < 16) return fail("Invalid code", 400);
      const srcId = "c_" + (await sha256hex(code)).slice(0, 40);
      if (srcId === uid) return json({ ok: true, moved: 0 });
      // Move version history FIRST, and only for scripts the destination does not
      // already own. A script whose id the destination already holds is NOT moved
      // (its content stays), so moving its versions would graft another document's
      // history onto the destination's script. Evaluating the guard before the
      // scripts move keeps "scripts the dest already has" correct.
      await db
        .prepare(
          "UPDATE script_versions SET user_id=? WHERE user_id=? AND script_id NOT IN (SELECT id FROM scripts WHERE user_id=?)"
        )
        .bind(uid, srcId, uid)
        .run();
      await db
        .prepare(
          "UPDATE scripts SET user_id=? WHERE user_id=? AND id NOT IN (SELECT id FROM scripts WHERE user_id=?)"
        )
        .bind(uid, srcId, uid)
        .run();
      await db
        .prepare(
          "UPDATE folders SET user_id=? WHERE user_id=? AND id NOT IN (SELECT id FROM folders WHERE user_id=?)"
        )
        .bind(uid, srcId, uid)
        .run();
      return json({ ok: true });
    }

    /* ---- folders ---- */
    if (seg[0] === "folders") {
      if (method === "GET" && seg.length === 1) {
        const r = await db
          .prepare("SELECT id,name,color,stage,parent_id,position,updated_at FROM folders WHERE user_id=?")
          .bind(uid)
          .all();
        return json(r.results);
      }
      // Deletion records, so a delete on one device is not re-uploaded by another.
      if (method === "GET" && seg.length === 2 && seg[1] === "deleted") {
        const r = await db
          .prepare("SELECT id,deleted_at FROM folder_tombstones WHERE user_id=?")
          .bind(uid)
          .all();
        return json(r.results);
      }
      if (method === "PUT" && seg.length === 2) {
        const b = (await request.json()) as Record<string, unknown>;
        const now = new Date().toISOString();
        await db
          .prepare(
            `INSERT INTO folders (user_id,id,name,color,stage,parent_id,position,updated_at)
             VALUES (?,?,?,?,?,?,?,?)
             ON CONFLICT(user_id,id) DO UPDATE SET
               name=excluded.name, color=excluded.color, stage=excluded.stage,
               parent_id=excluded.parent_id, position=excluded.position, updated_at=excluded.updated_at`
          )
          .bind(
            uid,
            seg[1],
            b.name ?? "",
            b.color ?? null,
            b.stage ?? null,
            b.parent_id ?? null,
            b.position ?? null,
            b.updated_at ?? now
          )
          .run();
        // Re-creating (or updating) a folder clears any prior deletion record.
        await db
          .prepare("DELETE FROM folder_tombstones WHERE user_id=? AND id=?")
          .bind(uid, seg[1])
          .run();
        return json({ ok: true });
      }
      if (method === "DELETE" && seg.length === 2) {
        const now = new Date().toISOString();
        await db.prepare("DELETE FROM folders WHERE user_id=? AND id=?").bind(uid, seg[1]).run();
        await db
          .prepare(
            "INSERT INTO folder_tombstones (user_id,id,deleted_at) VALUES (?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET deleted_at=excluded.deleted_at"
          )
          .bind(uid, seg[1], now)
          .run();
        return json({ ok: true });
      }
    }

    /* ---- scripts ---- */
    if (seg[0] === "scripts") {
      if (seg.length === 1) {
        if (method === "GET") {
          const r = await db
            .prepare(
              "SELECT id,title,type,status,updated_at,created_at,placed_at,title_at,status_at,folder_id,position FROM scripts WHERE user_id=? ORDER BY updated_at DESC"
            )
            .bind(uid)
            .all();
          return json(r.results);
        }
        if (method === "POST") {
          const b = (await request.json()) as Record<string, unknown>;
          const id = (b.id as string) || crypto.randomUUID();
          const now = new Date().toISOString();
          await db
            .prepare(
              `INSERT INTO scripts (user_id,id,type,title,status,content,title_page,folder_id,position,created_at,updated_at,placed_at,title_at,status_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(user_id,id) DO UPDATE SET
                 type=excluded.type, title=excluded.title, status=excluded.status,
                 content=excluded.content, title_page=excluded.title_page, updated_at=excluded.updated_at`
            )
            .bind(
              uid,
              id,
              b.type ?? "screenplay",
              b.title ?? "",
              b.status ?? "not_started",
              b.content != null ? JSON.stringify(b.content) : null,
              b.title_page != null ? JSON.stringify(b.title_page) : null,
              b.folder_id ?? null,
              b.position ?? null,
              now,
              now,
              b.placed_at ?? now,
              now,
              now
            )
            .run();
          return json({
            id,
            title: b.title ?? "",
            content: b.content ?? null,
            title_page: b.title_page ?? null,
            type: b.type ?? "screenplay",
            status: b.status ?? "not_started",
            created_at: now,
            updated_at: now,
          });
        }
      }
      if (seg.length >= 2) {
        const id = seg[1];
        if (seg[2] === "versions") {
          if (method === "GET") {
            const r = await db
              .prepare(
                "SELECT id,content,title_page,label,created_at FROM script_versions WHERE user_id=? AND script_id=? ORDER BY created_at DESC LIMIT 100"
              )
              .bind(uid, id)
              .all<Record<string, unknown>>();
            return json(
              r.results.map((v) => ({
                ...v,
                content: JSON.parse(v.content as string),
                title_page: v.title_page ? JSON.parse(v.title_page as string) : null,
              }))
            );
          }
          if (method === "POST") {
            const b = (await request.json()) as Record<string, unknown>;
            const now = new Date().toISOString();
            await db
              .prepare(
                "INSERT INTO script_versions (id,user_id,script_id,content,title_page,label,created_at) VALUES (?,?,?,?,?,?,?)"
              )
              .bind(
                crypto.randomUUID(),
                uid,
                id,
                JSON.stringify(b.content),
                b.title_page != null ? JSON.stringify(b.title_page) : null,
                b.label ?? null,
                now
              )
              .run();
            return json({ ok: true });
          }
        } else {
          if (method === "GET") {
            const row = (await db
              .prepare(
                "SELECT id,title,content,title_page,type,status,created_at,updated_at FROM scripts WHERE user_id=? AND id=?"
              )
              .bind(uid, id)
              .first()) as Record<string, unknown> | null;
            if (!row) return json(null);
            return json({
              ...row,
              content: row.content ? JSON.parse(row.content as string) : null,
              title_page: row.title_page ? JSON.parse(row.title_page as string) : null,
            });
          }
          if (method === "PATCH") {
            const b = (await request.json()) as Record<string, unknown>;
            const sets: string[] = [];
            const vals: unknown[] = [];
            if ("title" in b) (sets.push("title=?"), vals.push(b.title));
            if ("content" in b) (sets.push("content=?"), vals.push(b.content != null ? JSON.stringify(b.content) : null));
            if ("status" in b) (sets.push("status=?"), vals.push(b.status));
            if ("folder_id" in b) (sets.push("folder_id=?"), vals.push(b.folder_id));
            if ("position" in b) (sets.push("position=?"), vals.push(b.position));
            if ("title_page" in b)
              (sets.push("title_page=?"), vals.push(b.title_page != null ? JSON.stringify(b.title_page) : null));
            const now = new Date().toISOString();
            sets.push("updated_at=?");
            vals.push(now);
            // A placement change (folder/position) bumps the dedicated placement
            // clock so a content save can never out-rank a real move on sync.
            if ("folder_id" in b || "position" in b) {
              sets.push("placed_at=?");
              vals.push(now);
            }
            // Title and status each have their own clock too, so a change to one
            // field never makes a stale value of another field look "newer".
            if ("title" in b) {
              sets.push("title_at=?");
              vals.push(now);
            }
            if ("status" in b) {
              sets.push("status_at=?");
              vals.push(now);
            }
            vals.push(uid, id);
            await db.prepare(`UPDATE scripts SET ${sets.join(",")} WHERE user_id=? AND id=?`).bind(...vals).run();
            return json({ updated_at: now });
          }
          if (method === "DELETE") {
            await db.prepare("DELETE FROM scripts WHERE user_id=? AND id=?").bind(uid, id).run();
            await db.prepare("DELETE FROM script_versions WHERE user_id=? AND script_id=?").bind(uid, id).run();
            return json({ ok: true });
          }
        }
      }
    }

    return fail("Not found", 404);
  } catch (e) {
    return fail("Server error: " + (e instanceof Error ? e.message : String(e)), 500);
  }
};
