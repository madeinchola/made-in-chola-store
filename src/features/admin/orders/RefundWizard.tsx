import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { t, type MessageKey } from "@/i18n";
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
import { Textarea } from "@/components/ui/textarea";
import { refundOrder, type RefundArgs } from "./api";
import { useOrderMutation, useRefunds } from "./hooks";
import { errorText, formatMoney, newKey, parseOptionalMoney, validateText } from "./logic";
import { REFUND_OK, resultCode, succeeded } from "./outcomes";
import type { OrderDetail, RpcResult } from "./types";

const W = "admin.orders.refund.wizard" as const;

type Mode = "all" | "items" | "amount";
export interface RefundPreset {
  /** Cancelar el pedido además de devolver (el asistente de «Cancelar y reembolsar»). */
  cancel: boolean;
  mode: Mode;
  returnId?: string | null;
  /** Unidades de cada línea ya elegidas (p. ej. las de una devolución). */
  qty?: Record<string, number>;
}

interface Props {
  order: OrderDetail | null;
  preset: RefundPreset | null;
  onOpenChange: (open: boolean) => void;
  onDone: (message: string) => void;
}

/**
 * Asistente de «cancelar y reembolsar» / «reembolsar»: cuánto, por qué y a dónde, con el resumen del IMPACTO (dinero, stock,
 * cupón) calculado por la base antes de confirmar. La vista previa y la aplicación son la MISMA cuenta (`p_dry_run`). La llave
 * de idempotencia nace al abrir el asistente y cambia si cambia lo que se pide: un doble clic nunca devuelve dos veces.
 */
