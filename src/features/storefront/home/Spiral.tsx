import { cn } from "@/lib/utils";

/**
 * Símbolo espiral de la frase grande de la portada. PROVISIONAL: es una aproximación geométrica generada (una espiral
 * trenzada con trazo discontinuo), no el símbolo oficial del diseño; se sustituye por el SVG de la diseñadora.
 */
const POINTS = Array.from({ length: 120 }, (_, index) => {
  const progress = index / 119;
  const angle = progress * Math.PI * 4.6;
  const radius = 5 + progress * 41;
  return `${(50 + radius * Math.cos(angle)).toFixed(1)} ${(50 + radius * Math.sin(angle)).toFixed(1)}`;
});
const PATH = `M${POINTS.join(" L")}`;

export function Spiral({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
      data-provisional="true"
      className={cn("shrink-0", className)}
    >
      <path
        d={PATH}
        fill="none"
        stroke="currentColor"
        strokeWidth="6.5"
        strokeLinecap="round"
        strokeDasharray="1.6 1.8"
      />
    </svg>
  );
}
