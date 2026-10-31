import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { t } from "@/i18n";
import { formatDateTime, fromLaPazInputValue, toLaPazInputValue } from "@/lib/datetime";
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
import { LoadingState } from "../ui/StateViews";
import { createExchangeRate } from "./api";
import { useImpactCandidates } from "./hooks";
import {
  changePercentLabel,
  confirmationReasons,
  convertAmount,
  parseRate,
  type ConfirmReason,
  type RateProblem,
  type RateRow,
} from "./rates";
import type { CurrencyRow } from "./types";

interface RateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency: CurrencyRow | null;
  /** La tasa vigente de esta moneda (null = todavía no hay). */
  currentRate: RateRow | null;
  onSaved: () => void | Promise<void>;
}

const PROBLEM_KEY = {
  empty: "admin.config.currencies.rateDialog.errors.empty",
  format: "admin.config.currencies.rateDialog.errors.format",
  decimals: "admin.config.currencies.rateDialog.errors.decimals",
  too_large: "admin.config.currencies.rateDialog.errors.tooLarge",
  not_positive: "admin.config.currencies.rateDialog.errors.notPositive",
} as const satisfies Record<RateProblem, string>;

function ImpactPreview({
  currency,
  currentRate,
  nextRate,
  validFromIso,
}: {
  currency: CurrencyRow;
  currentRate: RateRow | null;
  /** Tasa nueva ya validada, o null si el texto aún no es válido. */
  nextRate: string | null;
  validFromIso: string | null;
}) {
  const impact = useImpactCandidates(currency.code);
  const startsLater = validFromIso !== null && new Date(validFromIso).getTime() > Date.now();

  return (
    <section aria-labelledby="impact-title" className="rounded-md border p-3">
      <h3 id="impact-title" className="text-sm font-semibold">
        {t("admin.config.currencies.impact.title")}
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("admin.config.currencies.impact.intro")}
      </p>
      {startsLater && validFromIso && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("admin.config.currencies.impact.future", { date: formatDateTime(validFromIso) })}
        </p>
      )}
      {impact.isPending ? (
        <LoadingState />
      ) : impact.isError ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {t("admin.config.currencies.impact.error")}
        </p>
      ) : impact.data.products.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {t("admin.config.currencies.impact.none", { code: currency.code })}
        </p>
      ) : nextRate === null ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {t("admin.config.currencies.impact.invalidRate")}
        </p>
      ) : (
        <>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{t("admin.config.currencies.impact.title")}</caption>
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th scope="col" className="pb-1 pr-3 font-medium">
                    {t("admin.config.currencies.impact.columns.product")}
                  </th>
                  <th scope="col" className="pb-1 pr-3 text-right font-medium">
                    {t("admin.config.currencies.impact.columns.bob")}
                  </th>
                  <th scope="col" className="pb-1 pr-3 text-right font-medium">
                    {t("admin.config.currencies.impact.columns.current")}
                  </th>
                  <th scope="col" className="pb-1 text-right font-medium">
                    {t("admin.config.currencies.impact.columns.next")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {impact.data.products.map((p) => (
                  <tr key={p.id} className="border-t">
                    <th scope="row" className="py-1 pr-3 font-normal">
                      {p.name}
                    </th>
                    <td className="py-1 pr-3 text-right">{p.priceBob}</td>
                    <td className="py-1 pr-3 text-right">
                      {currentRate
                        ? `${convertAmount(p.priceBob, currentRate.rate, currency.decimals)} ${currency.code}`
                        : t("admin.config.currencies.impact.noCurrent")}
                    </td>
                    <td className="py-1 text-right font-medium">
                      {`${convertAmount(p.priceBob, nextRate, currency.decimals)} ${currency.code}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {impact.data.truncated
              ? t("admin.config.currencies.impact.showingAtLeast", {
                  shown: impact.data.products.length,
                  total: impact.data.total,
                })
              : t("admin.config.currencies.impact.showing", {
                  shown: impact.data.products.length,
                  total: impact.data.total,
                })}
          </p>
        </>
      )}
    </section>
  );
}

function RateForm({
  currency,
  currentRate,
  onClose,
  onSaved,
}: {
  currency: CurrencyRow;
  currentRate: RateRow | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [rate, setRate] = useState("");
  const [mode, setMode] = useState<"fixed" | "variable">("fixed");
  // Por defecto rige desde ahora (hora de La Paz, a la precisión del campo).
  const [validFrom, setValidFrom] = useState(() => toLaPazInputValue(new Date().toISOString()));
  const [rateError, setRateError] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<{
    reasons: ConfirmReason[];
    rate: string;
    validFrom: string | null;
  } | null>(null);

  const parsed = useMemo(() => parseRate(rate), [rate]);
  const validFromIso = useMemo(() => {
    try {
      return fromLaPazInputValue(validFrom);
    } catch {
      return null;
    }
  }, [validFrom]);

  const save = async (value: string, iso: string | null) => {
    setSaving(true);
    setFormError(null);
    try {
      await createExchangeRate({ toCurrency: currency.code, rate: value, mode, validFrom: iso });
      toast.success(t("admin.config.currencies.rateDialog.saved"));
      await onSaved();
      onClose();
    } catch (e) {
      setPending(null);
      setFormError(toAppError(e).message);
    } finally {
      setSaving(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setFormError(null);
    let ok = true;
    if (!parsed.ok) {
      setRateError(t(PROBLEM_KEY[parsed.problem]));
      ok = false;
    } else setRateError(null);
    let iso: string | null = null;
    try {
      iso = fromLaPazInputValue(validFrom);
      setDateError(null);
    } catch {
      setDateError(t("admin.config.currencies.rateDialog.errors.date"));
      ok = false;
    }
    if (!ok || !parsed.ok) return;

    const reasons = confirmationReasons({
      previousRate: currentRate?.rate ?? null,
      nextRate: parsed.value,
      validFrom: iso,
      now: new Date(),
    });
    if (reasons.length > 0) setPending({ reasons, rate: parsed.value, validFrom: iso });
    else await save(parsed.value, iso);
  };

  return (
    <>
      <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
        {formError && (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {formError}
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          {currentRate
            ? t("admin.config.currencies.rateDialog.current", {
                rate: currentRate.rate,
                date: formatDateTime(currentRate.validFrom),
              })
            : t("admin.config.currencies.rateDialog.noCurrent")}
        </p>
        {!currency.enabled && (
          <p className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-warning">
            {t("admin.config.currencies.rateDialog.disabledWarning", { name: currency.name })}
          </p>
        )}
        <Field
          label={t("admin.config.currencies.rateDialog.rate", { code: currency.code })}
          hint={t("admin.config.currencies.rateDialog.rateHint")}
          {...(rateError ? { error: rateError } : {})}
        >
          <Input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("admin.config.currencies.rateDialog.mode")}>
            <Select
              value={mode}
              onChange={(e) => setMode(e.target.value === "variable" ? "variable" : "fixed")}
            >
              <option value="fixed">{t("admin.config.currencies.rateDialog.modes.fixed")}</option>
              <option value="variable">
                {t("admin.config.currencies.rateDialog.modes.variable")}
              </option>
            </Select>
          </Field>
          <Field
            label={t("admin.config.currencies.rateDialog.validFrom")}
            hint={t("admin.config.currencies.rateDialog.validFromHint")}
            {...(dateError ? { error: dateError } : {})}
          >
            <Input
              type="datetime-local"
              value={validFrom}
              onChange={(e) => setValidFrom(e.target.value)}
            />
          </Field>
        </div>

        <ImpactPreview
          currency={currency}
          currentRate={currentRate}
          nextRate={parsed.ok ? parsed.value : null}
          validFromIso={validFromIso}
        />

        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
            {t("admin.actions.cancel")}
          </Button>
          <Button type="submit" disabled={saving}>
            {saving
              ? t("admin.config.currencies.rateDialog.submitting")
              : t("admin.config.currencies.rateDialog.submit")}
          </Button>
        </DialogFooter>
      </form>

      <Dialog open={pending !== null} onOpenChange={(open) => !open && !saving && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.config.currencies.confirm.title")}</DialogTitle>
            <DialogDescription>{t("admin.config.currencies.confirm.body")}</DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-2 pl-5 text-sm">
            {pending?.reasons.includes("big_change") && currentRate && (
              <li>
                {t("admin.config.currencies.confirm.bigChange", {
                  percent: changePercentLabel(currentRate.rate, pending.rate),
                  previous: currentRate.rate,
                })}
              </li>
            )}
            {pending?.reasons.includes("far_date") && pending.validFrom && (
              <li>
                {t("admin.config.currencies.confirm.farDate", {
                  date: formatDateTime(pending.validFrom),
                })}
              </li>
            )}
          </ul>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => setPending(null)}
            >
              {t("admin.config.currencies.confirm.back")}
            </Button>
            <Button
              type="button"
              disabled={saving}
              onClick={() => pending && void save(pending.rate, pending.validFrom)}
            >
              {t("admin.config.currencies.confirm.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Diálogo de "Nuevo tipo de cambio": el formulario vive dentro del contenido y se reinicia cada vez que se abre. */
export function RateDialog({
  open,
  onOpenChange,
  currency,
  currentRate,
  onSaved,
}: RateDialogProps) {
  return (
    <Dialog open={open && currency !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        {currency && (
          <>
            <DialogHeader>
              <DialogTitle>
                {t("admin.config.currencies.rateDialog.title", { code: currency.code })}
              </DialogTitle>
              <DialogDescription>
                {t("admin.config.currencies.rateDialog.intro", { code: currency.code })}
              </DialogDescription>
            </DialogHeader>
            <RateForm
              key={currency.code}
              currency={currency}
              currentRate={currentRate}
              onClose={() => onOpenChange(false)}
              onSaved={onSaved}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
