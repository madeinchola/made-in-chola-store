import { useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { couponFieldErrors, type CouponFormErrors, type CouponFormValues } from "./CouponsLogic";

const F = "admin.discounts.coupons.fields" as const;

interface CouponFieldsProps {
  values: CouponFormValues;
  errors: CouponFormErrors;
  onChange: <K extends keyof CouponFormValues>(key: K, value: CouponFormValues[K]) => void;
}

/** Vigencia propia, tope de usos y «encendido» de un código: lo comparten el alta a mano y la edición. */
export function CouponFields({ values, errors, onChange }: CouponFieldsProps) {
  const messages = couponFieldErrors(errors);
  const activeId = useId();
  const hintId = useId();
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t(`${F}.startsAt`)} error={messages.startsAt}>
          <Input
            className="min-h-11"
            type="datetime-local"
            value={values.startsAt}
            onChange={(e) => onChange("startsAt", e.target.value)}
          />
        </Field>
        <Field label={t(`${F}.endsAt`)} error={messages.endsAt}>
          <Input
            className="min-h-11"
            type="datetime-local"
            value={values.endsAt}
            onChange={(e) => onChange("endsAt", e.target.value)}
          />
        </Field>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">{t(`${F}.windowHint`)}</p>
      <Field
        label={t(`${F}.usageLimit`)}
        hint={t(`${F}.usageLimitHint`)}
        error={messages.usageLimit}
      >
        <Input
          className="min-h-11"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={values.usageLimit}
          onChange={(e) => onChange("usageLimit", e.target.value)}
        />
      </Field>
      <div>
        <div className="flex min-h-11 items-center gap-2">
          <Checkbox
            id={activeId}
            checked={values.isActive}
            aria-describedby={hintId}
            onCheckedChange={(value) => onChange("isActive", value === true)}
          />
          <label htmlFor={activeId} className="text-sm font-medium">
            {t(`${F}.isActive`)}
          </label>
        </div>
        <p id={hintId} className="text-xs text-muted-foreground">
          {t(`${F}.isActiveHint`)}
        </p>
      </div>
    </>
  );
}
