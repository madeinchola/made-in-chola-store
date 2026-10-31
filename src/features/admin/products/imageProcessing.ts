/**
 * Preparación de imágenes de producto antes de subirlas: validación, reducción en el navegador y ruta de Storage.
 * Los límites reproducen los del bucket `product-images` (5 MiB; jpeg/png/webp/avif; ruta products/{uuid}/{uuid}.ext):
 * si cambian en la base, hay que cambiarlos aquí.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Lado mayor máximo tras reducir: suficiente para zoom en escritorio sin subir fotos de 12 MP. */
export const MAX_IMAGE_SIDE = 2000;
/** Por debajo de este peso y de MAX_IMAGE_SIDE no se recomprime (evita perder calidad sin ganar nada). */
export const SKIP_COMPRESS_BYTES = 1.5 * 1024 * 1024;
export const WEBP_QUALITY = 0.85;

const TYPE_TO_EXT: Record<string, "jpg" | "png" | "webp" | "avif"> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};
export const ALLOWED_IMAGE_TYPES = Object.keys(TYPE_TO_EXT);

export const extensionFor = (contentType: string): string | null =>
  TYPE_TO_EXT[contentType] ?? null;

export type ImageFileProblem = "empty" | "type" | "too_large";

/** ¿Se puede subir este archivo tal cual? (`too_large` solo si, además, no hay forma de reducirlo). */
export function checkImageFile(file: { type: string; size: number }): ImageFileProblem | null {
  if (file.size <= 0) return "empty";
  if (!(file.type in TYPE_TO_EXT)) return "type";
  return null;
}

/** Reduce (width, height) para que el lado mayor no pase de `max`, conservando la proporción. Nunca agranda. */
export function fitWithin(
  width: number,
  height: number,
  max: number = MAX_IMAGE_SIDE,
): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) throw new RangeError("Dimensiones de imagen inválidas");
  const longest = Math.max(width, height);
  if (longest <= max) return { width: Math.round(width), height: Math.round(height) };
  const scale = max / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** ¿Vale la pena recomprimir? Sí si es muy grande en píxeles o pesa más del umbral. */
export function shouldCompress(info: { width: number; height: number; bytes: number }): boolean {
  return Math.max(info.width, info.height) > MAX_IMAGE_SIDE || info.bytes > SKIP_COMPRESS_BYTES;
}

/** Ruta de Storage válida para el bucket: products/{productId}/{fileId}.{ext}. */
export function productImagePath(productId: string, fileId: string, ext: string): string {
  return `products/${productId}/${fileId}.${ext}`;
}

export interface PreparedImage {
  blob: Blob;
  contentType: string;
  ext: string;
}

/**
 * Deja la imagen lista para subir: la reduce/recomprime a WebP si hace falta. Si el navegador no puede (sin canvas,
 * formato no decodificable) y el archivo original cabe en el límite, se sube tal cual; si no cabe, falla con un
 * error claro. Lanza `Error("type" | "empty" | "too_large")` para que la pantalla muestre el mensaje correcto.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const problem = checkImageFile(file);
  if (problem === "empty" || problem === "type") throw new Error(problem);
  const original: PreparedImage = {
    blob: file,
    contentType: file.type,
    ext: extensionFor(file.type) as string,
  };
  try {
    const bitmap = await createImageBitmap(file);
    try {
      const { width, height } = bitmap;
      if (!shouldCompress({ width, height, bytes: file.size })) {
        if (file.size > MAX_IMAGE_BYTES) throw new Error("too_large");
        return original;
      }
      const target = fitWithin(width, height);
      const canvas = document.createElement("canvas");
      canvas.width = target.width;
      canvas.height = target.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no_canvas");
      ctx.drawImage(bitmap, 0, 0, target.width, target.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/webp", WEBP_QUALITY),
      );
      if (!blob || blob.type !== "image/webp") throw new Error("no_webp");
      if (blob.size > MAX_IMAGE_BYTES) throw new Error("too_large");
      return { blob, contentType: "image/webp", ext: "webp" };
    } finally {
      bitmap.close();
    }
  } catch (e) {
    if (e instanceof Error && e.message === "too_large") throw e;
    if (file.size <= MAX_IMAGE_BYTES) return original;
    throw new Error("too_large");
  }
}