export function RefundWizard({ order, preset, onOpenChange, onDone }: Props) {
  return (
    <Dialog open={order !== null && preset !== null} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] max-w-2xl overflow-y-auto"
        onInteractOutside={(event) => event.preventDefault()}
      >
        {order && preset && (
          <WizardBody
            order={order}
            preset={preset}
            onDone={onDone}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function WizardBody({
  order,
  preset,
  onDone,
  onClose,
}: {
  order: OrderDetail;
  preset: RefundPreset;
  onDone: (m: string) => void;
  onClose: () => void;
}) {
  const refunds = useRefunds(order.id);
  const [mode, setMode] = useState<Mode>(preset.mode);
  const [qty, setQty] = useState<Record<string, string>>(
    Object.fromEntries(order.items.map((i) => [i.id, String(preset.qty?.[i.id] ?? 0)])),
  );
  const [ship, setShip] = useState(false);
  const [deduction, setDeduction] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState("bank_transfer");
  const [destination, setDestination] = useState("");
  const [processed, setProcessed] = useState(false);
  const [externalRef, setExternalRef] = useState("");
  const [preview, setPreview] = useState<RpcResult | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const keyRef = useRef(newKey("rf"));
  const run = useOrderMutation((args: RefundArgs) => refundOrder(args));

  const items = order.items
    .map((i) => ({ item_id: i.id, qty: Number.parseInt(qty[i.id] ?? "0", 10) || 0 }))
    .filter((i) => i.qty > 0);

  function buildArgs(dryRun: boolean): { args: RefundArgs } | { error: Record<string, string> } {
    const errors: Record<string, string> = {};
    const ded = parseOptionalMoney(deduction, true);
    if (!ded.ok) errors.deduction = t(`admin.orders.errors.money_${ded.problem}`);
    const amt = parseOptionalMoney(amount);
    if (mode === "amount" && (!amt.ok || amt.value === null))
      errors.amount = t("admin.orders.errors.money_format");
    const why = validateText(reason, 300);
    if (!why.ok)
      errors.reason = t(`${W}.reason${why.problem === "required" ? "Required" : "TooLong"}`);
    if (mode === "items" && items.length === 0 && !ship) errors.items = t(`${W}.itemsRequired`);
    if (Object.keys(errors).length > 0) return { error: errors };
    return {
      args: {
        orderId: order.id,
        key: keyRef.current,
        mode,
        items: mode === "items" ? items : null,
        includeShipping: mode === "items" && ship,
        deduction: ded.ok ? (ded.value ?? 0) : 0,
        amount: mode === "amount" && amt.ok ? amt.value : null,
        reason: why.ok ? why.value : "",
        method,
        destination: destination.trim() === "" ? null : destination.trim().slice(0, 300),
        externalRef: externalRef.trim() === "" ? null : externalRef.trim().slice(0, 120),
        returnId: preset.returnId ?? null,
        cancel: preset.cancel,
        markProcessed: processed,
        dryRun,
      },
    };
  }

  // Cualquier cambio invalida la vista previa y la llave (un reintento con otro contenido sería «idempotency_conflict»).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setPreview(null);
    keyRef.current = newKey("rf");
  }, [mode, qty, ship, deduction, amount, reason, method, destination, processed, externalRef]);

  async function calculate() {
    if (run.isPending) return;
    setFormError(null);
    const built = buildArgs(true);
    if ("error" in built) {
      setProblems(built.error);
      return;
    }
    setProblems({});
    try {
      const result = await run.mutateAsync(built.args);
      setPreview(result);
      if (result.outcome === "rejected")
        setFormError(
          errorText(resultCode(((result.refund as RpcResult | undefined) ?? result) as RpcResult)),
        );
    } catch (error) {
      setFormError(toAppError(error).message);
    }
  }

  async function confirm() {
    if (run.isPending) return;
    setFormError(null);
    const built = buildArgs(false);
    if ("error" in built) {
      setProblems(built.error);
      return;
    }
    try {
      const result = await run.mutateAsync(built.args);
      if (succeeded(result, REFUND_OK)) {
        const message = t(`${W}.done.${result.outcome as string}` as MessageKey);
        onDone(message);
        toast.success(message);
        onClose();
      } else {
        const nested = (result.refund as RpcResult | undefined)?.errors
          ? (result.refund as RpcResult)
          : result;
        setFormError(errorText(resultCode(nested)));
      }
    } catch (error) {
      setFormError(toAppError(error).message);
    }
  }

  const refund = (preview?.refund ?? null) as
    | (RpcResult & {
        amount?: number;
        left?: number;
        paid?: number;
        left_after?: number;
        warnings?: { code: string }[];
        lines?: { item_id: string; name: string; qty: number; amount: number }[];
        shipping_amount?: number;
      })
    | null;
  const restock = (preview?.restock ?? []) as { name: string; qty: number }[];
  const cur = order.currency;
  const refundedBefore = (refunds.data ?? [])
    .filter((r) => r.status !== "rejected")
    .reduce((s, r) => s + r.amount, 0);

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {t(preset.cancel ? `${W}.titleCancel` : `${W}.titleRefund`, { number: order.number })}
        </DialogTitle>
        <DialogDescription>
          {t(preset.cancel ? `${W}.descriptionCancel` : `${W}.descriptionRefund`)}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4">
        {formError && (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {formError}
          </p>
        )}

        {!preset.cancel && (
          <Field label={t(`${W}.mode`)}>
            <Select value={mode} onChange={(event) => setMode(event.target.value as Mode)}>
              <option value="items">{t(`${W}.modes.items`)}</option>
              <option value="amount">{t(`${W}.modes.amount`)}</option>
              <option value="all">{t(`${W}.modes.all`)}</option>
            </Select>
          </Field>
        )}

        {mode === "items" && (
          <fieldset className="space-y-2 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">{t(`${W}.itemsLegend`)}</legend>
            {order.items.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="min-w-0 flex-1">
                  {i.name} <span className="text-muted-foreground">× {i.qty}</span>
                </span>
                <label className="flex items-center gap-2">
                  <span className="sr-only">{t(`${W}.qtyFor`, { name: i.name })}</span>
                  <Input
                    inputMode="numeric"
                    className="w-20"
                    value={qty[i.id] ?? "0"}
                    onChange={(event) =>
                      setQty({ ...qty, [i.id]: event.target.value.replace(/\D/g, "").slice(0, 3) })
                    }
                  />
                </label>
              </div>
            ))}
            {order.shippingCost - order.shippingDiscount > 0 && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={ship}
                  onChange={(event) => setShip(event.target.checked)}
                />
                {t(`${W}.includeShipping`, {
                  amount: formatMoney(order.shippingCost - order.shippingDiscount, cur),
                })}
              </label>
            )}
            {problems.items && (
              <p role="alert" className="text-sm text-destructive">
                {problems.items}
              </p>
            )}
            <Field
              label={t(`${W}.deduction`)}
              hint={t(`${W}.deductionHint`)}
              error={problems.deduction}
            >
              <Input
                inputMode="decimal"
                value={deduction}
                onChange={(event) => setDeduction(event.target.value)}
              />
            </Field>
          </fieldset>
        )}

        {mode === "amount" && (
          <Field label={t(`${W}.amount`)} hint={t(`${W}.amountHint`)} error={problems.amount}>
            <Input
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </Field>
        )}

        <Field label={t(`${W}.reason`)} error={problems.reason}>
          <Textarea
            rows={2}
            maxLength={300}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t(`${W}.method`)}>
            <Select value={method} onChange={(event) => setMethod(event.target.value)}>
              {(["same_method", "bank_transfer", "cash", "other"] as const).map((m) => (
                <option key={m} value={m}>
                  {t(`${W}.methods.${m}` as MessageKey)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t(`${W}.destination`)} hint={t(`${W}.destinationHint`)}>
            <Input
              maxLength={300}
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
            />
          </Field>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t(`${W}.processedLegend`)}</legend>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="processed"
              className="mt-1 h-4 w-4"
              checked={processed}
              onChange={() => setProcessed(true)}
            />
            <span>{t(`${W}.processedYes`)}</span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="processed"
              className="mt-1 h-4 w-4"
              checked={!processed}
              onChange={() => setProcessed(false)}
            />
            <span>{t(`${W}.processedNo`)}</span>
          </label>
          {processed && (
            <Field label={t(`${W}.externalRef`)} hint={t(`${W}.externalRefHint`)}>
              <Input
                maxLength={120}
                value={externalRef}
                onChange={(event) => setExternalRef(event.target.value)}
              />
            </Field>
          )}
        </fieldset>

        <section
          aria-live="polite"
          aria-labelledby="impact-title"
          className="rounded-md border bg-muted/40 p-3 text-sm"
        >
          <h3 id="impact-title" className="font-medium">
            {t(`${W}.impact.title`)}
          </h3>
          {!preview ? (
            <p className="text-muted-foreground">{t(`${W}.impact.hint`)}</p>
          ) : preview.outcome === "rejected" ? (
            <p className="text-muted-foreground">{t(`${W}.impact.rejected`)}</p>
          ) : (
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {refund && typeof refund.amount === "number" ? (
                <li>
                  {t(`${W}.impact.money`, {
                    amount: formatMoney(refund.amount, cur),
                    paid: formatMoney(Number(refund.paid ?? 0), cur),
                    left: formatMoney(Number(refund.left_after ?? 0), cur),
                  })}
                </li>
              ) : (
                <li>{t(`${W}.impact.noMoney`)}</li>
              )}
              {(refund?.lines ?? []).map((l) => (
                <li key={l.item_id}>
                  {t(`${W}.impact.line`, {
                    name: l.name,
                    qty: l.qty,
                    amount: formatMoney(l.amount, cur),
                  })}
                </li>
              ))}
              {restock.length > 0 && (
                <li>
                  {t(`${W}.impact.stock`, {
                    list: restock.map((r) => `${r.name} × ${r.qty}`).join(", "),
                  })}
                </li>
              )}
              {preview.coupon_release === true && <li>{t(`${W}.impact.coupon`)}</li>}
              {typeof preview.status_after === "string" && (
                <li>
                  {t(`${W}.impact.status`, {
                    status: t(`admin.orders.status.${preview.status_after}` as MessageKey),
                  })}
                </li>
              )}
              {(refund?.warnings ?? []).map((w) => (
                <li key={w.code} className="text-warning">
                  {t(`${W}.impact.warnings.${w.code}` as MessageKey)}
                </li>
              ))}
            </ul>
          )}
          {refundedBefore > 0 && (
            <p className="mt-2 text-muted-foreground">
              {t(`${W}.impact.before`, { amount: formatMoney(refundedBefore, cur) })}
            </p>
          )}
        </section>
      </div>

      <DialogFooter className="gap-2">
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={run.isPending}
          onClick={onClose}
        >
          {t("admin.actions.cancel")}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          loading={run.isPending && preview === null}
          onClick={() => void calculate()}
        >
          {t(`${W}.calculate`)}
        </Button>
        <Button
          type="button"
          className="min-h-11"
          disabled={!preview || preview.outcome === "rejected" || run.isPending}
          loading={run.isPending && preview !== null}
          onClick={() => void confirm()}
        >
          {t(preset.cancel ? `${W}.confirmCancel` : `${W}.confirmRefund`)}
        </Button>
      </DialogFooter>
    </>
  );
}
