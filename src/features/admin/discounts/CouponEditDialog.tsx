import { useEffect, useRef, useState, type FormEvent } from "react";
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
import { ConflictBanner } from "../ui/ConflictBanner";
import { isStaleVersion } from "../lib/versioned";
import { updateCoupon } from "./api";
import { CouponFields } from "./CouponFields";
import {
  couponFormFrom,
  validateCouponForm,
  type CouponFormValue,
  type CouponFormValues,
} from "./CouponsLogic";
import { useDiscountMutation, useInvalidateDiscounts } from "./hooks";
import type { Coupon } from "./types";

const E = "admin.discounts.coupons.edit" as const;

interface CouponEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  coupon: Coupon | null;
  /** Se guardó (para avisarlo en la región de estado del diálogo de códigos). */
  onSaved: (message: string) => void;
}

function CouponEditForm({
  coupon,
  onSaved,
  onClose,
}: {
  coupon: Coupon;
  onSaved: (message: string) => void;
  onClose: () => void;
}) {
  const [values, setValues] = useState<CouponFormValues>(() => couponFormFrom(coupon));
  const [submitted, setSubmitted] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const invalidate = useInvalidateDiscounts();

  const save = useDiscountMutation((value: CouponFormValue) =>
    updateCoupon(coupon.id, coupon.updatedAt, {
      isActive: value.isActive,
      startsAt: value.startsAt,
      endsAt: value.endsAt,
      usageLimit: value.usageLimit,
    }),
  );

  const validation = validateCouponForm(values, { mode: "edit", existing: [] });
  const errors = submitted && !validation.ok ? validation.errors : {};

  useEffect(() => {
    if (attempt > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [attempt]);

  const set = <K extends keyof CouponFormValues>(key: K, value: CouponFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (save.isPending) return;
    setFormError(null);
    setSubmitted(true);
    if (!validation.ok) {
      setAttempt((n) => n + 1);
      return;
    }
    try {
      await save.mutateAsync(validation.value);
      onSaved(t("admin.discounts.coupons.toasts.updated"));
      onClose();
    } catch (e) {
      if (isStaleVersion(e)) {
        setConflict(true);
        // La lista de detrás se refresca: al recargar ya muestra la versión de la otra persona.
        void invalidate();
      } else {
        setFormError(toAppError(e).message);
      }
    }
  };

  return (
    <form ref={formRef} onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
      {conflict && (
        <ConflictBanner
          onReload={() => {
            void invalidate();
            onClose();
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
      <CouponFields values={values} errors={errors} onChange={(key, value) => set(key, value)} />
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
        <Button type="submit" className="min-h-11" loading={save.isPending} disabled={conflict}>
          {save.isPending ? t(`${E}.submitting`) : t(`${E}.submit`)}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Cambia la vigencia, el tope de usos y el «encendido» de un código (el código en sí no se cambia). */
export function CouponEditDialog({ open, onOpenChange, coupon, onSaved }: CouponEditDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-xl"
        // Un clic fuera no debe tirar a la basura lo escrito: se cierra con Cancelar, la X o Esc.
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="break-all">
            {t(`${E}.title`, { code: coupon?.code ?? "" })}
          </DialogTitle>
          <DialogDescription>{t(`${E}.description`)}</DialogDescription>
        </DialogHeader>
        {coupon && (
          <CouponEditForm coupon={coupon} onSaved={onSaved} onClose={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}
