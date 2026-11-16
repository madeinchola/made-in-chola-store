import { ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { t, type MessageKey } from "@/i18n";
import { productImageUrl } from "@/features/catalog/mediaUrl";
import { Badge } from "@/components/ui/badge";
import { SectionCard } from "../ui/PageHeader";
import { formatDateTime, formatMoney, paymentStatusLabel } from "./logic";
import type { OrderDetail, OrderPayment, ProofSummary } from "./types";

const D = "admin.orders.detail" as const;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

/** Enlace al mapa (OpenStreetMap, sin cargar nada más): el pin es el que la clienta o el administrador marcó. */
const mapUrl = (lat: number, lng: number) =>
  `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;

export function CustomerCard({ order, blacklisted }: { order: OrderDetail; blacklisted: boolean }) {
  return (
    <SectionCard id="customer" title={t(`${D}.customer.title`)}>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Row label={t(`${D}.customer.name`)}>{order.contactName}</Row>
        <Row label={t(`${D}.customer.phone`)}>{order.contactPhone}</Row>
        <Row label={t(`${D}.customer.email`)}>{order.contactEmail ?? t("admin.none")}</Row>
        <Row label={t(`${D}.customer.channel`)}>
          {t(`admin.orders.channel.${order.channel}` as MessageKey)}
        </Row>
      </dl>
      {blacklisted && (
        <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {t(`${D}.customer.blacklisted`)}
        </p>
      )}
    </SectionCard>
  );
}

export function DeliveryCard({ order }: { order: OrderDetail }) {
  const a = order.address;
  return (
    <SectionCard id="delivery" title={t(`${D}.delivery.title`)}>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Row label={t(`${D}.delivery.method`)}>{order.shippingName ?? t("admin.none")}</Row>
        {order.slot && (
          <Row label={t(`${D}.delivery.slot`)}>
            {[
              order.slot.date,
              order.slot.start && order.slot.end ? `${order.slot.start}–${order.slot.end}` : null,
            ]
              .filter(Boolean)
              .join(" · ") || t("admin.none")}
          </Row>
        )}
        {a ? (
          <>
            <Row label={t(`${D}.delivery.recipient`)}>
              {a.recipient} · {a.phone}
            </Row>
            <Row label={t(`${D}.delivery.address`)}>
              {[a.line1, a.line2, a.city, a.department].filter(Boolean).join(", ")}
              {a.reference && (
                <span className="block text-muted-foreground">
                  {t(`${D}.delivery.reference`, { text: a.reference })}
                </span>
              )}
              {a.lat !== null && a.lng !== null && (
                <a
                  href={mapUrl(a.lat, a.lng)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-1 inline-flex items-center gap-1 underline underline-offset-2"
                >
                  {t(`${D}.delivery.map`)}
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              )}
            </Row>
          </>
        ) : (
          <Row label={t(`${D}.delivery.address`)}>{t(`${D}.delivery.pickup`)}</Row>
        )}
      </dl>
    </SectionCard>
  );
}

export function ItemsCard({ order }: { order: OrderDetail }) {
  const fmt = (n: number) => formatMoney(n, order.currency);
  return (
    <SectionCard id="items" title={t(`${D}.items.title`)}>
      {/* En un móvil la tabla se desplaza en horizontal: la región debe poder enfocarse con el teclado (axe: scrollable-region-focusable). */}
      <div
        className="overflow-x-auto"
        role="region"
        tabIndex={0}
        aria-label={t(`${D}.items.caption`)}
      >
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{t(`${D}.items.caption`)}</caption>
          <thead className="border-b text-muted-foreground">
            <tr>
              <th scope="col" className="py-2 pr-3 font-medium">
                {t(`${D}.items.product`)}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t(`${D}.items.qty`)}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t(`${D}.items.unit`)}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t(`${D}.items.discount`)}
              </th>
              <th scope="col" className="py-2 pl-3 text-right font-medium">
                {t(`${D}.items.total`)}
              </th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((i) => (
              <tr key={i.id} className="border-b last:border-b-0">
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-3">
                    {i.imagePath ? (
                      <img
                        src={productImageUrl(i.imagePath)}
                        alt=""
                        loading="lazy"
                        width={48}
                        height={48}
                        className="h-12 w-12 shrink-0 rounded-md border object-cover"
                      />
                    ) : (
                      <span
                        className="h-12 w-12 shrink-0 rounded-md border bg-muted"
                        aria-hidden="true"
                      />
                    )}
                    <div className="min-w-0">
                      <p className="font-medium">{i.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {[i.colorName, i.sizeLabel, i.sku].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{i.qty}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(i.unitPrice)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {i.discount > 0 ? `− ${fmt(i.discount)}` : "—"}
                </td>
                <td className="py-2 pl-3 text-right tabular-nums">{fmt(i.finalTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="ml-auto mt-4 grid max-w-xs gap-1 text-sm">
        <div className="flex justify-between gap-4">
          <dt>{t(`${D}.totals.subtotal`)}</dt>
          <dd className="tabular-nums">{fmt(order.subtotal)}</dd>
        </div>
        {order.discountTotal > 0 && (
          <div className="flex justify-between gap-4">
            <dt>
              {t(`${D}.totals.discount`)}
              {order.couponCode && (
                <span className="text-muted-foreground"> ({order.couponCode})</span>
              )}
            </dt>
            <dd className="tabular-nums">− {fmt(order.discountTotal)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-4">
          <dt>{t(`${D}.totals.shipping`)}</dt>
          <dd className="tabular-nums">{fmt(order.shippingCost)}</dd>
        </div>
        {order.shippingDiscount > 0 && (
          <div className="flex justify-between gap-4">
            <dt>{t(`${D}.totals.shippingDiscount`)}</dt>
            <dd className="tabular-nums">− {fmt(order.shippingDiscount)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-4 border-t pt-1 text-base font-semibold">
          <dt>{t(`${D}.totals.total`)}</dt>
          <dd className="tabular-nums">{fmt(order.total)}</dd>
        </div>
      </dl>
    </SectionCard>
  );
}

const PAYMENT_TONE = {
  paid: "success",
  pending: "info",
  initiated: "info",
  failed: "danger",
  disputed: "danger",
  cancelled: "neutral",
  expired: "neutral",
  refunded: "warning",
} as const;

export function PaymentsCard({
  order,
  payments,
  proofs,
}: {
  order: OrderDetail;
  payments: readonly OrderPayment[];
  proofs: readonly ProofSummary[];
}) {
  const pendingProofs = proofs.filter((p) => p.status === "pending").length;
  return (
    <SectionCard id="payments" title={t(`${D}.payments.title`)}>
      {payments.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(`${D}.payments.empty`)}</p>
      ) : (
        <ul className="divide-y text-sm">
          {payments.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div>
                <p className="flex flex-wrap items-center gap-2">
                  <Badge tone={PAYMENT_TONE[p.status]}>{paymentStatusLabel(p.status)}</Badge>
                  <span className="font-mono text-xs">{p.reference}</span>
                </p>
                <p className="text-muted-foreground">
                  {t(`admin.payments.providers.${p.provider}` as MessageKey)}
                  {p.provider === "cash_on_delivery" &&
                    ` · ${p.collectedAt ? t(`${D}.payments.collected`, { date: formatDateTime(p.collectedAt) }) : t(`${D}.payments.notCollected`)}`}
                </p>
              </div>
              <div className="text-right tabular-nums">
                <p>{formatMoney(p.amount, p.currency)}</p>
                {p.receivedAmount !== null && p.receivedAmount !== p.amount && (
                  <p className="text-xs text-muted-foreground">
                    {t(`${D}.payments.received`, {
                      amount: formatMoney(p.receivedAmount, p.currency),
                    })}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {pendingProofs > 0 && (
        <p className="mt-3 rounded-md border border-warning/40 bg-warning-soft p-3 text-sm">
          {t(`${D}.payments.proofPending`, { count: pendingProofs })}{" "}
          <Link to="/admin/pagos" className="underline underline-offset-2">
            {t(`${D}.payments.goReview`)}
          </Link>
        </p>
      )}
      {order.paymentExpiresAt && order.status === "pending_payment" && (
        <p className="mt-3 text-sm text-muted-foreground">
          {t(`${D}.payments.expires`, { date: formatDateTime(order.paymentExpiresAt) })}
        </p>
      )}
    </SectionCard>
  );
}
