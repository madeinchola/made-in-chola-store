import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { DialogPanel } from "./dialog";
import { cn } from "@/lib/utils";

export {
  Dialog as Sheet,
  DialogTrigger as SheetTrigger,
  DialogClose as SheetClose,
  DialogHeader as SheetHeader,
  DialogFooter as SheetFooter,
  DialogTitle as SheetTitle,
  DialogDescription as SheetDescription,
} from "./dialog";

const sheetVariants = cva(
  "fixed z-50 flex flex-col bg-background text-foreground shadow-lg duration-slow ease-standard data-[state=closed]:animate-out data-[state=open]:animate-in",
  {
    variants: {
      side: {
        right:
          "inset-y-0 right-0 h-full w-[min(100%,26rem)] border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
        left: "inset-y-0 left-0 h-full w-[min(100%,26rem)] border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left",
        top: "inset-x-0 top-0 max-h-[85vh] border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        bottom:
          "inset-x-0 bottom-0 max-h-[85vh] rounded-t-card border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
      },
    },
    defaultVariants: { side: "right" },
  },
);

export interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPanel>, VariantProps<typeof sheetVariants> {}

/**
 * Cajón lateral o inferior (carrito, menú móvil, filtros). Es un diálogo modal: foco atrapado, Esc cierra,
 * devuelve el foco a quien lo abrió. Respeta las zonas seguras del móvil (notch / barra de inicio).
 */
export const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPanel>,
  SheetContentProps
>(({ side, className, children, ...props }, ref) => (
  <DialogPanel
    ref={ref}
    className={cn(
      sheetVariants({ side }),
      "pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]",
      className,
    )}
    {...props}
  >
    {children}
  </DialogPanel>
));
SheetContent.displayName = "SheetContent";
