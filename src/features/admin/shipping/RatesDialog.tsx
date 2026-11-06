import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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
import { Select } from "@/components/ui/select";
import { ConflictBanner } from "../ui/ConflictBanner";
import { isStaleVersion } from "../lib/versioned";
import { createRate, updateRate } from "./api";
import { useInvalidateShipping, useShippingMutation } from "./hooks";
import { RatesCheckbox } from "./RatesCheckbox";
import {
  defaultCurrency,
  initialRateValues,
  validateRate,
  type RateFormValues,
} from "./RatesFormLogic";
import { currencySymbol, rateZoneOptions, ruleZoneState } from "./RatesLogic";
import {
  amountProblemText,
  nameProblemText,
  numberProblemText,
  priorityProblemText,
  validUntilText,
} from "./RatesMessages";
import { TierEditor } from "./TierEditor";
import type { RateKind, RateRule, RateUpdateInput, ShippingMethod, ShippingZone } from "./types";

interface RatesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = tarifa nueva. */
  rule: RateRule | null;
  method: ShippingMethod;
  zones: readonly ShippingZone[];
  /** Monedas que se ofrecen al crear (las habilitadas). */
  currencies: readonly string[];
}

const F = "admin.shipping.rates.rules.form" as const;
const E = "admin.shipping.rates.rules.form.errors" as const;

