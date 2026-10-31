import * as React from "react";
import { cn } from "@/lib/utils";

/** `<select>` nativo con el estilo de Input: accesible y usable con teclado y lectores sin dependencias extra. */
export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive sm:text-sm",
      className,
    )}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = "Select";
