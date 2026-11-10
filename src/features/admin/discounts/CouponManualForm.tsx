import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { t } from "@/i18n";
import { toAppError } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createCoupon } from "./api";
import { CouponFields } from "./CouponFields";
import {
  codeProblem,
  couponFieldErrors,
  emptyCouponForm,
  normalizeCode,
  validateCouponForm,
  type CouponFormValues,
  type CouponFormValue,
} from "./CouponsLogic";
import { useDiscountMutation } from "./hooks";
import type { Coupon, Discount } from "./types";

const M = "admin.discounts.coupons.manual" as const;
const F = "admin.discounts.coupons.fields" as const;

interface CouponManualFormProps {
  discount: Discount;
  /** Los códigos que ya tiene el descuento (archivados incluidos), para avisar de un duplicado antes de enviar. */
  existing: readonly Coupon[];
  /** Se creó el código. */
  onCreated: (code: string) => void;
  onClose: () => void;
}

/** Alta de UN código escrito a mano: formato y duplicado (ya normalizado) se avisan antes de enviar; la base tiene la última palabra. */
export function CouponManualForm({
  discount,
  existing,
  onCreated,
  onClose,
}: CouponManualFormProps) {
  const [values, setValues] = useState<CouponFormValues>(emptyCouponForm);
  const [submitted, setSubmitted] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  // Un duplicado que solo conoce la base (otro descuento) se muestra junto al campo del código, con su mensaje.
  const [serverCodeError, setServerCodeError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  const create = useDiscountMutation((value: CouponFormValue) =>
    createCoupon({ discountId: discount.id, ...value }),
  );

  const validation = validateCouponForm(values, { mode: "create", existing });
  const errors = submitted && !validation.ok ? validation.errors : {};
  const messages = couponFieldErrors(errors, !validation.ok ? validation.duplicateOf : undefined);

  // Al abrir el formulario el foco va al código; tras un envío fallido, al primer campo con problema.
  useEffect(() => {
    codeRef.current?.focus();
  }, []);
  useEffect(() => {
    if (attempt > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [attempt]);

  const set = <K extends keyof CouponFormValues>(key: K, value: CouponFormValues[K]) => {
    if (key === "code") setServerCodeError(null);
    setValues((v) => ({ ...v, [key]: value }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (create.isPending) return;
    setFormError(null);
    setServerCodeError(null);
    setSubmitted(true);
    if (!validation.ok) {
      setAttempt((n) => n + 1);
      return;
    }
    try {
      await create.mutateAsync(validation.value);
      onCreated(validation.value.code);
    } catch (e) {
      const error = toAppError(e);
      if (error.code === "conflict") {
        setServerCodeError(error.message);
        setAttempt((n) => n + 1);
      } else {
        setFormError(error.message);
      }
    }
  };

  const codeError = serverCodeError ?? messages.code;
  const preview = codeProblem(values.code) === null ? normalizeCode(values.code) : null;

  return (
    <form
      ref={formRef}
      onSubmit={(e) => void submit(e)}
      noValidate
      aria-labelledby={titleId}
      className="grid gap-4 rounded-lg border p-4"
    >
      <h3 id={titleId} className="font-display text-base font-semibold">
        {t(`${M}.title`)}
      </h3>
      {formError && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {formError}
        </p>
      )}
      <div className="space-y-1.5">
        <Field label={t(`${F}.code`)} hint={t(`${F}.codeHint`)} error={codeError}>
          <Input
            ref={codeRef}
            className="min-h-11 font-mono"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={values.code}
            onChange={(e) => set("code", e.target.value)}
          />
        </Field>
        {preview !== null && preview !== "" && !codeError && (
          <p className="text-xs text-muted-foreground">
            {t(`${F}.codeSameAs`, { normalized: preview })}
          </p>
        )}
      </div>
      <CouponFields values={values} errors={errors} onChange={(key, value) => set(key, value)} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={create.isPending}
          onClick={onClose}
        >
          {t(`${M}.close`)}
        </Button>
        <Button type="submit" className="min-h-11" loading={create.isPending}>
          {create.isPending ? t(`${M}.submitting`) : t(`${M}.submit`)}
        </Button>
      </div>
    </form>
  );
}
