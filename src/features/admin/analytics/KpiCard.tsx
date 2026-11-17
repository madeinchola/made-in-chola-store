import type { ReactNode } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { formatDelta } from "./logic";

export interface KpiDelta {
  /** Cambio contra el período anterior; `null` = no se puede calcular. */
  pct: number | null;
  /** Qué sentido es bueno: más ventas es bueno; más reembolsos, no. */
  goodWhen: "up" | "down" | "neutral";
}

interface KpiCardProps {
  label: string;
  value: string;
  delta?: KpiDelta;
  hint?: string;
  /** Aviso que cambia el significado del número (p. ej. el margen solo cubre una parte). */
  note?: ReactNode;
  tone?: "default" | "warn";
}

/** Una tarjeta de indicador: el valor, cuánto cambió y una línea de ayuda. El cambio se dice con signo y texto, no solo con color. */
export function KpiCard({ label, value, delta, hint, note, tone = "default" }: KpiCardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-background p-4",
        tone === "warn" && "border-warning/40 bg-warning-soft",
      )}
    >
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1">
        <span className="block break-words text-2xl font-bold">{value}</span>
        {delta && <DeltaLine delta={delta} />}
        {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
        {note && <span className="mt-1 block text-xs">{note}</span>}
      </dd>
    </div>
  );
}

function DeltaLine({ delta }: { delta: KpiDelta }) {
  if (delta.pct === null) {
    return (
      <span className="mt-1 block text-xs text-muted-foreground">
        {t("admin.analytics.dashboard.kpi.noPrevious")}
      </span>
    );
  }
  const direction = delta.pct > 0 ? "up" : delta.pct < 0 ? "down" : "flat";
  const good =
    delta.goodWhen === "neutral" || direction === "flat"
      ? null
      : (direction === "up") === (delta.goodWhen === "up");
  const Icon =
    direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : ArrowRight;
  return (
    <span
      className={cn(
        "mt-1 flex items-center gap-1 text-xs font-medium",
        good === null && "text-muted-foreground",
        good === true && "text-success",
        good === false && "text-destructive",
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {t("admin.analytics.dashboard.kpi.vsPrevious", { delta: formatDelta(delta.pct) })}
    </span>
  );
}
