import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { t, type MessageKey } from "@/i18n";
import { toAppError } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SectionCard } from "../ui/PageHeader";
import { createManualOrder, type CustomerHit, type ManualOrderArgs } from "./api";
import {
  useCustomerSearch,
  useOrderMutation,
  usePaymentMethodsLite,
  useShippingMethodsLite,
  useVariantSearch,
} from "./hooks";
import {
  errorText,
  formatMoney,
  newKey,
  normalizePhone,
  parseOptionalMoney,
  validateText,
} from "./logic";
import { MANUAL_OK, resultCode, succeeded } from "./outcomes";
import type { RpcResult } from "./types";

const M = "admin.orders.manual" as const;

interface Line {
  variantId: string;
  name: string;
  detail: string;
  stock: number;
  qty: string;
  price: string;
}

/**
 * Pedido manual (ventas por WhatsApp o mostrador): un flujo guiado con la vista previa que calcula la base — la misma cuenta
 * con la que luego se crea el pedido. Respeta la lista negra y el stock; toma el siguiente número MIC-… sin huecos.
 */
export function ManualOrderPage() {
  const navigate = useNavigate();
  const [customerTerm, setCustomerTerm] = useState("");
  const [customer, setCustomer] = useState<CustomerHit | null>(null);
  const [productTerm, setProductTerm] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [channel, setChannel] = useState<"whatsapp" | "manual">("whatsapp");
  const [shippingMethod, setShippingMethod] = useState("");
  const [payment, setPayment] = useState("");
  const [paid, setPaid] = useState(false);
  const [addr, setAddr] = useState({
    recipient: "",
    phone: "",
    line1: "",
    line2: "",
    city: "La Paz",
    reference: "",
  });
  const [shippingCost, setShippingCost] = useState("");
  const [discount, setDiscount] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<RpcResult | null>(null);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const keyRef = useRef(newKey("mo"));

  const customers = useCustomerSearch(customer ? "" : customerTerm);
  const variants = useVariantSearch(productTerm);
  const methods = usePaymentMethodsLite();
  const shipping = useShippingMethodsLite();
  const run = useOrderMutation((args: ManualOrderArgs) => createManualOrder(args));
  const delivery =
    (shipping.data ?? []).find((m) => m.code === shippingMethod)?.kind === "delivery";
  // Una cuenta registrada solo con correo no tiene teléfono: sin uno de contacto el pedido no puede crearse.
  const needsPhone = customer !== null && !customer.phone;

  // Valores por omisión cuando llegan los catálogos.
  useEffect(() => {
    if (!shippingMethod && shipping.data?.[0]) setShippingMethod(shipping.data[0].code);
  }, [shipping.data, shippingMethod]);
  useEffect(() => {
    if (!payment && methods.data?.[0]) setPayment(methods.data[0].code);
  }, [methods.data, payment]);

  const touched = JSON.stringify([
    customer?.id,
    lines,
    channel,
    shippingMethod,
    payment,
    paid,
    addr,
    shippingCost,
    discount,
    discountReason,
    phone,
    note,
  ]);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setPreview(null);
    keyRef.current = newKey("mo");
  }, [touched]);

  function build(dryRun: boolean): { args: ManualOrderArgs } | { error: Record<string, string> } {
    const errors: Record<string, string> = {};
    if (!customer) errors.customer = t(`${M}.errors.customer`);
    const items: ManualOrderArgs["items"] = [];
    for (const l of lines) {
      const qty = Number.parseInt(l.qty, 10);
      if (!Number.isInteger(qty) || qty < 1) errors.items = t(`${M}.errors.qty`);
      const price = parseOptionalMoney(l.price, true);
      if (!price.ok) errors.items = moneyMessage(price.problem);
      else
        items.push({
          variant_id: l.variantId,
          qty,
          ...(price.value !== null ? { unit_price: price.value } : {}),
        });
    }
    if (items.length === 0) errors.items = t(`${M}.errors.items`);
    let address: Record<string, unknown> | null = null;
    if (delivery) {
      const ph = normalizePhone(addr.phone);
      if (!ph) errors.addrPhone = t(`${M}.errors.phone`);
      if (
        addr.line1.trim().length < 3 ||
        addr.city.trim().length < 2 ||
        addr.recipient.trim() === ""
      )
        errors.address = t(`${M}.errors.address`);
      address = {
        recipient: addr.recipient.trim(),
        phone_e164: ph ?? addr.phone,
        line1: addr.line1.trim(),
        line2: addr.line2.trim() || null,
        city: addr.city.trim(),
        country: "BO",
        reference_text: addr.reference.trim() || null,
      };
    }
    const cost = parseOptionalMoney(shippingCost, true);
    if (!cost.ok) errors.shippingCost = moneyMessage(cost.problem);
    const disc = parseOptionalMoney(discount, true);
    if (!disc.ok) errors.discount = moneyMessage(disc.problem);
    if (disc.ok && (disc.value ?? 0) > 0 && !validateText(discountReason, 300).ok)
      errors.discountReason = t(`${M}.errors.discountReason`);
    let contactPhone: string | null = null;
    if (needsPhone && phone.trim() === "") errors.phone = t(`${M}.errors.phoneRequired`);
    if (phone.trim() !== "") {
      contactPhone = normalizePhone(phone);
      if (!contactPhone) errors.phone = t(`${M}.errors.phone`);
    }
    if (Object.keys(errors).length > 0) return { error: errors };
    return {
      args: {
        profileId: (customer as CustomerHit).id,
        items,
        channel,
        paymentMethod: payment,
        shippingMethod,
        address,
        key: dryRun ? null : keyRef.current,
        shippingCost: cost.ok ? cost.value : null,
        slotId: null,
        deliveryDate: null,
        discount: disc.ok ? (disc.value ?? 0) : 0,
        discountReason: discountReason.trim() || null,
        contactName: null,
        contactEmail: null,
        contactPhone,
        note: note.trim() || null,
        markPaid: paid,
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
      else setFormError(describe(result));
    } catch (error) {
      setFormError(toAppError(error).message);
    }
  }

  async function create() {
    if (run.isPending) return;
    const built = build(false);
    if ("error" in built) {
      setProblems(built.error);
      return;
    }
    try {
      const result = await run.mutateAsync(built.args);
      if (succeeded(result, MANUAL_OK)) {
        toast.success(t(`${M}.created`, { number: String(result.number ?? "") }));
        navigate(`/admin/pedidos/${String(result.order_id)}`);
      } else {
        setFormError(describe(result));
      }
    } catch (error) {
      setFormError(toAppError(error).message);
    }
  }

  const totals = (preview?.totals ?? {}) as Record<string, number>;
  const previewLines = (preview?.lines ?? []) as {
    line_no: number;
    name: string;
    qty: number;
    unit_price: number;
    line_total: number;
    discount: number;
  }[];
  const cur = String(preview?.currency ?? "BOB");

  return (
    <div className="space-y-4">
      <Link
        to="/admin/pedidos"
        className="inline-flex min-h-11 items-center text-sm underline-offset-2 hover:underline"
      >
        {t(`${M}.back`)}
      </Link>
      <h2 className="font-display text-2xl font-bold">{t(`${M}.title`)}</h2>
      <p className="text-sm text-muted-foreground">{t(`${M}.description`)}</p>
      {formError && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {formError}
        </p>
      )}

      <SectionCard id="customer" title={t(`${M}.customer.title`)}>
        {customer ? (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <p>
              <span className="font-medium">{customer.fullName}</span>
              <span className="text-muted-foreground">
                {" "}
                · {[customer.phone, customer.email].filter(Boolean).join(" · ")}
              </span>
            </p>
            <Button type="button" size="sm" variant="outline" onClick={() => setCustomer(null)}>
              {t(`${M}.customer.change`)}
            </Button>
          </div>
        ) : (
          <>
            <Field
              label={t(`${M}.customer.search`)}
              hint={t(`${M}.customer.hint`)}
              error={problems.customer}
            >
              <Input
                type="search"
                value={customerTerm}
                onChange={(event) => setCustomerTerm(event.target.value)}
              />
            </Field>
            {customers.data && customers.data.length > 0 && (
              <ul className="mt-2 divide-y rounded-md border text-sm">
                {customers.data.map((c) => (
                  <li
                    key={c.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                  >
                    <span>
                      {c.fullName}
                      <span className="text-muted-foreground">
                        {" "}
                        · {[c.phone, c.email].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!c.isActive}
                      onClick={() => {
                        setCustomer(c);
                        setPhone("");
                      }}
                    >
                      {c.isActive ? t(`${M}.customer.pick`) : t(`${M}.customer.inactive`)}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {customers.data && customers.data.length === 0 && customerTerm.trim().length >= 2 && (
              <p className="mt-2 text-sm text-muted-foreground">{t(`${M}.customer.none`)}</p>
            )}
          </>
        )}
      </SectionCard>

      <SectionCard id="items" title={t(`${M}.items.title`)}>
        <Field label={t(`${M}.items.search`)} hint={t(`${M}.items.hint`)} error={problems.items}>
          <Input
            type="search"
            value={productTerm}
            onChange={(event) => setProductTerm(event.target.value)}
          />
        </Field>
        {variants.data && variants.data.length > 0 && (
          <ul className="mt-2 divide-y rounded-md border text-sm">
            {variants.data
              .filter((v) => !lines.some((l) => l.variantId === v.id))
              .map((v) => (
                <li
                  key={v.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                >
                  <span>
                    {v.productName}
                    <span className="text-muted-foreground">
                      {" "}
                      · {[v.colorName, v.sizeLabel].filter(Boolean).join(" ")} ·{" "}
                      {t(`${M}.items.stock`, { n: v.stock })}
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
                          variantId: v.id,
                          name: v.productName,
                          detail: [v.colorName, v.sizeLabel].filter(Boolean).join(" "),
                          stock: v.stock,
                          qty: "1",
                          price: "",
                        },
                      ]);
                      setProductTerm("");
                    }}
                  >
                    {t(`${M}.items.add`)}
                  </Button>
                </li>
              ))}
          </ul>
        )}
        {lines.length > 0 && (
          <ul className="mt-3 space-y-2">
            {lines.map((l, idx) => (
              <li
                key={l.variantId}
                className="grid items-end gap-2 text-sm sm:grid-cols-[1fr_5rem_8rem_auto]"
              >
                <span className="break-words">
                  {l.name} <span className="text-muted-foreground">{l.detail}</span>
                </span>
                <Field label={t(`${M}.items.qty`)}>
                  <Input
                    inputMode="numeric"
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
                </Field>
                <Field label={t(`${M}.items.price`)} hint={t(`${M}.items.priceHint`)}>
                  <Input
                    inputMode="decimal"
                    value={l.price}
                    onChange={(event) =>
                      setLines(
                        lines.map((x, i) => (i === idx ? { ...x, price: event.target.value } : x)),
                      )
                    }
                  />
                </Field>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={t(`${M}.items.remove`, { name: l.name })}
                  onClick={() => setLines(lines.filter((_, i) => i !== idx))}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard id="delivery" title={t(`${M}.delivery.title`)}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t(`${M}.delivery.method`)}>
            <Select
              value={shippingMethod}
              onChange={(event) => setShippingMethod(event.target.value)}
            >
              {(shipping.data ?? []).map((m) => (
                <option key={m.code} value={m.code}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={t(`${M}.delivery.cost`)}
            hint={t(`${M}.delivery.costHint`)}
            error={problems.shippingCost}
          >
            <Input
              inputMode="decimal"
              value={shippingCost}
              onChange={(event) => setShippingCost(event.target.value)}
            />
          </Field>
        </div>
        {delivery && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {problems.address && (
              <p role="alert" className="text-sm text-destructive sm:col-span-2">
                {problems.address}
              </p>
            )}
            <Field label={t(`${M}.delivery.recipient`)}>
              <Input
                value={addr.recipient}
                onChange={(event) => setAddr({ ...addr, recipient: event.target.value })}
              />
            </Field>
            <Field label={t(`${M}.delivery.addrPhone`)} error={problems.addrPhone}>
              <Input
                value={addr.phone}
                onChange={(event) => setAddr({ ...addr, phone: event.target.value })}
              />
            </Field>
            <Field label={t(`${M}.delivery.line1`)}>
              <Input
                value={addr.line1}
                onChange={(event) => setAddr({ ...addr, line1: event.target.value })}
              />
            </Field>
            <Field label={t(`${M}.delivery.line2`)}>
              <Input
                value={addr.line2}
                onChange={(event) => setAddr({ ...addr, line2: event.target.value })}
              />
            </Field>
            <Field label={t(`${M}.delivery.city`)}>
              <Input
                value={addr.city}
                onChange={(event) => setAddr({ ...addr, city: event.target.value })}
              />
            </Field>
            <Field label={t(`${M}.delivery.reference`)}>
              <Input
                value={addr.reference}
                onChange={(event) => setAddr({ ...addr, reference: event.target.value })}
              />
            </Field>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              {t(`${M}.delivery.noPin`)}
            </p>
          </div>
        )}
      </SectionCard>

      <SectionCard id="payment" title={t(`${M}.payment.title`)}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t(`${M}.payment.method`)}>
            <Select value={payment} onChange={(event) => setPayment(event.target.value)}>
              {(methods.data ?? []).map((m) => (
                <option key={m.code} value={m.code}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t(`${M}.payment.channel`)}>
            <Select
              value={channel}
              onChange={(event) => setChannel(event.target.value as typeof channel)}
            >
              <option value="whatsapp">{t("admin.orders.channel.whatsapp")}</option>
              <option value="manual">{t("admin.orders.channel.manual")}</option>
            </Select>
          </Field>
        </div>
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-5 w-5"
            checked={paid}
            onChange={(event) => setPaid(event.target.checked)}
          />
          <span>{t(`${M}.payment.paid`)}</span>
        </label>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field
            label={t(`${M}.payment.discount`)}
            hint={t(`${M}.payment.discountHint`)}
            error={problems.discount}
          >
            <Input
              inputMode="decimal"
              value={discount}
              onChange={(event) => setDiscount(event.target.value)}
            />
          </Field>
          <Field label={t(`${M}.payment.discountReason`)} error={problems.discountReason}>
            <Input
              maxLength={300}
              value={discountReason}
              onChange={(event) => setDiscountReason(event.target.value)}
            />
          </Field>
          <Field
            label={needsPhone ? t(`${M}.payment.phoneRequired`) : t(`${M}.payment.phone`)}
            hint={needsPhone ? t(`${M}.payment.phoneRequiredHint`) : t(`${M}.payment.phoneHint`)}
            error={problems.phone}
          >
            <Input value={phone} onChange={(event) => setPhone(event.target.value)} />
          </Field>
        </div>
        <div className="mt-4">
          <Field label={t(`${M}.payment.note`)}>
            <Textarea
              rows={2}
              maxLength={1000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
        </div>
      </SectionCard>

      <SectionCard id="summary" title={t(`${M}.summary.title`)}>
        <div aria-live="polite" className="text-sm">
          {!preview ? (
            <p className="text-muted-foreground">{t(`${M}.summary.hint`)}</p>
          ) : (
            <>
              <ul className="divide-y">
                {previewLines.map((l) => (
                  <li key={l.line_no} className="flex justify-between gap-3 py-1">
                    <span>
                      {l.name} × {l.qty}
                    </span>
                    <span className="tabular-nums">
                      {formatMoney(l.line_total - l.discount, cur)}
                    </span>
                  </li>
                ))}
              </ul>
              <dl className="ml-auto mt-3 grid max-w-xs gap-1">
                <div className="flex justify-between gap-4">
                  <dt>{t(`${M}.summary.subtotal`)}</dt>
                  <dd className="tabular-nums">{formatMoney(Number(totals.subtotal ?? 0), cur)}</dd>
                </div>
                {Number(totals.discount ?? 0) > 0 && (
                  <div className="flex justify-between gap-4">
                    <dt>{t(`${M}.summary.discount`)}</dt>
                    <dd className="tabular-nums">− {formatMoney(Number(totals.discount), cur)}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-4">
                  <dt>{t(`${M}.summary.shipping`)}</dt>
                  <dd className="tabular-nums">{formatMoney(Number(totals.shipping ?? 0), cur)}</dd>
                </div>
                <div className="flex justify-between gap-4 border-t pt-1 text-base font-semibold">
                  <dt>{t(`${M}.summary.total`)}</dt>
                  <dd className="tabular-nums">{formatMoney(Number(totals.total ?? 0), cur)}</dd>
                </div>
              </dl>
            </>
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            loading={run.isPending && !preview}
            onClick={() => void calculate()}
          >
            {t(`${M}.summary.calculate`)}
          </Button>
          <Button
            type="button"
            className="min-h-11"
            disabled={!preview || run.isPending}
            loading={run.isPending && !!preview}
            onClick={() => void create()}
          >
            {t(`${M}.summary.create`)}
          </Button>
        </div>
      </SectionCard>
    </div>
  );
}

const moneyMessage = (problem: string) => t(`admin.orders.errors.money_${problem}` as MessageKey);

/** Explica un rechazo de la base: lo que falta o lo que no hay, con el detalle útil (productos sin stock). */
function describe(result: RpcResult): string {
  if (result.outcome === "unavailable") {
    const lines = (result.lines ?? []) as { name: string; requested: number; available: number }[];
    return t("admin.orders.manual.unavailable", {
      list: lines.map((l) => `${l.name} (${l.available}/${l.requested})`).join(", "),
    });
  }
  return errorText(resultCode(result));
}
