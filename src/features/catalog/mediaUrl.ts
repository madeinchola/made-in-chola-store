import { getSupabase } from "@/lib/supabase";

export type MediaBucket = "product-images" | "site-media" | "site-videos";

/** URL pública de un archivo de Storage (los 3 buckets del sitio son de lectura pública). */
export function publicMediaUrl(bucket: MediaBucket, path: string): string {
  return getSupabase().storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

export const productImageUrl = (path: string) => publicMediaUrl("product-images", path);

/** Imagen o video de una sección del home; null si no hay medio. */
export function homeMediaUrl(kind: "none" | "image" | "video", path: string | null): string | null {
  if (kind === "none" || !path) return null;
  return publicMediaUrl(kind === "video" ? "site-videos" : "site-media", path);
}
