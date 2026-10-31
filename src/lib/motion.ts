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

/** ¿Activó la persona el «ahorro de datos» del navegador? (Chrome/Android; en los demás es siempre falso.) */
export function prefersSavingData(): boolean {
  if (typeof navigator === "undefined") return false;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
}

/**
 * Avisa cuando la persona activa o desactiva «reducir movimiento» con la página ya abierta (por ejemplo desde los
 * ajustes del sistema). Devuelve la función para darse de baja.
 */
export function onReducedMotionChange(listener: (reduced: boolean) => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  const handler = (event: MediaQueryListEvent) => listener(event.matches);
  query.addEventListener("change", handler);
  return () => query.removeEventListener("change", handler);
}
