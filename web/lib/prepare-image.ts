import { COIN_IMAGE_MAX_BYTES, COIN_IMAGE_MAX_EDGE, imageFileProblem, normalizeImageType } from "@/lib/image";

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read that picture."));
    img.src = url;
  });
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), type, quality));
}

async function encode(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, img: CanvasImageSource): Promise<{ blob: Blob; type: "image/webp" | "image/jpeg" }> {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.86, 0.72, 0.58]) {
    const webp = await canvasBlob(canvas, "image/webp", quality);
    if (webp && webp.size > 0 && webp.size <= COIN_IMAGE_MAX_BYTES && (!webp.type || webp.type === "image/webp")) {
      return { blob: webp, type: "image/webp" };
    }
  }
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.86, 0.72, 0.58]) {
    const jpeg = await canvasBlob(canvas, "image/jpeg", quality);
    if (jpeg && jpeg.size > 0 && jpeg.size <= COIN_IMAGE_MAX_BYTES && (!jpeg.type || jpeg.type === "image/jpeg")) {
      return { blob: jpeg, type: "image/jpeg" };
    }
  }
  throw new Error("That picture is still over 2 MB after resizing. Try a simpler one.");
}

async function downscale(file: File, width: number, height: number): Promise<File> {
  const scale = COIN_IMAGE_MAX_EDGE / Math.max(width, height);
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not prepare that picture.");
    const encoded = await encode(canvas, ctx, img);
    const ext = encoded.type === "image/webp" ? "webp" : "jpg";
    return new File([encoded.blob], `pet.${ext}`, { type: encoded.type });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Rejects non-images and files over 2 MB, then shrinks an edge longer than 512px to WebP or JPEG. */
export async function prepareCoinImage(file: File): Promise<File> {
  const problem = imageFileProblem(file);
  if (problem) throw new Error(problem);
  const type = normalizeImageType(file.type);
  const source = type === file.type ? file : new File([file], file.name || "pet", { type });
  const url = URL.createObjectURL(source);
  let width = 0;
  let height = 0;
  try {
    const img = await loadImage(url);
    width = img.naturalWidth;
    height = img.naturalHeight;
  } finally {
    URL.revokeObjectURL(url);
  }
  if (width < 1 || height < 1) throw new Error("Could not read that picture.");
  if (Math.max(width, height) <= COIN_IMAGE_MAX_EDGE) return source;
  return downscale(source, width, height);
}
