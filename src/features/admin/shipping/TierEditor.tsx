import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { currencySymbol, ruleSummary } from "./RatesLogic";
import { distanceListText, numberProblemText, tierUpToText } from "./RatesMessages";
import {
  MAX_TIERS,
  validateDistanceDraft,
  type DistanceDraft,
  type DistanceDraftErrors,
} from "./tierLogic";

interface TierEditorProps {
  draft: DistanceDraft;
  onChange: (draft: DistanceDraft) => void;
  /** Los problemas que se muestran junto a cada campo; null = todavía no se intentó guardar. */
  errors: DistanceDraftErrors | null;
  currency: string;
}

const inputClass = "min-h-11";

/**
 * Editor de tramos de una tarifa por distancia: filas «hasta X km → costo», costo por km adicional, mínimo y máximo. Los
 * textos son del usuario (se aceptan «2,5» y «2.5»); la validación y los parámetros que se envían son de `tierLogic`.
 */
export function TierEditor({ draft, onChange, errors, currency }: TierEditorProps) {
  const ids = useId();
  const symbol = currencySymbol(currency);
  const addRef = useRef<HTMLButtonElement>(null);
  const upToRefs = useRef<(HTMLInputElement | null)[]>([]);
  const pendingFocus = useRef<"add" | number | null>(null);
  const [announcement, setAnnouncement] = useState("");

  // Tras añadir una fila el foco va a su primer campo; tras quitar una, al botón «Añadir tramo» (la fila ya no existe).
  useEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    pendingFocus.current = null;
    if (target === "add") addRef.current?.focus();
    else upToRefs.current[target]?.focus();
  });

  const preview = useMemo(() => validateDistanceDraft(draft).params, [draft]);
  const count = draft.tiers.length;
  const atMax = count >= MAX_TIERS;

  const setRow = (index: number, key: "upTo" | "cost", value: string) =>
    onChange({
      ...draft,
      tiers: draft.tiers.map((row, i) => (i === index ? { ...row, [key]: value } : row)),
    });
  const addRow = () => {
    if (atMax) return;
    pendingFocus.current = count;
    setAnnouncement(t("admin.shipping.rates.tiers.added", { n: count + 1 }));
    onChange({ ...draft, tiers: [...draft.tiers, { upTo: "", cost: "" }] });
  };
  const removeRow = (index: number) => {
    pendingFocus.current = "add";
    setAnnouncement(t("admin.shipping.rates.tiers.removed", { n: index + 1 }));
    onChange({ ...draft, tiers: draft.tiers.filter((_, i) => i !== index) });
  };
  const setField = (key: "extraPerKm" | "minCost" | "maxCost", value: string) =>
    onChange({ ...draft, [key]: value });

  const hintId = `${ids}-hint`;
  const listErrorId = `${ids}-list-error`;
  const maxCostError = errors?.maxCost
    ? numberProblemText(errors.maxCost, "cost")
    : errors?.range
      ? t("admin.shipping.rates.tiers.errors.minGtMax")
      : undefined;

  return (
    <fieldset
      className="space-y-4 rounded-md border p-3 sm:p-4"
      aria-describedby={[hintId, errors?.list ? listErrorId : null].filter(Boolean).join(" ")}
    >
      <legend className="px-1 text-sm font-semibold">
        {t("admin.shipping.rates.tiers.legend")}
      </legend>
      <p id={hintId} className="text-xs text-muted-foreground">
        {t("admin.shipping.rates.tiers.hint")}
      </p>
      {errors?.list && (
        <p id={listErrorId} role="alert" className="text-xs text-destructive">
          {distanceListText(errors.list)}
        </p>
      )}

      <ol className="space-y-3">
        {draft.tiers.map((row, i) => {
          const rowErrors = errors?.rows[i] ?? {};
          const labelId = `${ids}-row-${i}`;
          const upToId = `${ids}-up-${i}`;
          const costId = `${ids}-cost-${i}`;
          return (
            <li key={i}>
              <div role="group" aria-labelledby={labelId} className="space-y-1">
                <p id={labelId} className="text-xs font-medium text-muted-foreground">
                  {t("admin.shipping.rates.tiers.row", { n: i + 1 })}
                </p>
                <div className="grid grid-cols-[1fr_1fr_auto] items-start gap-2">
                  <div className="space-y-1">
                    <label htmlFor={upToId} className="text-sm font-medium">
                      {t("admin.shipping.rates.tiers.upTo")}
                    </label>
                    <Input
                      id={upToId}
                      ref={(el) => {
                        upToRefs.current[i] = el;
                      }}
                      className={inputClass}
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={row.upTo}
                      aria-invalid={rowErrors.upTo ? true : undefined}
                      aria-describedby={rowErrors.upTo ? `${upToId}-error` : undefined}
                      onChange={(e) => setRow(i, "upTo", e.target.value)}
                    />
                    {rowErrors.upTo && (
                      <p id={`${upToId}-error`} role="alert" className="text-xs text-destructive">
                        {tierUpToText(rowErrors.upTo)}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <label htmlFor={costId} className="text-sm font-medium">
                      {t("admin.shipping.rates.tiers.cost", { symbol })}
                    </label>
                    <Input
                      id={costId}
                      className={inputClass}
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={row.cost}
                      aria-invalid={rowErrors.cost ? true : undefined}
                      aria-describedby={rowErrors.cost ? `${costId}-error` : undefined}
                      onChange={(e) => setRow(i, "cost", e.target.value)}
                    />
                    {rowErrors.cost && (
                      <p id={`${costId}-error`} role="alert" className="text-xs text-destructive">
                        {numberProblemText(rowErrors.cost, "cost")}
                      </p>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="mt-6 min-h-11 min-w-11"
                    aria-label={t("admin.shipping.rates.tiers.remove", { n: i + 1 })}
                    onClick={() => removeRow(i)}
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          ref={addRef}
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={atMax}
          onClick={addRow}
        >
          {t("admin.shipping.rates.tiers.add")}
        </Button>
        <p className="text-xs text-muted-foreground">
          {atMax
            ? t("admin.shipping.rates.tiers.maxTiers", { max: MAX_TIERS })
            : t("admin.shipping.rates.tiers.count", { count, max: MAX_TIERS })}
        </p>
      </div>
      <p role="status" className="sr-only">
        {announcement}
      </p>

      <Field
        label={t("admin.shipping.rates.tiers.extra", { symbol })}
        hint={t("admin.shipping.rates.tiers.extraHint")}
        error={errors?.extraPerKm ? numberProblemText(errors.extraPerKm, "cost") : undefined}
      >
        <Input
          className={inputClass}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={draft.extraPerKm}
          onChange={(e) => setField("extraPerKm", e.target.value)}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t("admin.shipping.rates.tiers.minCost", { symbol })}
          error={errors?.minCost ? numberProblemText(errors.minCost, "cost") : undefined}
        >
          <Input
            className={inputClass}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={draft.minCost}
            onChange={(e) => setField("minCost", e.target.value)}
          />
        </Field>
        <Field label={t("admin.shipping.rates.tiers.maxCost", { symbol })} error={maxCostError}>
          <Input
            className={inputClass}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={draft.maxCost}
            onChange={(e) => setField("maxCost", e.target.value)}
          />
        </Field>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        {t("admin.shipping.rates.tiers.limitsHint")}
      </p>

      {preview && (
        <p className="rounded-md bg-muted/60 p-3 text-sm">
          {t("admin.shipping.rates.tiers.preview", {
            summary: ruleSummary(preview, currency, MAX_TIERS),
          })}
        </p>
      )}
    </fieldset>
  );
}
