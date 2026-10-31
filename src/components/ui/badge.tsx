import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "border-border bg-muted text-foreground",
        success: "border-emerald-300 bg-emerald-100 text-emerald-900",
        warning: "border-amber-300 bg-amber-100 text-amber-900",
        danger: "border-red-300 bg-red-100 text-red-900",
        info: "border-sky-300 bg-sky-100 text-sky-900",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

/** Etiqueta de estado. El significado SIEMPRE va en el texto (no solo en el color). */
export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
