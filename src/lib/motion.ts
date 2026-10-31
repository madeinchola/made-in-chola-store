/**
 * ¿La persona pidió reducir el movimiento? Las animaciones por CSS ya lo respetan (regla global de `index.css`), pero
 * las que mueve JavaScript (el deslizamiento de embla) no: hay que consultarlo y saltar directamente.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
