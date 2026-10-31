import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-pill border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "border-border bg-muted text-foreground",
        success: "border-success/40 bg-success-soft text-success",
        warning: "border-warning/40 bg-warning-soft text-warning",
        danger: "border-destructive/40 bg-destructive-soft text-destructive",
        info: "border-info/40 bg-info-soft text-info",
        /** Marca de la tienda ("NUEVO"): relleno marrón. */
        solid: "border-primary bg-primary text-primary-foreground",
        /** Etiqueta discreta sobre imagen o fondo liso. */
        outline: "border-foreground/40 bg-transparent text-foreground",
      },
      /** Mayúsculas con espaciado (chips de la tienda). */
      caps: { true: "eyebrow", false: "" },
    },
    defaultVariants: { tone: "neutral", caps: false },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

/** Etiqueta de estado. El significado SIEMPRE va en el texto (no solo en el color). */
export function Badge({ className, tone, caps, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone, caps }), className)} {...props} />;
}
