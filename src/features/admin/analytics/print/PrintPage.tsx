import { Link, useSearchParams } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { PageHeader } from "../../ui/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "../../ui/StateViews";
import { getOrder } from "../../orders/api";
import { orderKeys } from "../../orders/queryKeys";
import type { OrderDetail } from "../../orders/types";
import { formatAmount } from "../logic";
import {
  MAX_PRINT_ORDERS,
  PRINT_DOCS,
  PRINT_FORMATS,
  addressLines,
  amountToCollect,
  isPrintDoc,
  isPrintFormat,
  labelFontPt,
  needsShippingLabel,
  pageCss,
  parseIds,
  slotText,
  sortForDispatch,
  unitsOf,
  type PrintDoc,
  type PrintFormat,
} from "./printLogic";

const P = "admin.analytics.print" as const;

/** El ancho de una hoja en pantalla (para la vista previa), igual que en papel. */
function sheetWidth(format: PrintFormat, doc: PrintDoc): string {
  if (format === "label") return "100mm";
  if (doc === "dispatch") return format === "a4" ? "297mm" : "279mm";
  return format === "a4" ? "210mm" : "216mm";
}

const PRINT_CSS = `
.print-page { break-after: page; page-break-after: always; break-inside: avoid; }
.print-page:last-child { break-after: auto; page-break-after: auto; }
.print-text { overflow-wrap: anywhere; word-break: break-word; }
@media print {
  .no-print { display: none !important; }
  .print-area { margin: 0 !important; padding: 0 !important; }
  .print-area > * { margin: 0 !important; }
  .print-page { border: 0 !important; box-shadow: none !important; padding: 0 !important; width: auto !important; max-width: none !important; background: white !important; }
}
`;

/** Etiquetas, guía de despacho y lista de empaque de los pedidos elegidos. Se imprime desde el navegador (o se guarda como PDF). */
export function PrintPage() {
  const [params, setParams] = useSearchParams();
  const ids = parseIds(params.get("ids"));
  const rawDoc = params.get("doc");
  const rawFormat = params.get("formato");
  const doc: PrintDoc = isPrintDoc(rawDoc) ? rawDoc : "label";
  const format: PrintFormat = isPrintFormat(rawFormat)
    ? rawFormat
    : doc === "label"
      ? "label"
      : "a4";
  const requested = (params.get("ids") ?? "").split(",").filter((s) => s.trim() !== "").length;
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: orderKeys.detail(id),
      queryFn: () => getOrder(id),
      staleTime: 30_000,
    })),
  });
  const loading = results.some((r) => r.isPending);
  const failed = results.some((r) => r.isError);
  const found = results.map((r) => r.data).filter((o): o is OrderDetail => Boolean(o));
  const missing = ids.length - found.length;

  const set = (name: string, value: string) => {
    const copy = new URLSearchParams(params);
    copy.set(name, value);
    setParams(copy, { replace: true });
  };

  const labelOrders = found.filter(needsShippingLabel);
  const pickups = found.length - labelOrders.length;

  return (
    <>
      <style>{`${pageCss(format, doc)}${PRINT_CSS}`}</style>
      <div className="no-print">
        <PageHeader
          title={t(`${P}.title`)}
          description={t(`${P}.description`)}
          actions={
            <Button asChild variant="outline" size="sm">
              <Link to="/admin/pedidos">{t(`${P}.back`)}</Link>
            </Button>
          }
        />
        <div className="mb-6 flex flex-wrap items-end gap-4">
          <label className="text-sm">
            <span className="mb-1 block font-medium">{t(`${P}.docLabel`)}</span>
            <Select value={doc} onChange={(e) => set("doc", e.target.value)} className="w-64">
              {PRINT_DOCS.map((d) => (
                <option key={d} value={d}>
                  {t(`${P}.docs.${d}`)}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">{t(`${P}.format`)}</span>
            <Select
              value={format}
              onChange={(e) => set("formato", e.target.value)}
              className="w-64"
            >
              {PRINT_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {t(`${P}.formats.${f}`)}
                </option>
              ))}
            </Select>
          </label>
          <Button
            type="button"
            onClick={() => window.print()}
            disabled={loading || found.length === 0}
          >
            <Printer className="mr-2 h-4 w-4" aria-hidden="true" />
            {t(`${P}.printButton`)}
          </Button>
        </div>
        <p className="mb-2 text-sm text-muted-foreground">{t(`${P}.docHelp.${doc}`)}</p>
        <div className="mb-4 space-y-1 text-sm" aria-live="polite">
          {requested > MAX_PRINT_ORDERS && <p>{t(`${P}.tooMany`, { max: MAX_PRINT_ORDERS })}</p>}
          {!loading && missing > 0 && (
            <p className="text-destructive">{t(`${P}.missing`, { count: missing })}</p>
          )}
          {!loading && doc === "label" && pickups > 0 && labelOrders.length > 0 && (
            <p>{t(`${P}.pickupSkipped`, { count: pickups })}</p>
          )}
        </div>
      </div>

      {ids.length === 0 ? (
        <div className="no-print">
          <EmptyState>{t(`${P}.none`)}</EmptyState>
        </div>
      ) : failed ? (
        <div className="no-print">
          <ErrorState
            message={t(`${P}.loadError`)}
            onRetry={() => results.forEach((r) => void r.refetch())}
          />
        </div>
      ) : loading ? (
        <div className="no-print">
          <LoadingState label={t(`${P}.loading`)} />
        </div>
      ) : doc === "label" && labelOrders.length === 0 && found.length > 0 ? (
        <div className="no-print">
          <EmptyState>{t(`${P}.nothingToLabel`)}</EmptyState>
        </div>
      ) : (
        <div className="print-area space-y-6" data-testid="print-area">
          {doc === "label" &&
            labelOrders.map((o) => (
              <Sheet key={o.id} format={format} doc={doc}>
                <Label order={o} format={format} />
              </Sheet>
            ))}
          {doc === "packing" &&
            found.map((o) => (
              <Sheet key={o.id} format={format} doc={doc}>
                <Packing order={o} />
              </Sheet>
            ))}
          {doc === "dispatch" && found.length > 0 && (
            <Sheet format={format} doc={doc}>
              <Dispatch orders={sortForDispatch(found)} />
            </Sheet>
          )}
        </div>
      )}
    </>
  );
}

