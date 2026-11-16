import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { t, type MessageKey } from "@/i18n";
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
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { transitionOrder } from "./api";
import { useOrderMutation } from "./hooks";
import { errorText, nextStatus, statusLabel, validateText } from "./logic";
import { resultCode, succeeded, TRANSITION_OK } from "./outcomes";
import type { OrderStatus } from "./types";

export interface AdvanceTarget {
  id: string;
  number: string;
  status: OrderStatus;
}

interface Props {
  order: AdvanceTarget | null;
  onOpenChange: (open: boolean) => void;
  /** Lo que se le dice a quien avanzó el pedido (queda en la región de estado de la pantalla). */
  onDone: (message: string) => void;
}

/**
 * Avanzar el pedido un paso con confirmación. Manda el estado que la persona VIO (`expectedFrom`): si otro administrador ya lo
 * movió, la base responde «stale» y se le cuenta, en vez de mover algo distinto de lo que miraba.
 */
export function AdvanceDialog({ order, onOpenChange, onDone }: Props) {
  return (
    <Dialog open={order !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" onInteractOutside={(event) => event.preventDefault()}>
        {order && <AdvanceForm order={order} onDone={onDone} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function AdvanceForm({
  order,
  onDone,
  onClose,
}: {
  order: AdvanceTarget;
  onDone: (m: string) => void;
  onClose: () => void;
}) {
  const next = nextStatus(order.status);
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const advance = useOrderMutation((text: string | null) =>
    transitionOrder(order.id, next as string, text, order.status),
  );
  if (!next) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (advance.isPending) return;
    setFormError(null);
    setProblem(null);
    let text: string | null = null;
    if (reason.trim() !== "") {
      const parsed = validateText(reason, 300);
      if (!parsed.ok) {
        setProblem(t("admin.orders.advanceDialog.reasonTooLong"));
        return;
      }
      text = parsed.value;
    }
    try {
      const result = await advance.mutateAsync(text);
      if (succeeded(result, TRANSITION_OK)) {
        const message = t("admin.orders.advanceDialog.done", {
          number: order.number,
          status: statusLabel(next as OrderStatus),
        });
        onDone(message);
        toast.success(message);
        onClose();
      } else {
        setFormError(errorText(resultCode(result)));
      }
    } catch (error) {
      setFormError(toAppError(error).message);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {t(`admin.orders.advance.${order.status}` as MessageKey)} · {order.number}
        </DialogTitle>
        <DialogDescription>
          {t(`admin.orders.advanceDialog.effect.${order.status}` as MessageKey)}
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={(event) => void submit(event)} noValidate className="grid gap-4">
        {formError && (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {formError}
          </p>
        )}
        <Field
          label={t("admin.orders.advanceDialog.reason")}
          {...(problem ? { error: problem } : {})}
        >
          <Textarea
            rows={2}
            maxLength={300}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={advance.isPending}
            onClick={onClose}
          >
            {t("admin.actions.cancel")}
          </Button>
          <Button type="submit" className="min-h-11" loading={advance.isPending}>
            {advance.isPending
              ? t("admin.orders.advanceDialog.working")
              : t("admin.orders.advanceDialog.confirm")}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
