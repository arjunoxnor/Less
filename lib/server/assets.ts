/**
 * The rules for image uploads, kept out of the API file so they can be tested
 * without a Worker runtime. The API file (functions/api/[[path]].ts) only does
 * the I/O: read the request, ask these functions, talk to KV and D1.
 *
 * Why the rules are strict. The 2026-08-13 backend review found that anyone can
 * mint a sync-code identity and write to D1 with no quota. Documents are small
 * and capped, but an image endpoint with the same openness would be a free file
 * host billed to this Cloudflare account. So uploads are:
 *   - for Google-authenticated accounts only (a sync-code identity is refused),
 *   - one of four real image formats, proven by the bytes, not the header,
 *   - capped per file, and capped per account in bytes and in count.
 *
 * Images are served from unguessable ids with no login, because an <img> tag
 * cannot send a session header. The id is the capability: 128 random bits that
 * only ever appear inside the owner's private documents.
 */

/** One image, after the client has downscaled it. Matches MAX_BODY_BYTES. */
export const MAX_ASSET_BYTES = 3 * 1024 * 1024;
/**
 * One voice recording. KV holds at most 25 MiB in a value; at the 32 kbps the
 * app records speech at, 24 MB is well over an hour of talking.
 */
export const MAX_AUDIO_BYTES = 24 * 1024 * 1024;
/**
 * Per account, images and recordings together. KV's free tier holds 1 GB in
 * total and the free plan cannot bill: past its limits, writes simply fail.
 * Kept below the whole gigabyte so another account's board pictures still fit.
 */
export const MAX_ACCOUNT_ASSET_BYTES = 800 * 1024 * 1024;
export const MAX_ACCOUNT_ASSET_COUNT = 4000;

export const ASSET_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

/** Voice recordings, as the browsers' own recorders produce them (Chrome and
 *  Firefox: WebM or Ogg with Opus; Safari: MP4 with AAC), plus the two plain
 *  formats a file from a phone might arrive in. */
export const AUDIO_TYPES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav"] as const;
export type AudioType = (typeof AUDIO_TYPES)[number];

/** What the bytes actually are, or null. SVG is deliberately not accepted: it
 *  is a document format that can carry script. */
export function sniffImageType(bytes: Uint8Array): AssetType | null {
  const at = (i: number) => bytes[i];
  if (bytes.length >= 8 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47 &&
      at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a) return "image/png";
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 &&
      at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) return "image/webp";
  if (bytes.length >= 6 && at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38 &&
      (at(4) === 0x37 || at(4) === 0x39) && at(5) === 0x61) return "image/gif";
  return null;
}

/** What the bytes of a recording actually are, or null. */
export function sniffAudioType(bytes: Uint8Array): AudioType | null {
  const at = (i: number) => bytes[i];
  const ascii = (from: number, text: string) =>
    bytes.length >= from + text.length &&
    [...text].every((ch, i) => at(from + i) === ch.charCodeAt(0));
  // EBML header: WebM (Matroska) as Chrome and Firefox record it.
  if (bytes.length >= 4 && at(0) === 0x1a && at(1) === 0x45 && at(2) === 0xdf && at(3) === 0xa3) {
    return "audio/webm";
  }
  if (ascii(0, "OggS")) return "audio/ogg";
  // ISO base media: a box size, then "ftyp". Safari's recorder, and .m4a files.
  if (ascii(4, "ftyp")) return "audio/mp4";
  if (ascii(0, "RIFF") && ascii(8, "WAVE")) return "audio/wav";
  // MP3: an ID3 tag, or straight into an MPEG audio frame (11 sync bits).
  if (ascii(0, "ID3")) return "audio/mpeg";
  if (bytes.length >= 2 && at(0) === 0xff && (at(1) & 0xe0) === 0xe0) return "audio/mpeg";
  return null;
}

/** A sync-code identity is "c_" plus a hash (see userFrom). Everything else is
 *  a Google subject id from a signed session. */
