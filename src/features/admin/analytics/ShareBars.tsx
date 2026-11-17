import { cn } from "@/lib/utils";

export interface ShareBarRow {
  key: string;
  label: string;
  /** Texto principal de la fila (importe o conteo). */
  value: string;
  /** Texto secundario (porcentaje, pedidos…). */
  detail?: string;
  /** 0–100: el ancho de la barra. */
  percent: number;
}

/**
 * Barras horizontales hechas con HTML: sin librería de gráficos, legibles con lector de pantalla (cada fila es texto) y sin que el
 * significado dependa del color (el número y el porcentaje van escritos).
 */
export function ShareBars({ rows, className }: { rows: ShareBarRow[]; className?: string }) {
  return (
    <ul className={cn("space-y-3", className)}>
      {rows.map((row) => (
        <li key={row.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 break-words font-medium">{row.label}</span>
            <span className="shrink-0 tabular-nums">
              {row.value}
              {row.detail && (
                <span className="ml-2 text-xs text-muted-foreground">{row.detail}</span>
              )}
            </span>
          </div>
          <div className="mt-1 h-2 rounded-pill bg-muted" aria-hidden="true">
            <div
              className="h-2 rounded-pill bg-primary"
              style={{ width: `${Math.max(2, Math.min(100, row.percent))}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
