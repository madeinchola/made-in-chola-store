import { cn } from "@/lib/utils";

/**
 * Estilos de los controles de la cabecera del diseño. Sobre el hero (`overlay`) el texto es blanco y el anillo de foco
 * también (el marrón no se vería sobre una foto oscura); sobre el fondo claro hereda los colores normales.
 */
const overlayRing = "focus-visible:ring-white focus-visible:ring-offset-0";

const base = "transition-opacity duration-fast ease-standard hover:opacity-70";

/** Texto de navegación: mayúsculas con espaciado (SHOP, ABOUT, BOLIVIA), en peso normal como el diseño. */
export const navItemClass = (overlay: boolean) =>
  cn(
    "eyebrow inline-flex items-center gap-1.5 py-2 font-normal tracking-[0.16em]",
    base,
    overlay && overlayRing,
  );

/** Icono de la derecha (bolsa, cuenta, lupa): 40 px de toque en escritorio y 36 px en móvil. */
export const iconClass = (overlay: boolean) =>
  cn(
    "inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-sm sm:h-10 sm:min-w-10 lg:min-w-6 lg:px-0.5",
    base,
    overlay && overlayRing,
  );

/** Color del texto de la cabecera. */
export const toneClass = (overlay: boolean) => (overlay ? "text-white" : "text-foreground");
