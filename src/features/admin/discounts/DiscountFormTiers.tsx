import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  emptyTier,
  MAX_TIERS,
  problemText,
  type DiscountErrors,
  type TierDraft,
} from "./discountForm";

interface TiersEditorProps {
  tiers: readonly TierDraft[];
  onChange: (tiers: TierDraft[]) => void;
  errors: DiscountErrors["tiers"] | undefined;
}

const W = "admin.discounts.wizard.tiers" as const;

/** Editor de tramos del descuento por volumen: «desde N unidades, P % de descuento», de 1 a 10 tramos. */
export function VolumeTiersEditor({ tiers, onChange, errors }: TiersEditorProps) {
  const update = (index: number, patch: Partial<TierDraft>) =>
    onChange(tiers.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">{t(`${W}.legend`)}</legend>
      <p className="text-xs text-muted-foreground">{t(`${W}.hint`)}</p>
      {errors?.list && (
        <p role="alert" className="text-xs text-destructive">
          {problemText("tiers", errors.list)}
        </p>
      )}
      {tiers.map((row, index) => {
        const rowErrors = errors?.rows[index];
        return (
          <fieldset
            key={index}
            className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_1fr_auto]"
          >
            <legend className="px-1 text-xs font-medium">{t(`${W}.tier`, { n: index + 1 })}</legend>
            <Field
              label={t(`${W}.minQty`)}
              error={rowErrors?.minQty ? problemText("tierQty", rowErrors.minQty) : undefined}
            >
              <Input
                className="min-h-11"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={row.minQty}
                onChange={(e) => update(index, { minQty: e.target.value })}
              />
            </Field>
            <Field
              label={t(`${W}.percent`)}
              error={rowErrors?.percent ? problemText("percent", rowErrors.percent) : undefined}
            >
              <Input
                className="min-h-11"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={row.percent}
                onChange={(e) => update(index, { percent: e.target.value })}
              />
            </Field>
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 self-end"
              disabled={tiers.length <= 1}
              aria-label={t(`${W}.remove`, { n: index + 1 })}
              onClick={() => onChange(tiers.filter((_, i) => i !== index))}
            >
              {t("admin.actions.remove")}
            </Button>
          </fieldset>
        );
      })}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={tiers.length >= MAX_TIERS}
          onClick={() => onChange([...tiers, emptyTier()])}
        >
          {t(`${W}.add`)}
        </Button>
        <span className="text-xs text-muted-foreground">
          {t(`${W}.count`, { count: tiers.length, max: MAX_TIERS })}
        </span>
      </div>
    </fieldset>
  );
}
