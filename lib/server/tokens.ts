// Session tokens and Google sign-in checks for the sync API
// (functions/api/[[path]].ts).
//
// Library: jose (MIT), pinned in package.json. It replaced about 120 lines of
// hand-written JWT signing and RSA checking on 2026-11-14. What it adds over
// the old code: expiry is required (a token with no `exp` used to pass), a
// small clock tolerance, and Google key rotation handled by
// createRemoteJWKSet (it re-fetches when it meets an unknown key id).
//
// Compatibility: sessions minted before the switch keep working. The format is
// unchanged: an HS256 JWT signed with SESSION_SECRET, payload { sub, email, exp }.
//
// Known limits:
// - createRemoteJWKSet caches Google's keys per isolate; a cold isolate makes
//   one fetch to googleapis.com on its first sign-in.
// - Only HS256 sessions and RS256 Google tokens are accepted (algorithms pinned).

import { SignJWT, createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

const enc = new TextEncoder();
const CLOCK_TOLERANCE = 60; // seconds

/* ---------- session token (HS256) ---------- */

export async function signSession(
  payload: { sub: string; email?: string; exp: number },
  secret: string
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .sign(enc.encode(secret));
}

export async function verifySession(
  token: string,
  secret: string
): Promise<Record<string, unknown> | null> {
  if (!token || !secret) return null;
  try {
    const { payload } = await jwtVerify(token, enc.encode(secret), {
      algorithms: ["HS256"],
      requiredClaims: ["exp", "sub"],
      clockTolerance: CLOCK_TOLERANCE,
    });
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

/* ---------- Google ID token (RS256 against Google's JWKS) ---------- */

let googleKeys: JWTVerifyGetKey | null = null;
function defaultGoogleKeys(): JWTVerifyGetKey {
  googleKeys ??= createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
  return googleKeys;
}

// `keys` is for tests; production uses Google's published keys.
export async function verifyGoogleIdToken(
  idToken: string,
  clientId: string,
  keys: JWTVerifyGetKey = defaultGoogleKeys()
): Promise<{ sub: string; email?: string; name?: string } | null> {
  if (!idToken || !clientId) return null;
  try {
    const { payload } = await jwtVerify(idToken, keys, {
      algorithms: ["RS256"],
      issuer: ["accounts.google.com", "https://accounts.google.com"],
      audience: clientId,
      requiredClaims: ["exp", "sub"],
      clockTolerance: CLOCK_TOLERANCE,
    });
    return {
      sub: String(payload.sub),
      email: typeof payload.email === "string" ? payload.email : undefined,
      name: typeof payload.name === "string" ? payload.name : undefined,
    };
  } catch {
    return null;
  }
}
