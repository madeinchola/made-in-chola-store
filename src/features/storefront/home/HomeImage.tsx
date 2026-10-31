import { useState } from "react";
import { ImagePlaceholder } from "@/components/store/ImagePlaceholder";
import { homeMediaUrl } from "@/features/catalog/mediaUrl";
import type { HomeMedia } from "@/features/catalog/types";
import { cn } from "@/lib/utils";

interface HomeImageProps {
  media: HomeMedia;
  /** Clases de la imagen (por defecto llena su contenedor con `object-cover`). */
  className?: string;
  /** Imagen del hero (la que da el LCP): carga inmediata y prioridad alta. */
  priority?: boolean;
  /** Sin imagen (o si falla): marcador provisional. `false` = no pintar nada (el hero usa el fondo de la marca). */
  placeholder?: boolean;
}

/**
 * Imagen de una sección de la portada. La que no existe o no carga se sustituye por el marcador PROVISIONAL (nunca un
 * icono de imagen rota). Con `alt` vacío si el admin no lo escribió: la sección ya tiene su título.
 */
export function HomeImage({
  media,
  className,
  priority = false,
  placeholder = true,
}: HomeImageProps) {
  const [failed, setFailed] = useState(false);
  const src = media.kind === "image" ? homeMediaUrl("image", media.path) : null;
  if (!src || failed) return placeholder ? <ImagePlaceholder /> : null;
  // `fetchpriority` en minúscula: React 18 no conoce `fetchPriority` y avisaría por consola.
  const extra: Record<string, string> = priority ? { fetchpriority: "high" } : {};
  return (
    <img
      src={src}
      alt={media.alt?.trim() ?? ""}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      onError={() => setFailed(true)}
      className={cn("h-full w-full object-cover", className)}
      {...extra}
    />
  );
}
