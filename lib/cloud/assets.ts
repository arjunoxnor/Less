import { API_TIMEOUT_MS, getToken } from "./client";

/**
 * Image uploads for boards. The server's rules are in lib/server/assets.ts:
 * Google-signed-in accounts only, real PNG/JPEG/WebP/GIF bytes, 3 MB a file, a
 * quota per account. This module makes a picture fit those rules before it
 * leaves the browser, so a 12 MB phone photo or a 4K render becomes a sharp
 * 2000px image instead of a refusal.
 */

export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const MAX_EDGE = 2000;

export interface UploadedImage {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
}

/** Scale (w, h) down to fit inside max on the long edge. Never scales up. */
export function fitWithin(width: number, height: number, max = MAX_EDGE): { width: number; height: number } {
  const long = Math.max(width, height);
  if (!(long > max)) return { width, height };
  const k = max / long;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

const encode = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * Make an image uploadable. Small enough already: send the original bytes
 * untouched (no generation loss). Otherwise redraw it at 2000px. Line art and
 * flat color (storyboards, style frames) survive PNG far better than a lossy
 * format, so PNG is tried first and lossy WebP/JPEG is the fallback for
 * photographs that will not fit.
 */
export async function prepareImage(
  file: Blob
): Promise<{ blob: Blob; width: number | null; height: number | null }> {
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // Not decodable here. Let the server judge the bytes.
    return { blob: file, width: null, height: null };
  }
  const natural = { width: bitmap.width, height: bitmap.height };
  const target = fitWithin(natural.width, natural.height);
  const untouched = target.width === natural.width && file.size <= MAX_UPLOAD_BYTES;
  // An animated GIF would be flattened by a redraw, so it goes as it is.
  if (untouched || file.type === "image/gif") {
    bitmap.close();
    return { blob: file, ...natural };
  }
  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return { blob: file, ...natural };
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, target.width, target.height);
  bitmap.close();
  const attempts: [string, number | undefined][] = [
    ["image/png", undefined],
    ["image/webp", 0.9],
    ["image/jpeg", 0.88],
    ["image/jpeg", 0.75],
  ];
  for (const [type, quality] of attempts) {
    const blob = await encode(canvas, type, quality);
    if (blob && blob.type === type && blob.size <= MAX_UPLOAD_BYTES) return { blob, ...target };
  }
  throw new Error("This image is too large to add, even after shrinking it.");
}

/** Upload one image. Throws with a sentence fit to show the writer. */
export async function uploadImage(file: Blob): Promise<UploadedImage> {
  const token = getToken();
  if (!token) throw new Error("Sign in to add images.");
  const prepared = await prepareImage(file);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS * 3);
  let res: Response;
  try {
    res = await fetch("/api/assets", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": prepared.blob.type || "application/octet-stream",
      },
      body: prepared.blob,
      signal: controller.signal,
    });
  } catch {
    throw new Error("Could not reach the server to add the image.");
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    let message = "Could not add the image.";
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error + ".";
    } catch {
      /* keep the generic sentence */
    }
    throw new Error(message);
  }
  const body = (await res.json()) as { id: string; url: string };
  return { id: body.id, url: body.url, width: prepared.width, height: prepared.height };
}

/** The image files in a drop or a paste, in order. */
export function imageFilesFrom(data: DataTransfer | null | undefined): File[] {
  if (!data) return [];
  return Array.from(data.files ?? []).filter((f) => /^image\/(png|jpeg|webp|gif)$/.test(f.type));
}
