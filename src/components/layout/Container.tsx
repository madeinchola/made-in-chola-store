import * as React from "react";
import { cn } from "@/lib/utils";

/** Ancho máximo y margen lateral de la tienda (`container` de Tailwind: usa los tokens `--gutter` y `--container-max`). */
export const Container = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("container", className)} {...props} />
  ),
);
Container.displayName = "Container";
