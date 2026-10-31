import { useState } from "react";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Acción destructiva (archivar, salir sin guardar): el botón de confirmar se pinta de alerta. */
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
}

/**
 * Confirmación explícita antes de una acción con efectos. Mientras `onConfirm` corre (si es asíncrona) los botones se
 * bloquean: un doble clic no ejecuta la acción dos veces. Si lanza, el diálogo queda abierto para que se vea el error.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = t("admin.actions.cancel"),
  destructive = false,
  onConfirm,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // el llamador muestra el error (toast); el diálogo sigue abierto para reintentar o cancelar
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            disabled={busy}
            onClick={() => void confirm()}
            className={
              destructive
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : ""
            }
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
