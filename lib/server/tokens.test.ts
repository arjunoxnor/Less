import { describe, expect, it } from "vitest";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { signSession, verifyGoogleIdToken, verifySession } from "./tokens";

const SECRET = "test-session-secret";
const now = () => Math.floor(Date.now() / 1000);

// The pre-jose signer, kept here to prove old sessions still verify.
async function legacySign(payload: object, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const b64 = (b: Uint8Array) =>
    btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const data = `${b64(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })))}.${b64(enc.encode(JSON.stringify(payload)))}`;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `${data}.${b64(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data))))}`;
}

describe("session tokens", () => {
  it("round-trips", async () => {
    const t = await signSession({ sub: "g1", email: "a@b.c", exp: now() + 60 }, SECRET);
    const p = await verifySession(t, SECRET);
    expect(p?.sub).toBe("g1");
    expect(p?.email).toBe("a@b.c");
  });

  it("still accepts sessions minted by the old hand-written signer", async () => {
    const t = await legacySign({ sub: "g1", email: "a@b.c", exp: now() + 60 }, SECRET);
    expect((await verifySession(t, SECRET))?.sub).toBe("g1");
  });

  it("rejects a token with no expiry (the gap the old code had)", async () => {
    const t = await legacySign({ sub: "g1" }, SECRET);
    expect(await verifySession(t, SECRET)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const t = await signSession({ sub: "g1", exp: now() - 3600 }, SECRET);
    expect(await verifySession(t, SECRET)).toBeNull();
  });

  it("rejects the wrong secret and tampering", async () => {
    const t = await signSession({ sub: "g1", exp: now() + 60 }, SECRET);
    expect(await verifySession(t, "other-secret")).toBeNull();
    const [h, , s] = t.split(".");
    const forged = btoa(JSON.stringify({ sub: "someone-else", exp: now() + 60 })).replace(/=+$/, "");
    expect(await verifySession(`${h}.${forged}.${s}`, SECRET)).toBeNull();
  });

  it("rejects alg none and an empty secret", async () => {
    const none = `${btoa(JSON.stringify({ alg: "none" }))}.${btoa(JSON.stringify({ sub: "g1", exp: now() + 60 }))}.`;
    expect(await verifySession(none, SECRET)).toBeNull();
    const t = await signSession({ sub: "g1", exp: now() + 60 }, SECRET);
    expect(await verifySession(t, "")).toBeNull();
  });
});

describe("Google ID tokens", async () => {
  const CLIENT = "client-123.apps.googleusercontent.com";
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: "g1", alg: "RS256" }] });

  const google = (claims: Record<string, unknown> = {}, key = privateKey) =>
    new SignJWT({ sub: "1234", email: "a@b.c", name: "A", ...claims })
      .setProtectedHeader({ alg: "RS256", kid: "g1" })
      .setIssuer((claims.iss as string) ?? "https://accounts.google.com")
      .setAudience((claims.aud as string) ?? CLIENT)
      .setExpirationTime((claims.exp as number) ?? now() + 600)
      .sign(key);

  it("accepts a valid token", async () => {
    expect(await verifyGoogleIdToken(await google(), CLIENT, keys)).toEqual({ sub: "1234", email: "a@b.c", name: "A" });
  });

  it("accepts the bare accounts.google.com issuer", async () => {
    expect(await verifyGoogleIdToken(await google({ iss: "accounts.google.com" }), CLIENT, keys)).not.toBeNull();
  });

  it("rejects another app's token, another issuer, and expiry", async () => {
    expect(await verifyGoogleIdToken(await google({ aud: "other-client" }), CLIENT, keys)).toBeNull();
    expect(await verifyGoogleIdToken(await google({ iss: "https://evil.example" }), CLIENT, keys)).toBeNull();
    expect(await verifyGoogleIdToken(await google({ exp: now() - 3600 }), CLIENT, keys)).toBeNull();
  });

  it("rejects a token signed by someone else", async () => {
    const other = await generateKeyPair("RS256");
    expect(await verifyGoogleIdToken(await google({}, other.privateKey), CLIENT, keys)).toBeNull();
  });

  it("rejects missing input", async () => {
    expect(await verifyGoogleIdToken("", CLIENT, keys)).toBeNull();
    expect(await verifyGoogleIdToken(await google(), "", keys)).toBeNull();
  });
});
