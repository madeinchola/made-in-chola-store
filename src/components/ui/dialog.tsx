import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

const OpenerContext = React.createContext<React.MutableRefObject<HTMLElement | null> | null>(null);

/**
 * Diálogo controlado que, al cerrarse, DEVUELVE EL FOCO a quien lo abrió. Radix solo lo hace cuando hay un `DialogTrigger`;
 * aquí los diálogos se abren desde botones corrientes, y sin esto el foco caería al inicio de la página y quien navega con
 * teclado o lector de pantalla perdería su lugar.
 */
export function Dialog({ open, ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  const opener = React.useRef<HTMLElement | null>(null);
  const wasOpen = React.useRef(false);
  // Efecto de DISEÑO: corre antes que los efectos de Radix, que mueven el foco al diálogo; así aún se sabe quién lo tenía.
  React.useLayoutEffect(() => {
    if (open && !wasOpen.current) {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    wasOpen.current = Boolean(open);
  }, [open]);
  return (
    <OpenerContext.Provider value={opener}>
      <DialogPrimitive.Root {...(open === undefined ? {} : { open })} {...props} />
    </OpenerContext.Provider>
  );
}
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn("fixed inset-0 z-50 bg-foreground/50", className)}
    {...props}
  />
));
DialogOverlay.displayName = "DialogOverlay";

/** Diálogo modal accesible (foco atrapado, Esc cierra, devuelve el foco). Estilos neutros hasta S4. */
export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, onCloseAutoFocus, ...props }, ref) => {
  const opener = React.useContext(OpenerContext);
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        onCloseAutoFocus={(event) => {
          const element = opener?.current;
          if (element?.isConnected) {
            event.preventDefault(); // evita que Radix intente enfocar un Trigger que no existe
            element.focus();
          }
          onCloseAutoFocus?.(event);
        }}
        className={cn(
          "fixed left-1/2 top-1/2 z-50 grid max-h-[90vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border bg-background p-6 shadow-lg",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm p-1 opacity-70 hover:opacity-100">
          <X className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">{t("admin.actions.close")}</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
DialogContent.displayName = "DialogContent";

export const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5", className)} {...props} />
);

export const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
    {...props}
  />
);

export const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("font-display text-lg font-semibold leading-none", className)}
    {...props}
  />
));
DialogTitle.displayName = "DialogTitle";

export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = "DialogDescription";
