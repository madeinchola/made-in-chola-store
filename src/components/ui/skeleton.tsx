import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Marcador de carga. Es decorativo (`aria-hidden`): el contenedor que carga debe llevar `aria-busy="true"`
 * (o un texto `sr-only` "Cargando…") para que los lectores de pantalla se enteren.
 */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}
