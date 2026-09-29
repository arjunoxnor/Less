import { describe, expect, it } from "vitest";
import {
  ASSET_ID,
  MAX_ACCOUNT_ASSET_BYTES,
  MAX_ACCOUNT_ASSET_COUNT,
  MAX_ASSET_BYTES,
  MAX_AUDIO_BYTES,
  assetHeaders,
  byteRange,
  isGoogleIdentity,
  judgeAudioUpload,
  judgeUpload,
  newAssetId,
  sniffAudioType,
  sniffImageType,
} from "./assets";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const HTML = new TextEncoder().encode("<!doctype html><script>alert(1)</script>");

const GOOGLE = "112377494085530832740";
const SYNC_CODE = "c_0123456789abcdef0123456789abcdef01234567";
const fresh = { userId: GOOGLE, usedBytes: 0, usedCount: 0 };

describe("sniffImageType", () => {
  it("recognises the four formats by their bytes", () => {
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(JPEG)).toBe("image/jpeg");
    expect(sniffImageType(WEBP)).toBe("image/webp");
    expect(sniffImageType(GIF)).toBe("image/gif");
  });

  it("refuses anything that can carry script, whatever it claims to be", () => {
    expect(sniffImageType(SVG)).toBeNull();
    expect(sniffImageType(HTML)).toBeNull();
    expect(sniffImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20]))).toBeNull(); // RIFF but AVI
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});

describe("isGoogleIdentity", () => {
  it("accepts a Google subject id and refuses a sync-code identity", () => {
    expect(isGoogleIdentity(GOOGLE)).toBe(true);
    expect(isGoogleIdentity(SYNC_CODE)).toBe(false);
    expect(isGoogleIdentity("")).toBe(false);
    expect(isGoogleIdentity("admin")).toBe(false);
  });
});

describe("judgeUpload", () => {
  it("accepts a real image from a signed-in account", () => {
    expect(judgeUpload({ ...fresh, bytes: PNG })).toEqual({ ok: true, type: "image/png" });
  });

  it("refuses a sync-code identity: anyone can mint one, so it gets no file storage", () => {
    const verdict = judgeUpload({ ...fresh, userId: SYNC_CODE, bytes: PNG });
    expect(verdict).toMatchObject({ ok: false, status: 403 });
  });

  it("refuses a file that is not an image, even under an image header", () => {
    expect(judgeUpload({ ...fresh, bytes: SVG })).toMatchObject({ ok: false, status: 415 });
    expect(judgeUpload({ ...fresh, bytes: new Uint8Array() })).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses a file over the per-image cap", () => {
    const big = new Uint8Array(MAX_ASSET_BYTES + 1);
    big.set(PNG);
    expect(judgeUpload({ ...fresh, bytes: big })).toMatchObject({ ok: false, status: 413 });
  });

  it("refuses once the account is full, by bytes or by count", () => {
    expect(
      judgeUpload({ ...fresh, bytes: PNG, usedBytes: MAX_ACCOUNT_ASSET_BYTES - 4 })
    ).toMatchObject({ ok: false, status: 507 });
    expect(
      judgeUpload({ ...fresh, bytes: PNG, usedCount: MAX_ACCOUNT_ASSET_COUNT })
    ).toMatchObject({ ok: false, status: 507 });
  });
});

describe("asset ids and headers", () => {
  it("mints 128-bit ids that match the route's pattern and do not repeat", () => {
    const a = newAssetId();
    const b = newAssetId();
    expect(a).toMatch(ASSET_ID);
    expect(a).not.toBe(b);
    expect(ASSET_ID.test("../../etc/passwd")).toBe(false);
    expect(ASSET_ID.test(a.toUpperCase())).toBe(false);
  });

  it("serves images as inert, cacheable bytes", () => {
    const h = assetHeaders("image/webp");
    expect(h["content-type"]).toBe("image/webp");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["cache-control"]).toContain("immutable");
    expect(h["content-security-policy"]).toContain("default-src 'none'");
    // A type that somehow is not on the list is never served as something a
    // browser would render.
    expect(assetHeaders("text/html")["content-type"]).toBe("application/octet-stream");
  });
});

describe("voice recordings", () => {
  const bytes = (...values: number[]) => new Uint8Array(values);
  const text = (s: string, pad = 0) => new Uint8Array([...Array(pad).fill(0), ...[...s].map((c) => c.charCodeAt(0))]);

  it("knows a recording by its bytes, whatever it claims to be", () => {
    expect(sniffAudioType(bytes(0x1a, 0x45, 0xdf, 0xa3, 0x9f))).toBe("audio/webm");
    expect(sniffAudioType(text("OggS\0\x02"))).toBe("audio/ogg");
    expect(sniffAudioType(text("ftypM4A ", 4))).toBe("audio/mp4");
    const wav = new Uint8Array(12);
    wav.set(text("RIFF"), 0);
    wav.set(text("WAVE"), 8);
    expect(sniffAudioType(wav)).toBe("audio/wav");
    expect(sniffAudioType(text("ID3\x04"))).toBe("audio/mpeg");
    expect(sniffAudioType(bytes(0xff, 0xfb, 0x90))).toBe("audio/mpeg");
    expect(sniffAudioType(text("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffAudioType(bytes(0x89, 0x50, 0x4e, 0x47))).toBeNull();
  });

  it("stores recordings for Google accounts only, within the size and the shared quota", () => {
    const webm = bytes(0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3);
    const google = "112377490000000000000";
    expect(judgeAudioUpload({ userId: "c_abc", bytes: webm, usedBytes: 0, usedCount: 0 })).toMatchObject({ ok: false, status: 403 });
    expect(judgeAudioUpload({ userId: google, bytes: new Uint8Array(0), usedBytes: 0, usedCount: 0 })).toMatchObject({ ok: false, status: 400 });
    expect(judgeAudioUpload({ userId: google, bytes: text("hello"), usedBytes: 0, usedCount: 0 })).toMatchObject({ ok: false, status: 415 });
    expect(
      judgeAudioUpload({ userId: google, bytes: webm, usedBytes: MAX_ACCOUNT_ASSET_BYTES, usedCount: 1 })
    ).toMatchObject({ ok: false, status: 507 });
    expect(judgeAudioUpload({ userId: google, bytes: webm, usedBytes: 0, usedCount: 0 })).toEqual({ ok: true, type: "audio/webm" });
    expect(MAX_AUDIO_BYTES).toBeLessThanOrEqual(25 * 1024 * 1024);
  });

  it("answers byte ranges the way media players ask for them", () => {
    expect(byteRange(null, 1000)).toEqual({ start: 0, end: 999, partial: false });
    expect(byteRange("bytes=0-1", 1000)).toEqual({ start: 0, end: 1, partial: true });
    expect(byteRange("bytes=500-", 1000)).toEqual({ start: 500, end: 999, partial: true });
    expect(byteRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999, partial: true });
    expect(byteRange("bytes=900-5000", 1000)).toEqual({ start: 900, end: 999, partial: true });
    expect(byteRange("bytes=1000-1001", 1000)).toBeNull();
    expect(byteRange("bytes=5-2", 1000)).toBeNull();
    expect(byteRange("items=0-5", 1000)).toEqual({ start: 0, end: 999, partial: false });
  });

  it("serves recordings as audio, with ranges advertised", () => {
    const headers = assetHeaders("audio/webm");
    expect(headers["content-type"]).toBe("audio/webm");
    expect(headers["accept-ranges"]).toBe("bytes");
    expect(assetHeaders("text/html")["content-type"]).toBe("application/octet-stream");
  });
});