function RateForm({
  rule,
  method,
  zones,
  currencies,
  onClose,
}: {
  rule: RateRule | null;
  method: ShippingMethod;
  zones: readonly ShippingZone[];
  currencies: readonly string[];
  onClose: () => void;
}) {
  const [values, setValues] = useState<RateFormValues>(() => initialRateValues(rule));
  const [currency, setCurrency] = useState(() => rule?.currency ?? defaultCurrency(currencies));
  const [submitted, setSubmitted] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const invalidate = useInvalidateShipping();

  const save = useShippingMutation(async (payload: RateUpdateInput) =>
    rule
      ? await updateRate(rule.id, rule.updatedAt, payload)
      : await createRate({ ...payload, methodId: method.id, currency }),
  );

  const zonesById = useMemo(() => new Map(zones.map((z) => [z.id, z])), [zones]);
  const zoneOptions = useMemo(() => rateZoneOptions(zones, rule?.zoneId ?? null), [zones, rule]);
  const zoneState = ruleZoneState(values.zoneId === "" ? null : values.zoneId, zonesById);
  const symbol = currencySymbol(currency);

  const validation = validateRate(values);
  const errors = submitted && !validation.ok ? validation.errors : {};

  // Tras un guardado fallido el foco va al primer campo con problema.
  useEffect(() => {
    if (attempt > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [attempt]);

  const set = <K extends keyof RateFormValues>(key: K, value: RateFormValues[K]) =>
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
      await save.mutateAsync(validation.payload);
      toast.success(
        rule
          ? t("admin.shipping.rates.rules.toasts.updated")
          : t("admin.shipping.rates.rules.toasts.created"),
      );
      onClose();
    } catch (e) {
      if (isStaleVersion(e)) {
        setConflict(true);
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
      {rule && rule.params === null && (
        <p className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-warning">
          {t(`${F}.invalidParams`)}
        </p>
      )}

      <Field
        label={t(`${F}.name`)}
        hint={t(`${F}.nameHint`)}
        error={errors.name ? nameProblemText(errors.name) : undefined}
      >
        <Input
          className="min-h-11"
          autoComplete="off"
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
        />
      </Field>

      {rule ? (
        <p className="text-sm text-muted-foreground">
          {t(`${F}.kindFixed`, { kind: t(`admin.shipping.rates.rules.kind.${rule.kind}`) })}{" "}
          {t(`${F}.currencyFixed`, { currency: rule.currency })}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t(`${F}.kind`)} hint={t(`${F}.kindHint`)}>
            <Select
              className="min-h-11"
              value={values.kind}
              onChange={(e) => set("kind", e.target.value as RateKind)}
            >
              <option value="distance">{t("admin.shipping.rates.rules.kind.distance")}</option>
              <option value="flat">{t("admin.shipping.rates.rules.kind.flat")}</option>
            </Select>
          </Field>
          {currencies.length > 1 ? (
            <Field label={t(`${F}.currency`)} hint={t(`${F}.currencyHint`)}>
              <Select
                className="min-h-11"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {currencies.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <p className="self-center text-sm text-muted-foreground">
              {t(`${F}.currencyFixed`, { currency })}
            </p>
          )}
        </div>
      )}

      {values.kind === "distance" ? (
        <TierEditor
          draft={values.draft}
          onChange={(draft) => set("draft", draft)}
          errors={errors.distance ?? null}
          currency={currency}
        />
      ) : (
        <Field
          label={t(`${F}.flatCost`, { symbol })}
          hint={t(`${F}.flatHint`)}
          error={errors.flatCost ? numberProblemText(errors.flatCost, "cost") : undefined}
        >
          <Input
            className="min-h-11"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={values.flatCost}
            onChange={(e) => set("flatCost", e.target.value)}
          />
        </Field>
      )}

      <div className="space-y-1.5">
        <Field label={t(`${F}.zone`)} hint={t(`${F}.zoneHint`)}>
          <Select
            className="min-h-11"
            value={values.zoneId}
            onChange={(e) => set("zoneId", e.target.value)}
          >
            {zoneOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        {(zoneState === "archived" || zoneState === "inactive" || zoneState === "blocked") && (
          <p className="text-xs text-warning">{t("admin.shipping.rates.rules.zone.unusable")}</p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t(`${F}.minOrder`, { symbol })}
          error={errors.minOrder ? amountProblemText(errors.minOrder) : undefined}
        >
          <Input
            className="min-h-11"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={values.minOrder}
            onChange={(e) => set("minOrder", e.target.value)}
          />
        </Field>
        <Field
          label={t(`${F}.maxOrder`, { symbol })}
          error={
            errors.maxOrder
              ? amountProblemText(errors.maxOrder)
              : errors.orderRange
                ? t(`${E}.orderRange`)
                : undefined
          }
        >
          <Input
            className="min-h-11"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={values.maxOrder}
            onChange={(e) => set("maxOrder", e.target.value)}
          />
        </Field>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">{t(`${F}.orderHint`)}</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t(`${F}.validFrom`)}
          error={errors.validFrom ? t(`${E}.validFromInvalid`) : undefined}
        >
          <Input
            className="min-h-11"
            type="datetime-local"
            value={values.validFrom}
            onChange={(e) => set("validFrom", e.target.value)}
          />
        </Field>
        <Field
          label={t(`${F}.validUntil`)}
          error={errors.validUntil ? validUntilText(errors.validUntil) : undefined}
        >
          <Input
            className="min-h-11"
            type="datetime-local"
            value={values.validUntil}
            onChange={(e) => set("validUntil", e.target.value)}
          />
        </Field>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">{t(`${F}.validityHint`)}</p>

      <Field
        label={t(`${F}.priority`)}
        hint={t(`${F}.priorityHint`)}
        error={errors.priority ? priorityProblemText(errors.priority) : undefined}
      >
        <Input
          className="min-h-11"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={values.priority}
          onChange={(e) => set("priority", e.target.value)}
        />
      </Field>

      <RatesCheckbox
        label={t(`${F}.active`)}
        hint={t(`${F}.activeHint`)}
        checked={values.isActive}
        onChange={(checked) => set("isActive", checked)}
      />

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
          {save.isPending ? t(`${F}.submitting`) : t(`${F}.submit`)}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Diálogo de alta/edición de una tarifa. El formulario vive dentro del contenido: se reinicia cada vez que se abre. */
export function RatesDialog({
  open,
  onOpenChange,
  rule,
  method,
  zones,
  currencies,
}: RatesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl"
        // Un clic fuera (o sobre un aviso) no debe tirar a la basura lo escrito: se cierra con Cancelar, la X o Esc.
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{rule ? t(`${F}.editTitle`) : t(`${F}.createTitle`)}</DialogTitle>
          <DialogDescription>{t(`${F}.description`, { method: method.name })}</DialogDescription>
        </DialogHeader>
        <RateForm
          rule={rule}
          method={method}
          zones={zones}
          currencies={currencies}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
