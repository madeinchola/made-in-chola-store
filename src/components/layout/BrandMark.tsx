import { cn } from "@/lib/utils";

/**
 * Símbolo del pie del diseño: un anillo abierto de cuentas de distinto tamaño. PROVISIONAL: es una aproximación
 * geométrica generada, no el símbolo oficial; se sustituye por el SVG de la diseñadora cuando llegue.
 */
const BEADS = Array.from({ length: 28 }, (_, index) => {
  const total = 28;
  // Arco de 270° desde abajo a la derecha, por la izquierda, hasta arriba a la derecha: la «C» abierta del diseño.
  const angle = ((40 + (270 * index) / (total - 1)) * Math.PI) / 180;
  const cx = 60 + 50 * Math.cos(angle);
  const cy = 75 + 64 * Math.sin(angle);
  const radius = 3.4 + 3.4 * Math.abs(Math.sin(index * 0.8));
  const tangent = (Math.atan2(64 * Math.cos(angle), -50 * Math.sin(angle)) * 180) / Math.PI;
  return { cx, cy, rx: radius * 1.7, ry: radius, tangent };
});

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 150"
      aria-hidden="true"
      focusable="false"
      className={cn("fill-current", className)}
    >
      {BEADS.map((bead, index) => (
        <ellipse
          key={index}
          cx={bead.cx.toFixed(2)}
          cy={bead.cy.toFixed(2)}
          rx={bead.rx.toFixed(2)}
          ry={bead.ry.toFixed(2)}
          transform={`rotate(${bead.tangent.toFixed(1)} ${bead.cx.toFixed(2)} ${bead.cy.toFixed(2)})`}
        />
      ))}
    </svg>
  );
}
