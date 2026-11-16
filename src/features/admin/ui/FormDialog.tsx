import { useState, type FormEvent, type ReactNode } from "react";
import { t } from "@/i18n";
import { toAppError } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface FormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  submitLabel: string;
  busyLabel?: string;
  /** Acción destructiva: el botón de confirmar se pinta de alerta. */
  destructive?: boolean;
  /**
   * Valida y ejecuta. Devuelve `null` si salió bien (el diálogo se cierra) o el mensaje a mostrar (queda abierto para
   * corregir). Si lanza, se muestra el mensaje del error. Mientras corre, los botones están bloqueados: un doble clic no
   * ejecuta la acción dos veces.
   */
  onSubmit: () => Promise<string | null>;
  children: ReactNode;
  wide?: boolean;
}

/** Diálogo de un formulario con su error, su estado «trabajando…» y el bloqueo del doble envío (lo común a las acciones del panel). */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  busyLabel,
  destructive = false,
  onSubmit,
  children,
  wide = false,
}: FormDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const message = await onSubmit();
      if (message === null) onOpenChange(false);
      else setError(message);
    } catch (e) {
      setError(toAppError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent
        className={
          wide ? "max-h-[90vh] max-w-2xl overflow-y-auto" : "max-h-[90vh] max-w-lg overflow-y-auto"
        }
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} noValidate className="grid gap-4">
          {error && (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {error}
            </p>
          )}
          {children}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              {t("admin.actions.cancel")}
            </Button>
            <Button
              type="submit"
              className="min-h-11"
              variant={destructive ? "destructive" : "default"}
              loading={busy}
            >
              {busy && busyLabel ? busyLabel : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
