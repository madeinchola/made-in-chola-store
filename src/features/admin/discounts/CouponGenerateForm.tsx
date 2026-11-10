import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { t } from "@/i18n";
import { toAppError } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { generateCouponCodes } from "./api";
import { CouponCopyButton } from "./CouponCopyButton";
import {
  couponsCsv,
  emptyGenerateForm,
  generateFieldErrors,
  validateGenerateForm,
  type GenerateFormValues,
  type GenerateParams,
} from "./CouponsLogic";
import { csvFileName, downloadCsv } from "./csv";
import { useDiscountMutation } from "./hooks";
import type { Discount } from "./types";

const G = "admin.discounts.coupons.generate" as const;
const R = "admin.discounts.coupons.result" as const;

interface CouponGenerateFormProps {
  discount: Discount;
  /** Se generaron códigos (para avisarlo y refrescar). */
  onGenerated: (count: number) => void;
  /** Un aviso para la región `role="status"` del diálogo (copiado, descargado…). */
  onStatus: (message: string, ok: boolean) => void;
  onClose: () => void;
}

interface Generated {
  codes: string[];
  usageLimit: number | null;
}

/**
 * Generador de códigos al azar (hasta 500 por vez). Muestra lo generado en una lista que se puede copiar y descargar: es la
 * única vez que se ven todos juntos, así que quedan a la vista hasta que se pulsa «Listo». Viven solo en la memoria de esta
 * pantalla (no se guardan en el navegador ni se registran).
 */
export function CouponGenerateForm({
  discount,
  onGenerated,
  onStatus,
  onClose,
}: CouponGenerateFormProps) {
  const [values, setValues] = useState<GenerateFormValues>(emptyGenerateForm);
  const [submitted, setSubmitted] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<Generated | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const countRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const singleUseId = useId();
  const singleUseHint = useId();

  const generate = useDiscountMutation((params: GenerateParams) =>
    generateCouponCodes({
      discountId: discount.id,
      count: params.count,
      prefix: params.prefix,
      length: params.length,
      usageLimit: params.usageLimit,
    }),
  );

  const validation = validateGenerateForm(values);
  const messages = generateFieldErrors(submitted && !validation.ok ? validation.errors : {});

  useEffect(() => {
    countRef.current?.focus();
  }, []);
  useEffect(() => {
    if (attempt > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [attempt]);
  // Al aparecer el resultado el foco va a su título: quien usa lector de pantalla oye cuántos códigos salieron.
  useEffect(() => {
    if (generated) resultRef.current?.focus();
  }, [generated]);

  const set = <K extends keyof GenerateFormValues>(key: K, value: GenerateFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (generate.isPending) return;
    setFormError(null);
    setSubmitted(true);
    if (!validation.ok) {
      setAttempt((n) => n + 1);
      return;
    }
    try {
      const codes = await generate.mutateAsync(validation.value);
      setGenerated({ codes, usageLimit: validation.value.usageLimit });
      onGenerated(codes.length);
    } catch (e) {
      setFormError(toAppError(e).message);
    }
  };

  const downloadGenerated = () => {
    if (!generated) return;
    downloadCsv(
      csvFileName(`codigos-${discount.name}`),
      couponsCsv(
        generated.codes.map((code) => ({
          code,
          usageLimit: generated.usageLimit,
          startsAt: null,
          endsAt: null,
        })),
      ),
    );
    onStatus(
      t("admin.discounts.coupons.toasts.downloaded", { count: generated.codes.length }),
      true,
    );
  };

  return (
    <section aria-labelledby={titleId} className="grid gap-4 rounded-lg border p-4">
      <div>
        <h3 id={titleId} className="font-display text-base font-semibold">
          {t(`${G}.title`)}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">{t(`${G}.description`)}</p>
      </div>
      <form ref={formRef} onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
        {formError && (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {formError}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t(`${G}.count`)} hint={t(`${G}.countHint`)} error={messages.count}>
            <Input
              ref={countRef}
              className="min-h-11"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={values.count}
              onChange={(e) => set("count", e.target.value)}
            />
          </Field>
          <Field label={t(`${G}.prefix`)} hint={t(`${G}.prefixHint`)} error={messages.prefix}>
            <Input
              className="min-h-11 font-mono"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={values.prefix}
              onChange={(e) => set("prefix", e.target.value)}
            />
          </Field>
          <Field label={t(`${G}.length`)} hint={t(`${G}.lengthHint`)} error={messages.length}>
            <Input
              className="min-h-11"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={values.length}
              onChange={(e) => set("length", e.target.value)}
            />
          </Field>
        </div>
        <div>
          <div className="flex min-h-11 items-center gap-2">
            <Checkbox
              id={singleUseId}
              checked={values.singleUse}
              aria-describedby={singleUseHint}
              onCheckedChange={(value) => set("singleUse", value === true)}
            />
            <label htmlFor={singleUseId} className="text-sm font-medium">
              {t(`${G}.singleUse`)}
            </label>
          </div>
          <p id={singleUseHint} className="text-xs text-muted-foreground">
            {t(`${G}.singleUseHint`)}
          </p>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={generate.isPending}
            onClick={onClose}
          >
            {t(`${G}.close`)}
          </Button>
          <Button type="submit" className="min-h-11" loading={generate.isPending}>
            {generate.isPending ? t(`${G}.submitting`) : t(`${G}.submit`)}
          </Button>
        </div>
      </form>

      {generated && (
        <div className="grid gap-3 rounded-md border bg-muted/40 p-3">
          <div>
            <h4 ref={resultRef} tabIndex={-1} className="text-sm font-semibold outline-none">
              {generated.codes.length === 1
                ? t(`${R}.titleOne`)
                : t(`${R}.titleMany`, { count: generated.codes.length })}
            </h4>
            <p className="text-xs text-muted-foreground">{t(`${R}.description`)}</p>
          </div>
          {/* Con 500 códigos la lista se desplaza dentro de su caja; con tabindex se puede recorrer con el teclado. */}
          <div
            role="region"
            aria-label={t(`${R}.listLabel`)}
            tabIndex={0}
            className="max-h-56 overflow-y-auto rounded-md border bg-background p-2"
          >
            <ul className="grid gap-1 sm:grid-cols-2">
              {generated.codes.map((code) => (
                <li key={code} className="break-all font-mono text-sm">
                  {code}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-wrap gap-2">
            <CouponCopyButton
              text={generated.codes.join("\n")}
              successMessage={t("admin.discounts.coupons.copy.many", {
                count: generated.codes.length,
              })}
              onResult={onStatus}
              className="border border-input"
            >
              {t(`${R}.copyAll`)}
            </CouponCopyButton>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11 border border-input"
              onClick={downloadGenerated}
            >
              {t(`${R}.downloadCsv`)}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11"
              onClick={() => setGenerated(null)}
            >
              {t(`${R}.done`)}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
