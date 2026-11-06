import { useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
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
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ConflictBanner } from "../ui/ConflictBanner";
import { isStaleVersion } from "../lib/versioned";
import { createBlockedDate, updateBlockedDateReason } from "./api";
import {
  isPastDate,
  validateBlockedForm,
  type BlockedFormErrors,
  type BlockedFormValues,
} from "./BlockedLogic";
import { useInvalidateShipping, useShippingMutation } from "./hooks";
import { formatShortDate } from "./SlotsDates";
import type { BlockedDate } from "./types";

/** Qué abre el diálogo: una fecha nueva o la edición del motivo de una existente. */
export type BlockedTarget = { kind: "create" } | { kind: "edit"; date: BlockedDate };

interface BlockedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: BlockedTarget;
  /** Todas las fechas (para no bloquear el mismo día dos veces). */
  existing: readonly BlockedDate[];
  /** Hoy en La Paz (AAAA-MM-DD), para avisar de una fecha pasada. */
  today: string;
}

const FIELD = "h-11";

function BlockedForm({
  target,
  existing,
  today,
  onClose,
}: Omit<BlockedDialogProps, "open" | "onOpenChange"> & { onClose: () => void }) {
  const editing = target.kind === "edit" ? target.date : null;
  const [values, setValues] = useState<BlockedFormValues>({
    blockedOn: editing?.blockedOn ?? "",
    reason: editing?.reason ?? "",
  });
  const [errors, setErrors] = useState<BlockedFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);

  const invalidate = useInvalidateShipping();
  const create = useShippingMutation((v: { blockedOn: string; reason: string | null }) =>
    createBlockedDate(v.blockedOn, v.reason),
  );
  const update = useShippingMutation((v: { date: BlockedDate; reason: string | null }) =>
    updateBlockedDateReason(v.date.id, v.date.updatedAt, v.reason),
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current) return;
    setFormError(null);
    setConflict(false);
    const result = validateBlockedForm(values, {
      mode: editing ? "edit" : "create",
      existing,
    });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    busy.current = true;
    setSaving(true);
    try {
      if (editing) await update.mutateAsync({ date: editing, reason: result.value.reason });
      else await create.mutateAsync(result.value);
      toast.success(
        editing
          ? t("admin.shipping.delivery.blocked.toasts.updated")
          : t("admin.shipping.delivery.blocked.toasts.created"),
      );
      onClose();
    } catch (e) {
      if (isStaleVersion(e)) setConflict(true);
      else setFormError(toAppError(e).message);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const showPastWarning = !editing && isPastDate(values.blockedOn, today);

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
      {conflict && (
        <ConflictBanner
          onReload={() => {
            onClose();
            void invalidate();
          }}
        />
      )}
      {formError && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {formError}
        </p>
      )}
      {editing ? (
        <p className="text-sm">
          <span className="font-medium">
            {t("admin.shipping.delivery.blocked.form.dateFixed", {
              date: formatShortDate(editing.blockedOn, { year: true }),
            })}
          </span>
          <span className="block text-xs text-muted-foreground">
            {t("admin.shipping.delivery.blocked.form.dateFixedHint")}
          </span>
        </p>
      ) : (
        <>
          <Field
            label={t("admin.shipping.delivery.blocked.form.date")}
            {...(errors.blockedOn
              ? { error: t(`admin.shipping.delivery.blocked.form.errors.${errors.blockedOn}`) }
              : {})}
          >
            <Input
              type="date"
              className={FIELD}
              value={values.blockedOn}
              onChange={(e) => setValues((v) => ({ ...v, blockedOn: e.target.value }))}
            />
          </Field>
          <div role="status">
            {showPastWarning && (
              <p className="rounded-md border border-warning/50 bg-warning-soft p-3 text-sm text-warning">
                {t("admin.shipping.delivery.blocked.form.pastWarning")}
              </p>
            )}
          </div>
        </>
      )}
      <Field
        label={t("admin.shipping.delivery.blocked.form.reason")}
        hint={t("admin.shipping.delivery.blocked.form.reasonHint")}
        {...(errors.reason
          ? { error: t(`admin.shipping.delivery.blocked.form.errors.${errors.reason}`) }
          : {})}
      >
        <Input
          type="text"
          autoComplete="off"
          className={FIELD}
          value={values.reason}
          onChange={(e) => setValues((v) => ({ ...v, reason: e.target.value }))}
        />
      </Field>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          className={FIELD}
          disabled={saving}
          onClick={onClose}
        >
          {t("admin.actions.cancel")}
        </Button>
        <Button type="submit" className={FIELD} loading={saving}>
          {saving
            ? t("admin.shipping.delivery.blocked.form.submitting")
            : t("admin.shipping.delivery.blocked.form.submit")}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Diálogo de alta de una fecha bloqueada o de edición de su motivo (la fecha no se cambia: se archiva y se crea otra). */
export function BlockedDialog({ open, onOpenChange, target, existing, today }: BlockedDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {target.kind === "edit"
              ? t("admin.shipping.delivery.blocked.form.editTitle")
              : t("admin.shipping.delivery.blocked.form.createTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("admin.shipping.delivery.blocked.form.description")}
          </DialogDescription>
        </DialogHeader>
        <BlockedForm
          target={target}
          existing={existing}
          today={today}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
