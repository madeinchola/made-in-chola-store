import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Aviso de error de un formulario (`role="alert"`: se anuncia al aparecer). Con tokens de estado, nunca colores crudos. */
export function FormAlert({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-md border border-destructive/40 bg-destructive-soft p-3 text-sm text-destructive",
        className,
      )}
    >
      {children}
    </div>
  );
}
