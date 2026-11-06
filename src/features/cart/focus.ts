import { type RefObject, useLayoutEffect } from "react";

/** Elementos a los que se mueve el foco cuando algo que lo tenía desaparece. */
export const NEIGHBOUR_FOCUS = "[data-line-focus]";
export const HEADING_FOCUS = "[data-cart-heading]";

/**
 * Adónde mandar el foco cuando el botón `from` desaparece: el enlace con el nombre del producto de su línea (si está en
 * una) o, si no, el título de la bolsa (el de la página o el del cajón, según dónde esté). Nunca un botón: un segundo
 * Intro o un doble toque lo activaría.
 */
export function rescueTarget(from: Element): HTMLElement | null {
  const inLine = from.closest("li")?.querySelector<HTMLElement>(NEIGHBOUR_FOCUS);
  if (inLine) return inLine;
  const scope = from.closest('[role="dialog"]') ?? document;
  return scope.querySelector<HTMLElement>(HEADING_FOCUS);
}

/**
 * Si el elemento deja de existir MIENTRAS tiene el foco (se cierra el aviso, se pulsa «Reintentar» y el aviso se va, se
 * deshace un cambio), el foco cae al `<body>` y quien navega con teclado o lector de pantalla se queda en el aire. Lo
 * decide aquí, al desmontarse (el efecto de limpieza corre antes de quitar el nodo, así que todavía se sabe si lo tenía).
 * No hace nada si el foco estaba en otra parte: solo rescata, no roba.
 */
export function useRescueFocus(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const node = ref.current;
    return () => {
      if (node && document.activeElement === node) rescueTarget(node)?.focus();
    };
  }, [ref]);
}
