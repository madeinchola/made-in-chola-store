import { useSyncExternalStore } from "react";

/** Mismo punto de corte que `lg:` de Tailwind: desde aquí las imágenes van apiladas; debajo, en carrusel. */
const QUERY = "(min-width: 1024px)";

function getSnapshot(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(QUERY).matches
    : false;
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const list = window.matchMedia(QUERY);
  list.addEventListener?.("change", onChange);
  return () => list.removeEventListener?.("change", onChange);
}

/** ¿Pantalla de escritorio? Se calcula en el primer pintado (sin parpadeo de un diseño a otro). */
export function useIsLargeScreen(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
