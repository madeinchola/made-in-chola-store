import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { t } from "@/i18n";
import type { Address } from "./types";

interface ArchiveDialogProps {
  /** La dirección que se quiere archivar (null = cerrado). */
  address: Address | null;
  pending: boolean;
  /** Mensaje si el archivado falló (el diálogo se queda abierto para reintentar o cancelar). */
  error: string | null;
  onConfirm: (address: Address) => void;
  onClose: () => void;
  /** Se llama al cerrarse, cuando el botón que lo abrió ya no existe: aquí se decide a dónde va el foco. */
  onCloseAutoFocus: (event: Event) => void;
}

/** Confirmación de «Archivar»: explica que NO se elimina (se puede restaurar) y qué pasa con la predeterminada. */
export function ArchiveDialog({
  address,
  pending,
  error,
  onConfirm,
  onClose,
  onCloseAutoFocus,
}: ArchiveDialogProps) {
  return (
    <Dialog
      open={address !== null}
      onOpenChange={(open) => {
        // Mientras se archiva no se puede cerrar: se perdería el resultado.
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        {address && (
          <>
            <DialogHeader>
              <DialogTitle>{t("acct.addresses.archiveDialog.title")}</DialogTitle>
              <DialogDescription>
                {t("acct.addresses.archiveDialog.body", { label: address.label })}
              </DialogDescription>
            </DialogHeader>
            {address.isDefault && (
              <p className="text-sm">{t("acct.addresses.archiveDialog.defaultNote")}</p>
            )}
            {error && (
              <p
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive-soft p-3 text-sm text-destructive"
              >
                {error}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                aria-disabled={pending || undefined}
                onClick={() => {
                  if (!pending) onClose();
                }}
              >
                {t("acct.addresses.archiveDialog.cancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                loading={pending}
                onClick={() => onConfirm(address)}
              >
                {pending
                  ? t("acct.addresses.archiveDialog.working")
                  : t("acct.addresses.archiveDialog.confirm")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
