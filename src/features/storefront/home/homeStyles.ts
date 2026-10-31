/**
 * Medidas del PDF de Inicio (1366 px de ancho) expresadas como clases. Una sola fuente para que todas las secciones
 * de la portada compartan margen y títulos.
 */

/** Margen lateral de las filas y baldosas (≈ 40 px a 1366 px). */
export const gutterX = "px-[var(--gutter)]";

/** Título de sección en serif (≈ 30 px a 1366 px): «Our Most Popular Items», «Sombreros». */
export const sectionTitleClass =
  "font-display text-[clamp(1.5rem,0.9rem+1.4vw,1.875rem)] leading-tight";

/** Altura del hero: ≈ 922 px a 1366 px, con tope en pantallas grandes y mínimo en móvil. */
export const heroHeightClass = "h-[clamp(32rem,67.5vw,57.6rem)]";

/** Texto sobre una foto: blanco (el color de marca no se lee sobre imágenes) y anillo de foco blanco. */
export const overMediaClass = "text-white";
export const overMediaRing = "focus-visible:ring-white focus-visible:ring-offset-0";

/** Degradado tenue bajo el texto de una foto: el PDF no lo lleva (blanco sobre foto clara no cumple AA). */
export const mediaScrim = "bg-gradient-to-t from-black/50 via-black/10 to-transparent";
