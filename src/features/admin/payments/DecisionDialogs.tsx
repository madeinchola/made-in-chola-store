import { useState, type FormEvent } from "react";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { confirmPaymentManually, resolveReview, reviewProof } from "./api";
import { usePaymentMutation } from "./hooks";
import { formatMoney, validateNote, validateReason, validateReceived } from "./logic";
import type { PendingProof } from "./types";

const A = "admin.payments.review.approve" as const;
const R = "admin.payments.review.reject" as const;

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
    >
      {message}
    </p>
  );
}

interface DialogBase {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Lo que se le dice a quien decidió (queda en la región de estado de la pantalla). */
  onDone: (message: string) => void;
}

/** Aprobar un comprobante: el monto que el admin vio es opcional (vacío = el esperado). */
export function ApproveProofDialog({
  proof,
  open,
  onOpenChange,
  onDone,
}: DialogBase & { proof: PendingProof | null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" onInteractOutside={(event) => event.preventDefault()}>
        {proof && <ApproveForm proof={proof} onDone={onDone} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function ApproveForm({
  proof,
  onDone,
  onClose,
}: {
  proof: PendingProof;
  onDone: (m: string) => void;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const save = usePaymentMutation((value: number | null) =>
    reviewProof(proof.id, "approve", null, value),
  );
  const expected = formatMoney(proof.amount, proof.currency);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending) return;
    setFormError(null);
    const parsed = validateReceived(amount);
    if (!parsed.ok) {
      setProblem(`${A}.errors.${parsed.problem}` as MessageKey);
      return;
    }
    setProblem(null);
    try {
      const result = await save.mutateAsync(parsed.value);
      if (result.outcome === "already_reviewed" || result.outcome === "not_found") {
        onDone(t(`${A}.already`));
      } else if (result.outcome === "approved") {
        const review = result.payment?.outcome === "review";
        onDone(t(review ? `${A}.doneReview` : `${A}.done`));
      }
      onClose();
    } catch (error) {
      setFormError(toAppError(error).message);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t(`${A}.title`, { number: proof.orderNumber })}</DialogTitle>
        <DialogDescription>{t(`${A}.description`)}</DialogDescription>
      </DialogHeader>
      <form onSubmit={(event) => void submit(event)} noValidate className="grid gap-4">
        <FormError message={formError} />
        <Field
          label={t(`${A}.amountLabel`)}
          hint={t(`${A}.amountHelp`, { expected })}
          error={problem ? t(problem) : undefined}
        >
          <Input
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            placeholder={String(proof.amount).replace(".", ",")}
            onChange={(event) => setAmount(event.target.value)}
          />
        </Field>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={save.isPending}
            onClick={onClose}
          >
            {t("admin.actions.cancel")}
          </Button>
          <Button type="submit" className="min-h-11" loading={save.isPending}>
            {save.isPending ? t(`${A}.submitting`) : t(`${A}.submit`)}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

/** Rechazar un comprobante: el motivo es obligatorio y se lo muestra la clienta. */
export function RejectProofDialog({
  proof,
  open,
  onOpenChange,
  onDone,
}: DialogBase & { proof: PendingProof | null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" onInteractOutside={(event) => event.preventDefault()}>
        {proof && <RejectForm proof={proof} onDone={onDone} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function RejectForm({
  proof,
  onDone,
  onClose,
}: {
  proof: PendingProof;
  onDone: (m: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const save = usePaymentMutation((value: string) => reviewProof(proof.id, "reject", value, null));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending) return;
    setFormError(null);
    const parsed = validateReason(reason);
    if (!parsed.ok) {
      setProblem(`${R}.errors.${parsed.problem}` as MessageKey);
      return;
    }
    setProblem(null);
    try {
      const result = await save.mutateAsync(parsed.value);
      onDone(t(result.outcome === "rejected" ? `${R}.done` : `${R}.already`));
      onClose();
    } catch (error) {
      setFormError(toAppError(error).message);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t(`${R}.title`, { number: proof.orderNumber })}</DialogTitle>
        <DialogDescription>{t(`${R}.description`)}</DialogDescription>
      </DialogHeader>
      <form onSubmit={(event) => void submit(event)} noValidate className="grid gap-4">
        <FormError message={formError} />
        <Field
          label={t(`${R}.reasonLabel`)}
          hint={t(`${R}.reasonHelp`)}
          error={problem ? t(problem) : undefined}
        >
          <Textarea
            value={reason}
            maxLength={400}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={save.isPending}
            onClick={onClose}
          >
            {t("admin.actions.cancel")}
          </Button>
          <Button type="submit" variant="destructive" className="min-h-11" loading={save.isPending}>
            {save.isPending ? t(`${R}.submitting`) : t(`${R}.submit`)}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

/** Resolver una revisión abierta: la nota (qué se hizo) es obligatoria y queda a nombre de quien la escribe. */
export function ResolveReviewDialog({
  review,
  open,
  onOpenChange,
  onDone,
}: DialogBase & { review: { id: string; orderNumber: string } | null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" onInteractOutside={(event) => event.preventDefault()}>
        {review && (
          <ResolveForm review={review} onDone={onDone} onClose={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ResolveForm({
  review,
  onDone,
  onClose,
}: {
  review: { id: string; orderNumber: string };
  onDone: (m: string) => void;
  onClose: () => void;
}) {
  const K = "admin.payments.review.resolve" as const;
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const save = usePaymentMutation((value: string) => resolveReview(review.id, value));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending) return;
    setFormError(null);
    const parsed = validateNote(note);
    if (!parsed.ok) {
      setProblem(`${K}.errors.${parsed.problem}` as MessageKey);
      return;
    }
    setProblem(null);
    try {
      const result = await save.mutateAsync(parsed.value);
      onDone(t(result.outcome === "resolved" ? `${K}.done` : `${K}.already`));
      onClose();
    } catch (error) {
      setFormError(toAppError(error).message);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t(`${K}.title`, { number: review.orderNumber })}</DialogTitle>
        <DialogDescription>{t(`${K}.description`)}</DialogDescription>
      </DialogHeader>
      <form onSubmit={(event) => void submit(event)} noValidate className="grid gap-4">
        <FormError message={formError} />
        <Field
          label={t(`${K}.noteLabel`)}
          hint={t(`${K}.noteHelp`)}
          error={problem ? t(problem) : undefined}
        >
          <Textarea
            value={note}
            maxLength={600}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={save.isPending}
            onClick={onClose}
          >
            {t("admin.actions.cancel")}
          </Button>
          <Button type="submit" className="min-h-11" loading={save.isPending}>
            {save.isPending ? t(`${K}.submitting`) : t(`${K}.submit`)}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

/** Confirmar un pago a mano (se vio el dinero en el banco sin comprobante ni aviso). */
export function ConfirmManualDialog({
  payment,
  open,
  onOpenChange,
  onDone,
}: DialogBase & {
  payment: { id: string; reference: string; amount: number; currency: string } | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" onInteractOutside={(event) => event.preventDefault()}>
        {payment && (
          <ManualForm payment={payment} onDone={onDone} onClose={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ManualForm({
  payment,
  onDone,
  onClose,
}: {
  payment: { id: string; reference: string; amount: number; currency: string };
  onDone: (m: string) => void;
  onClose: () => void;
}) {
  const K = "admin.payments.detail.manual" as const;
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const save = usePaymentMutation((value: { amount: number | null; note: string | null }) =>
    confirmPaymentManually(payment.id, value.amount, value.note),
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending) return;
    setFormError(null);
    const parsed = validateReceived(amount);
    if (!parsed.ok) {
      setProblem(`admin.payments.review.approve.errors.${parsed.problem}` as MessageKey);
      return;
    }
    setProblem(null);
    try {
      const result = await save.mutateAsync({
        amount: parsed.value,
        note: note.trim() === "" ? null : note.trim(),
      });
      if (result.outcome === "applied") onDone(t(`${K}.done`));
      else if (result.outcome === "review") onDone(t(`${K}.doneReview`));
      else if (result.outcome === "duplicate") onDone(t(`${K}.duplicate`));
      else if (result.outcome === "already_paid") onDone(t(`${K}.alreadyPaid`));
      else onDone(t(`${K}.ignored`));
      onClose();
    } catch (error) {
      setFormError(toAppError(error).message);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t(`${K}.title`, { reference: payment.reference })}</DialogTitle>
        <DialogDescription>{t(`${K}.description`)}</DialogDescription>
      </DialogHeader>
      <form onSubmit={(event) => void submit(event)} noValidate className="grid gap-4">
        <FormError message={formError} />
        <Field
          label={t(`${K}.amountLabel`)}
          hint={t(`${K}.amountHelp`, { expected: formatMoney(payment.amount, payment.currency) })}
          error={problem ? t(problem) : undefined}
        >
          <Input
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </Field>
        <Field label={t(`${K}.noteLabel`)}>
          <Textarea
            value={note}
            maxLength={300}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={save.isPending}
            onClick={onClose}
          >
            {t("admin.actions.cancel")}
          </Button>
          <Button type="submit" className="min-h-11" loading={save.isPending}>
            {save.isPending ? t(`${K}.submitting`) : t(`${K}.submit`)}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