/** Una hoja: en pantalla, una tarjeta del ancho del papel; al imprimir, la hoja misma (una por página). */
function Sheet({
  format,
  doc,
  children,
}: {
  format: PrintFormat;
  doc: PrintDoc;
  children: React.ReactNode;
}) {
  return (
    <section
      className="print-page mx-auto rounded-md border bg-white p-4 text-black shadow-sm"
      style={{ width: sheetWidth(format, doc), maxWidth: "100%" }}
    >
      {children}
    </section>
  );
}

function Label({ order, format }: { order: OrderDetail; format: PrintFormat }) {
  const lines = addressLines(order);
  const collect = amountToCollect(order);
  const size = labelFontPt(lines.join(" ").length + (order.contactName?.length ?? 0), format);
  const slot = slotText(order);
  return (
    <div className="print-text" style={{ fontSize: `${size}pt`, lineHeight: 1.25 }}>
      <div className="flex items-start justify-between gap-3 border-b-2 border-black pb-2">
        <span className="font-bold">{t(`${P}.store`)}</span>
        <span className="text-right">
          <span className="block text-[0.7em] uppercase tracking-wide">
            {t(`${P}.label.order`)}
          </span>
          <span className="block text-[1.4em] font-bold leading-none">{order.number}</span>
        </span>
      </div>
      <p className="mt-3 text-[0.7em] font-semibold tracking-wide">{t(`${P}.label.to`)}</p>
      <p className="text-[1.3em] font-bold">{order.address?.recipient || order.contactName}</p>
      <p>
        {t(`${P}.label.phone`)} {order.address?.phone || order.contactPhone}
      </p>
      {lines.length === 0 ? (
        <p className="mt-1 font-semibold">{t(`${P}.label.noAddress`)}</p>
      ) : (
        <div className="mt-1">
          {lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
      <div className="mt-3 grid gap-1 border-t border-black pt-2 text-[0.85em]">
        {slot && (
          <p>
            <span className="font-semibold">{t(`${P}.label.delivery`)}:</span> {slot}
          </p>
        )}
        {order.shippingName && (
          <p>
            <span className="font-semibold">{t(`${P}.label.method`)}:</span> {order.shippingName}
          </p>
        )}
        <p>
          <span className="font-semibold">{t(`${P}.label.units`)}:</span> {unitsOf(order)}
          {"   "}
          <span className="font-semibold">{t(`${P}.label.packages`)}:</span> ______
        </p>
      </div>
      {collect !== null && (
        <p className="mt-3 border-2 border-black p-2 text-center text-[1.1em] font-bold">
          {t(`${P}.label.collect`)}: {formatAmount(collect, order.currency)}
        </p>
      )}
    </div>
  );
}

function Dispatch({ orders }: { orders: OrderDetail[] }) {
  const D = `${P}.dispatch` as const;
  const generated = new Intl.DateTimeFormat("es-BO", {
    timeZone: "America/La_Paz",
    dateStyle: "medium",
    timeStyle: "short",
    hourCycle: "h23",
  }).format(new Date());
  const units = orders.reduce((sum, o) => sum + unitsOf(o), 0);
  return (
    <div className="print-text text-[10pt]">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[16pt] font-bold">
          {t(`${P}.store`)} · {t(`${D}.title`)}
        </h2>
        <p className="text-[9pt]">{t(`${D}.generated`, { date: generated })}</p>
      </div>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b-2 border-black">
            {(
              ["n", "order", "to", "address", "slot", "collect", "units", "signature"] as const
            ).map((c) => (
              <th key={c} scope="col" className="px-1.5 py-1 font-semibold">
                {t(`${D}.cols.${c}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {orders.map((o, i) => {
            const collect = amountToCollect(o);
            return (
              <tr key={o.id} className="break-inside-avoid border-b border-neutral-400 align-top">
                <td className="px-1.5 py-1.5 tabular-nums">{i + 1}</td>
                <td className="px-1.5 py-1.5 font-semibold">{o.number}</td>
                <td className="px-1.5 py-1.5">
                  {o.address?.recipient || o.contactName}
                  <br />
                  {o.address?.phone || o.contactPhone}
                </td>
                <td className="px-1.5 py-1.5">
                  {needsShippingLabel(o) ? addressLines(o).join(", ") || "—" : t(`${D}.pickup`)}
                </td>
                <td className="whitespace-nowrap px-1.5 py-1.5">
                  {slotText(o) || t(`${D}.noSlot`)}
                </td>
                <td className="whitespace-nowrap px-1.5 py-1.5">
                  {collect === null ? "—" : formatAmount(collect, o.currency)}
                </td>
                <td className="px-1.5 py-1.5 tabular-nums">{unitsOf(o)}</td>
                <td className="min-w-[30mm] px-1.5 py-1.5" />
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-3 font-semibold">{t(`${D}.totals`, { orders: orders.length, units })}</p>
    </div>
  );
}

function Packing({ order }: { order: OrderDetail }) {
  const K = `${P}.packing` as const;
  const slot = slotText(order);
  return (
    <div className="print-text text-[11pt]">
      <div className="flex items-start justify-between gap-3 border-b-2 border-black pb-2">
        <div>
          <h2 className="text-[14pt] font-bold">
            {t(`${P}.store`)} · {t(`${K}.title`)}
          </h2>
          <p>
            {order.contactName} · {order.contactPhone}
          </p>
          {slot && (
            <p>
              {t(`${K}.delivery`)}: {slot}
            </p>
          )}
        </div>
        <p className="text-[16pt] font-bold">{order.number}</p>
      </div>
      <table className="mt-3 w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-black">
            {(["check", "sku", "product", "color", "size", "qty"] as const).map((c) => (
              <th key={c} scope="col" className="px-1.5 py-1 font-semibold">
                {t(`${K}.cols.${c}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {order.items.map((i) => (
            <tr key={i.id} className="break-inside-avoid border-b border-neutral-400 align-top">
              <td className="px-1.5 py-1.5">☐</td>
              <td className="px-1.5 py-1.5">{i.sku ?? "—"}</td>
              <td className="px-1.5 py-1.5">{i.name}</td>
              <td className="px-1.5 py-1.5">{i.colorName ?? "—"}</td>
              <td className="px-1.5 py-1.5">{i.sizeLabel ?? "—"}</td>
              <td className="px-1.5 py-1.5 text-right font-bold tabular-nums">{i.qty}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-right font-semibold">{t(`${K}.units`, { count: unitsOf(order) })}</p>
      <div className="mt-8 grid grid-cols-2 gap-8">
        <p className="border-t border-black pt-1 text-[9pt]">{t(`${K}.preparedBy`)}</p>
        <p className="border-t border-black pt-1 text-[9pt]">{t(`${K}.checkedBy`)}</p>
      </div>
    </div>
  );
}
