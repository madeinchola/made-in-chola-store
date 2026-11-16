import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { editOrder, type EditArgs } from "./api";
import { useOrderMutation, useVariantSearch } from "./hooks";
import { errorText, formatMoney, normalizePhone, parseOptionalMoney, validateText } from "./logic";
import { EDIT_OK, resultCode, succeeded } from "./outcomes";
import type { OrderDetail, RpcResult } from "./types";

const E = "admin.orders.edit" as const;

interface Line {
  itemId: string | null;
  variantId: string | null;
  name: string;
  qty: string;
  originalQty: number;
}

interface Props {
  order: OrderDetail | null;
  onOpenChange: (open: boolean) => void;
  onDone: (message: string) => void;
}

export function EditOrderDialog({ order, onOpenChange, onDone }: Props) {
  return (
    <Dialog open={order !== null} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] max-w-3xl overflow-y-auto"
        onInteractOutside={(event) => event.preventDefault()}
      >
        {order && <EditBody order={order} onDone={onDone} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function EditBody({
  order,
  onDone,
  onClose,
}: {
  order: OrderDetail;
  onDone: (m: string) => void;
  onClose: () => void;
}) {
  const [lines, setLines] = useState<Line[]>(
    order.items.map((i) => ({
      itemId: i.id,
      variantId: null,
      name: i.name,
      qty: String(i.qty),
      originalQty: i.qty,
    })),
  );
  const [term, setTerm] = useState("");
  const [name, setName] = useState(order.contactName);
  const [email, setEmail] = useState(order.contactEmail ?? "");
  const [phone, setPhone] = useState(order.contactPhone);
  const a = order.address;
  const [addr, setAddr] = useState({
    recipient: a?.recipient ?? "",
    phone: a?.phone ?? "",
    line1: a?.line1 ?? "",
    line2: a?.line2 ?? "",
    city: a?.city ?? "",
    department: a?.department ?? "",
    reference: a?.reference ?? "",
  });
  const [shipping, setShipping] = useState("");
  const [extra, setExtra] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<RpcResult | null>(null);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const hits = useVariantSearch(term);
  const run = useOrderMutation((args: EditArgs) => editOrder(args));
  const delivery = order.shippingKind === "delivery";

  const touched = JSON.stringify([lines, name, email, phone, addr, shipping, extra, reason]);
  useEffect(() => setPreview(null), [touched]);

  function build(dryRun: boolean): { args: EditArgs } | { error: Record<string, string> } {
    const errors: Record<string, string> = {};
    const items: unknown[] = [];
    for (const l of lines) {
      const q = Number.parseInt(l.qty, 10);
      if (!Number.isInteger(q) || q < 0) errors.items = t(`${E}.errors.qty`);
      else if (l.itemId && q !== l.originalQty) items.push({ item_id: l.itemId, qty: q });
      else if (!l.itemId && l.variantId && q > 0) items.push({ variant_id: l.variantId, qty: q });
    }
    const contact: Record<string, string> = {};
    if (name.trim() !== order.contactName) contact.name = name.trim();
    if ((email.trim() || null) !== order.contactEmail) contact.email = email.trim();
    if (phone.trim() !== order.contactPhone) {
      const normalized = normalizePhone(phone);
      if (!normalized) errors.phone = t(`${E}.errors.phone`);
      else contact.phone = normalized;
    }
    let address: Record<string, unknown> | null = null;
    if (delivery && a) {
      const changed =
        addr.recipient !== a.recipient ||
        addr.phone !== a.phone ||
        addr.line1 !== a.line1 ||
        addr.line2 !== (a.line2 ?? "") ||
        addr.city !== a.city ||
        addr.department !== (a.department ?? "") ||
        addr.reference !== (a.reference ?? "");
      if (changed) {
        const ph = normalizePhone(addr.phone);
        if (!ph) errors.addrPhone = t(`${E}.errors.phone`);
        address = {
          recipient: addr.recipient.trim(),
          phone_e164: ph ?? addr.phone,
          line1: addr.line1.trim(),
          line2: addr.line2.trim() || null,
          city: addr.city.trim(),
          department: addr.department.trim() || null,
          country: a.country || "BO",
          reference_text: addr.reference.trim() || null,
          lat: a.lat,
          lng: a.lng,
        };
      }
    }
    const ship = parseOptionalMoney(shipping, true);
    if (!ship.ok) errors.shipping = t(`admin.orders.errors.money_${ship.problem}`);
    const ex = parseOptionalMoney(extra, true);
    if (!ex.ok) errors.extra = t(`admin.orders.errors.money_${ex.problem}`);
    const why = validateText(reason, 300);
    if (!why.ok) errors.reason = t(`${E}.errors.reason`);
    if (Object.keys(errors).length > 0) return { error: errors };
    return {
      args: {
        orderId: order.id,
        expectedUpdatedAt: order.updatedAt,
        items,
        contact: Object.keys(contact).length ? contact : null,
        address,
        shippingCost: ship.ok ? ship.value : null,
        extraDiscount: ex.ok ? (ex.value ?? 0) : 0,
        reason: why.ok ? why.value : "",
        dryRun,
      },
    };
  }

  async function calculate() {
    if (run.isPending) return;
    setFormError(null);
    const built = build(true);
    if ("error" in built) {
      setProblems(built.error);
      return;
    }
    setProblems({});
    try {
      const result = await run.mutateAsync(built.args);
      if (result.outcome === "preview") setPreview(result);
      else setFormError(errorText(resultCode(result)));
    } catch (error) {
      setFormError(toAppError(error).message);
    }
  }

  async function confirm() {
    if (run.isPending) return;
    const built = build(false);
    if ("error" in built) {
      setProblems(built.error);
      return;
    }
    try {
      const result = await run.mutateAsync(built.args);
      if (succeeded(result, EDIT_OK)) {
        const message = t(`${E}.done`, { number: order.number });
        onDone(message);
        toast.success(message);
        onClose();
      } else {
        setFormError(errorText(resultCode(result)));
      }
    } catch (error) {
      setFormError(toAppError(error).message);
    }
  }

  const before = (preview?.before ?? {}) as Record<string, number>;
  const after = (preview?.after ?? {}) as Record<string, number>;
  const diff = (preview?.diff ?? {}) as {
    items?: { op: string; name: string; qty_before: number; qty_after: number }[];
    payment?: string;
    stock?: { name: string; net: number }[];
  };
  const cur = order.currency;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t(`${E}.title`, { number: order.number })}</DialogTitle>
        <DialogDescription>{t(`${E}.description`)}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-5">
        {formError && (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {formError}
          </p>
        )}

        <fieldset className="space-y-2 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">{t(`${E}.linesLegend`)}</legend>
          {lines.map((l, idx) => (
            <div
              key={l.itemId ?? l.variantId ?? idx}
              className="flex flex-wrap items-center justify-between gap-2 text-sm"
            >
              <span className="min-w-0 flex-1 break-words">{l.name}</span>
              <label className="flex items-center gap-2">
                <span className="sr-only">{t(`${E}.qtyFor`, { name: l.name })}</span>
                <Input
                  inputMode="numeric"
                  className="w-20"
                  value={l.qty}
                  onChange={(event) =>
                    setLines(
                      lines.map((x, i) =>
                        i === idx
                          ? { ...x, qty: event.target.value.replace(/\D/g, "").slice(0, 4) }
                          : x,
                      ),
                    )
                  }
                />
              </label>
              {!l.itemId && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={t(`${E}.removeNew`, { name: l.name })}
                  onClick={() => setLines(lines.filter((_, i) => i !== idx))}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              )}
            </div>
          ))}
          {problems.items && (
            <p role="alert" className="text-sm text-destructive">
              {problems.items}
            </p>
          )}
          <p className="text-xs text-muted-foreground">{t(`${E}.zeroHint`)}</p>
          <Field label={t(`${E}.addProduct`)} hint={t(`${E}.addProductHint`)}>
            <Input type="search" value={term} onChange={(event) => setTerm(event.target.value)} />
          </Field>
          {hits.data && hits.data.length > 0 && (
            <ul className="divide-y rounded-md border text-sm">
              {hits.data
                .filter((h) => !lines.some((l) => l.variantId === h.id))
                .map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span>
                      {h.productName}
                      <span className="text-muted-foreground">
                        {" "}
                        · {[h.colorName, h.sizeLabel].filter(Boolean).join(" ")} ·{" "}
                        {t(`${E}.stock`, { n: h.stock })}
                      </span>
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setLines([
                          ...lines,
                          {
                            itemId: null,
                            variantId: h.id,
                            name: h.productName,
                            qty: "1",
                            originalQty: 0,
                          },
                        ]);
                        setTerm("");
                      }}
                    >
                      {t(`${E}.add`)}
                    </Button>
                  </li>
                ))}
            </ul>
          )}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t(`${E}.shipping`)}
            hint={t(`${E}.shippingHint`, { amount: formatMoney(order.shippingCost, cur) })}
            error={problems.shipping}
          >
            <Input
              inputMode="decimal"
              value={shipping}
              onChange={(event) => setShipping(event.target.value)}
            />
          </Field>
          <Field label={t(`${E}.extra`)} hint={t(`${E}.extraHint`)} error={problems.extra}>
            <Input
              inputMode="decimal"
              value={extra}
              onChange={(event) => setExtra(event.target.value)}
            />
          </Field>
        </div>

        <fieldset className="grid gap-4 rounded-md border p-3 sm:grid-cols-3">
          <legend className="px-1 text-sm font-medium">{t(`${E}.contactLegend`)}</legend>
          <Field label={t(`${E}.name`)}>
            <Input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label={t(`${E}.email`)}>
            <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </Field>
          <Field label={t(`${E}.phone`)} error={problems.phone}>
            <Input value={phone} onChange={(event) => setPhone(event.target.value)} />
          </Field>
        </fieldset>

        {delivery && a && (
          <fieldset className="grid gap-4 rounded-md border p-3 sm:grid-cols-2">
            <legend className="px-1 text-sm font-medium">{t(`${E}.addressLegend`)}</legend>
            <Field label={t(`${E}.recipient`)}>
              <Input
                value={addr.recipient}
                onChange={(event) => setAddr({ ...addr, recipient: event.target.value })}
              />
            </Field>
            <Field label={t(`${E}.addrPhone`)} error={problems.addrPhone}>
              <Input
                value={addr.phone}
                onChange={(event) => setAddr({ ...addr, phone: event.target.value })}
              />
            </Field>
            <Field label={t(`${E}.line1`)}>
              <Input
                value={addr.line1}
                onChange={(event) => setAddr({ ...addr, line1: event.target.value })}
              />
            </Field>
            <Field label={t(`${E}.line2`)}>
              <Input
                value={addr.line2}
                onChange={(event) => setAddr({ ...addr, line2: event.target.value })}
              />
            </Field>
            <Field label={t(`${E}.city`)}>
              <Input
                value={addr.city}
                onChange={(event) => setAddr({ ...addr, city: event.target.value })}
              />
            </Field>
            <Field label={t(`${E}.reference`)}>
              <Input
                value={addr.reference}
                onChange={(event) => setAddr({ ...addr, reference: event.target.value })}
              />
            </Field>
            <p className="text-xs text-muted-foreground sm:col-span-2">{t(`${E}.addressHint`)}</p>
          </fieldset>
        )}

        <Field label={t(`${E}.reason`)} hint={t(`${E}.reasonHint`)} error={problems.reason}>
          <Textarea
            rows={2}
            maxLength={300}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>

        <section
          aria-live="polite"
          aria-labelledby="edit-impact"
          className="rounded-md border bg-muted/40 p-3 text-sm"
        >
          <h3 id="edit-impact" className="font-medium">
            {t(`${E}.impact.title`)}
          </h3>
          {!preview ? (
            <p className="text-muted-foreground">{t(`${E}.impact.hint`)}</p>
          ) : (
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>
                {t(`${E}.impact.total`, {
                  from: formatMoney(Number(before.total ?? 0), cur),
                  to: formatMoney(Number(after.total ?? 0), cur),
                })}
              </li>
              {(diff.items ?? []).map((i) => (
                <li key={`${i.op}-${i.name}`}>
                  {t(
                    `${E}.impact.${i.op === "added" ? "added" : i.op === "removed" ? "removed" : "changed"}` as MessageKey,
                    {
                      name: i.name,
                      from: i.qty_before,
                      to: i.qty_after,
                    },
                  )}
                </li>
              ))}
              {(diff.stock ?? []).map((s) => (
                <li key={s.name}>
                  {t(`${E}.impact.${s.net > 0 ? "stockDown" : "stockUp"}` as MessageKey, {
                    name: s.name,
                    n: Math.abs(s.net),
                  })}
                </li>
              ))}
              {diff.payment && diff.payment !== "none" && (
                <li>
                  {t(`${E}.impact.payment.${diff.payment}` as MessageKey, {
                    amount: formatMoney(Math.abs(Number(preview.balance ?? 0)), cur),
                    total: formatMoney(Number(after.total ?? 0), cur),
                  })}
                </li>
              )}
              {preview.suggested_shipping ? (
                <li>
                  {t(`${E}.impact.suggested`, {
                    cost: formatMoney(
                      Number((preview.suggested_shipping as { cost?: number }).cost ?? 0),
                      cur,
                    ),
                  })}
                </li>
              ) : null}
            </ul>
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
          loading={run.isPending && !preview}
          onClick={() => void calculate()}
        >
          {t(`${E}.calculate`)}
        </Button>
        <Button
          type="button"
          className="min-h-11"
          disabled={!preview || run.isPending}
          loading={run.isPending && !!preview}
          onClick={() => void confirm()}
        >
          {t(`${E}.confirm`)}
        </Button>
      </DialogFooter>
    </>
  );
}
