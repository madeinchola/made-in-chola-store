import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { CURRENCIES } from "@/lib/currencies";
import { amountToInput } from "../../lib/amount";
import { isStaleVersion } from "../../lib/versioned";
import { SectionCard } from "../../ui/PageHeader";
import { savePrices, type PriceChange } from "../api";
import { computePriceChanges, type PriceRowInfo } from "./priceChanges";
import { useEnabledCurrencies } from "../hooks";
import type { AdminPrice } from "../types";
import type { SectionProps } from "./types";

const generalPrices = (prices: readonly AdminPrice[]) =>
  Object.fromEntries(
    prices.filter((p) => p.country === null).map((p) => [p.currency, amountToInput(p.amount)]),
  );

/** Precios generales por moneda. Dejar vacío quita el precio de esa moneda. */
export function PricesSection({ detail, onChanged, onError, onDirtyChange }: SectionProps) {
  const currencies = useEnabledCurrencies();
  const saved = useMemo(() => generalPrices(detail.prices), [detail.prices]);
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const versionKey = detail.prices.map((p) => `${p.id}:${p.updatedAt}`).join("|");
  useEffect(() => {
    setEdited({});
    setErrors({});
  }, [versionKey]);

  const rows: PriceRowInfo[] = useMemo(() => {
    const enabled = currencies.data ?? [];
    const priced = detail.prices.filter((p) => p.country === null).map((p) => p.currency);
    const codes = [...new Set(["BOB", ...enabled.map((c) => c.code), ...priced])];
    return codes.flatMap((code) => {
      const info = enabled.find((c) => c.code === code) ?? CURRENCIES.find((c) => c.code === code);
      return info ? [{ code, name: info.name, symbol: info.symbol, decimals: info.decimals }] : [];
    });
  }, [currencies.data, detail.prices]);

  const published = detail.product.status === "active" && !detail.product.archived;
  const { changes } = computePriceChanges(rows, saved, edited, { published });
  const dirty = Object.keys(edited).some(
    (code) => (edited[code] ?? "").trim() !== (saved[code] ?? "").trim(),
  );
  useEffect(() => onDirtyChange("prices", dirty), [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange("prices", false), [onDirtyChange]);

  const save = useMutation({
    mutationFn: (list: PriceChange[]) => savePrices(detail.product.id, detail.prices, list),
    onSuccess: async () => {
      toast.success(t("admin.products.prices.saved"));
      await onChanged();
    },
    onError: async (e) => {
      if (!isStaleVersion(e))
        toast.error(t("admin.products.errors.unexpected"), {
          description: e instanceof Error ? e.message : "",
        });
      onError(e);
      // el guardado va precio por precio: los que sí se guardaron ya tienen otra versión; sin refrescar, reintentar
      // daría un falso conflicto
      await onChanged();
    },
  });

  const submit = () => {
    const result = computePriceChanges(rows, saved, edited, { published });
    setErrors(result.errors);
    if (Object.keys(result.errors).length > 0 || result.changes.length === 0) return;
    save.mutate(result.changes);
  };

  return (
    <SectionCard
      id="sec-prices"
      title={t("admin.products.edit.sections.prices")}
      description={t("admin.products.prices.intro")}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {rows.map((row) => (
          <Field
            key={row.code}
            label={
              row.code === "BOB"
                ? t("admin.products.prices.base", { currency: row.name, symbol: row.symbol })
                : t("admin.products.prices.optionalCurrency", { currency: row.name })
            }
            error={errors[row.code]}
            hint={
              row.code === "BOB"
                ? t("admin.products.prices.baseRequired")
                : t("admin.products.prices.removeHint")
            }
          >
            <Input
              inputMode="decimal"
              autoComplete="off"
              value={edited[row.code] ?? saved[row.code] ?? ""}
              onChange={(e) => setEdited((cur) => ({ ...cur, [row.code]: e.target.value }))}
            />
          </Field>
        ))}
      </div>
      {rows.length === 1 && (
        <p className="mt-3 text-xs text-muted-foreground">{t("admin.products.prices.onlyBase")}</p>
      )}
      <Button
        type="button"
        className="mt-4"
        disabled={save.isPending || (changes.length === 0 && !dirty)}
        onClick={submit}
      >
        {save.isPending ? t("admin.actions.saving") : t("admin.products.prices.save")}
      </Button>
    </SectionCard>
  );
}
