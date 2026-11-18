/** Carga un script externo UNA sola vez (si ya está en la página, no lo vuelve a poner). */
export function loadScript(src: string): void {
  if (typeof document === "undefined") return;
  if (document.querySelector(`script[src="${src}"]`)) return;
  const script = document.createElement("script");
  script.async = true;
  script.src = src;
  document.head.appendChild(script);
}