export function isGoogleIdentity(userId: string): boolean {
  return !userId.startsWith("c_") && /^[0-9]{6,40}$/.test(userId);
}

export const ASSET_ID = /^[a-f0-9]{32}$/;

export function newAssetId(): string {
  const raw = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(raw, (b) => b.toString(16).padStart(2, "0")).join("");
}

export type UploadVerdict =
  | { ok: true; type: AssetType }
  | { ok: false; status: number; error: string };

/** Everything that can be decided about an upload without touching storage. */
export function judgeUpload(opts: {
  userId: string;
  bytes: Uint8Array;
  usedBytes: number;
  usedCount: number;
}): UploadVerdict {
  if (!isGoogleIdentity(opts.userId)) {
    return { ok: false, status: 403, error: "Sign in with Google to add images" };
  }
  if (opts.bytes.length === 0) return { ok: false, status: 400, error: "Empty upload" };
  if (opts.bytes.length > MAX_ASSET_BYTES) {
    return { ok: false, status: 413, error: "Image is too large" };
  }
  const type = sniffImageType(opts.bytes);
  if (!type) return { ok: false, status: 415, error: "Not a PNG, JPEG, WebP, or GIF image" };
  if (opts.usedCount + 1 > MAX_ACCOUNT_ASSET_COUNT ||
      opts.usedBytes + opts.bytes.length > MAX_ACCOUNT_ASSET_BYTES) {
    return { ok: false, status: 507, error: "Image storage for this account is full" };
  }
  return { ok: true, type };
}

/** Everything that can be decided about a recording without touching storage.
 *  Same account rules as images: Google accounts only, a shared quota. */
export function judgeAudioUpload(opts: {
  userId: string;
  bytes: Uint8Array;
  usedBytes: number;
  usedCount: number;
}): { ok: true; type: AudioType } | { ok: false; status: number; error: string } {
  if (!isGoogleIdentity(opts.userId)) {
    return { ok: false, status: 403, error: "Sign in with Google to save voice notes" };
  }
  if (opts.bytes.length === 0) return { ok: false, status: 400, error: "Empty recording" };
  if (opts.bytes.length > MAX_AUDIO_BYTES) {
    return { ok: false, status: 413, error: "Recording is too long to store" };
  }
  const type = sniffAudioType(opts.bytes);
  if (!type) return { ok: false, status: 415, error: "Not a recording this app can store" };
  if (opts.usedCount + 1 > MAX_ACCOUNT_ASSET_COUNT ||
      opts.usedBytes + opts.bytes.length > MAX_ACCOUNT_ASSET_BYTES) {
    return { ok: false, status: 507, error: "Storage for this account is full" };
  }
  return { ok: true, type };
}

/**
 * The part of a stored file a Range header asks for. Safari will not play
 * audio from a server that cannot answer ranges, and every browser needs
 * them to seek. Returns null for a range that cannot be satisfied, and the
 * whole file when there is no (or an unusable) range.
 */
export function byteRange(
  header: string | null,
  size: number
): { start: number; end: number; partial: boolean } | null {
  if (!header) return { start: 0, end: size - 1, partial: false };
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return { start: 0, end: size - 1, partial: false };
  let start: number;
  let end: number;
  if (m[1] === "") {
    // "bytes=-500": the last 500 bytes.
    const suffix = Number(m[2]);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!(start <= end) || start >= size) return null;
  return { start, end, partial: true };
}

const SERVABLE = [...ASSET_TYPES, ...AUDIO_TYPES] as readonly string[];

/** Headers for serving an image. The id never changes meaning, so it can be
 *  cached forever; nosniff plus a locked-down CSP keep a mislabeled file inert. */
export function assetHeaders(type: string): Record<string, string> {
  return {
    "content-type": SERVABLE.includes(type) ? type : "application/octet-stream",
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "x-robots-tag": "noindex",
    "accept-ranges": "bytes",
    "cross-origin-resource-policy": "same-site",
  };
}
