import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/i18n";
import { useCancelOrder } from "./hooks";

/**
 * Confirmación de «Cancelar el pedido» (BR-ORD-02): solo hasta antes de «preparing». Es el SERVIDOR quien decide: si entre
 * tanto el admin ya lo pasó a preparación, la respuesta es «ya no se puede» y se le explica, sin adivinar el estado aquí.
 * No se puede cerrar mientras se cancela (se perdería el resultado).
 */
export function CancelOrderDialog({
  order,
  open,
  onOpenChange,
  onDone,
}: {
  order: { id: string; number: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** El pedido se canceló (la pantalla se actualiza sola al invalidarse las consultas). */
  onDone?: () => void;
}) {
  const cancel = useCancelOrder();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setError(null);
    const result = await cancel.mutateAsync({
      orderId: order.id,
      ...(reason.trim() ? { reason } : {}),
    });
    if (result === "done") {
      toast.success(t("checkout.confirmation.cancel.done"));
      onOpenChange(false);
      onDone?.();
    } else {
      setError(
        result === "too_late"
          ? t("checkout.confirmation.cancel.tooLate")
          : t("checkout.confirmation.cancel.failed"),
      );
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && cancel.isPending) return;
        if (!next) {
          setError(null);
          setReason("");
        }
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("checkout.confirmation.cancel.title", { number: order.number })}
          </DialogTitle>
          <DialogDescription>{t("checkout.confirmation.cancel.body")}</DialogDescription>
        </DialogHeader>
        <Field label={t("checkout.confirmation.cancel.reasonLabel")}>
          <Textarea
            value={reason}
            maxLength={300}
            rows={3}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={cancel.isPending}
            onClick={() => onOpenChange(false)}
          >
            {t("checkout.confirmation.cancel.keep")}
          </Button>
          <Button type="button" disabled={cancel.isPending} onClick={() => void confirm()}>
            {cancel.isPending
              ? t("checkout.confirmation.cancel.working")
              : t("checkout.confirmation.cancel.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
