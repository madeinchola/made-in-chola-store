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
      const active = document.activeElement;
      // En Safari y Firefox (macOS) un clic NO enfoca el botón: `activeElement` es <body>, y devolverle el foco a <body>
      // anularía el retorno de Radix al `Trigger`. Si no hay un elemento concreto, no se guarda nada.
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
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
    className={cn(
      "fixed inset-0 z-50 bg-foreground/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = "DialogOverlay";

/**
 * Base de los paneles modales (diálogo y cajón): portal, fondo, foco devuelto al abrir desde un botón corriente y botón
 * de cierre. No pone posición ni tamaño: los define quien lo usa (`DialogContent`, `SheetContent`).
 *
 * El contenido va en un cuerpo con scroll PROPIO (`bodyClassName`) y el botón de cierre queda fuera de él: si el
 * contenedor entero se desplazara, la X se iría con el contenido y en un móvil bajito no habría cómo cerrar.
 */
export const DialogPanel = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    closeClassName?: string;
    bodyClassName?: string;
  }
>(({ className, closeClassName, bodyClassName, children, onCloseAutoFocus, ...props }, ref) => {
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
        className={className}
        {...props}
      >
        <div className={cn("min-h-0 flex-1 overflow-y-auto", bodyClassName)}>{children}</div>
        <DialogPrimitive.Close
          className={cn(
            "absolute right-4 top-4 rounded-sm p-1 opacity-70 transition-opacity duration-fast hover:opacity-100",
            closeClassName,
          )}
        >
          <X className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">{t("ui.close")}</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
DialogPanel.displayName = "DialogPanel";

/** Diálogo modal accesible (foco atrapado, Esc cierra, devuelve el foco). `bodyClassName` ajusta el cuerpo con scroll. */
export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { bodyClassName?: string }
>(({ className, bodyClassName, ...props }, ref) => (
  <DialogPanel
    ref={ref}
    className={cn(
      "fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-card border bg-card text-card-foreground shadow-lg duration-base data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
      className,
    )}
    bodyClassName={cn("grid gap-4 p-6", bodyClassName)}
    {...props}
  />
));
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
    className={cn("font-display text-display-sm leading-none", className)}
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
