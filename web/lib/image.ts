/** Factory `launch` rejects `image_uri` longer than 200 characters. */
export const IMAGE_URI_MAX = 200;

export const COIN_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

export const COIN_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

export const COIN_IMAGE_MAX_EDGE = 512;

export const BLOB_TOKEN_MISSING =
  "Image upload is not configured. BLOB_READ_WRITE_TOKEN is missing on the server. You can still launch without a picture.";

export type CoinImageType = (typeof COIN_IMAGE_TYPES)[number];

export function normalizeImageType(type: string): string {
  return type === "image/jpg" ? "image/jpeg" : type;
}

export function isCoinImageType(type: string): type is CoinImageType {
  return (COIN_IMAGE_TYPES as readonly string[]).includes(normalizeImageType(type));
}

/** Client upload pathname. Kept short so the public URL, plus Blob's random suffix, stays within 200 characters. */
export function coinImagePath(type: string): string {
  const normalized = normalizeImageType(type);
  const ext = normalized === "image/png" ? "png" : normalized === "image/gif" ? "gif" : normalized === "image/webp" ? "webp" : "jpg";
  return `coins/pet.${ext}`;
}

export function isCoinImagePath(pathname: string): boolean {
  return /^coins\/[a-z0-9][a-z0-9._-]{0,40}$/i.test(pathname);
}

export function imageFileProblem(file: { type: string; size: number }): string | null {
  if (!isCoinImageType(file.type)) return "Use a PNG, JPEG, WebP, or GIF.";
  if (file.size <= 0) return "That file is empty.";
  if (file.size > COIN_IMAGE_MAX_BYTES) return "Use a picture that is 2 MB or smaller.";
  return null;
}

/**
 * HTTPS only. Blob uploads and older pasted links both qualify.
 * `javascript:` and `data:` never do.
 */
export function safeCoinImage(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || [...trimmed].length > IMAGE_URI_MAX) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (!url.hostname || [...url.href].length > IMAGE_URI_MAX) return null;
  return url.href;
}
