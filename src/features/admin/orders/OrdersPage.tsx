import { useState, type FormEvent } from "react";
import { Download } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { t, type MessageKey } from "@/i18n";
import { toAppError } from "@/lib/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { DataTable, type Column } from "../ui/DataTable";
import { Pagination } from "../ui/Pagination";
import { EmptyState } from "../ui/StateViews";
import { listOrdersForExport, transitionOrder } from "./api";
import { AdvanceDialog, type AdvanceTarget } from "./AdvanceDialog";
import { useInvalidateOrders, useOrders, usePaymentMethodsLite, useStatusCounts } from "./hooks";
import {
  advanceLabelKey,
  formatDateTime,
  formatMoney,
  ordersToCsv,
  statusLabel,
  statusTone,
} from "./logic";
import {
  DEFAULT_FILTERS,
  ORDER_CHANNELS,
  ORDER_STATUSES,
  PAGE_SIZE,
  type OrderFilters,
  type OrderRow,
  type OrderStatus,
} from "./types";

const L = "admin.orders.list" as const;

/** Descarga un texto como archivo (sin servidor): el CSV se arma en el navegador con los pedidos que ya puede leer. */
function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Bandeja de pedidos: pestañas por estado con su contador, búsqueda, filtros, avanzar con un clic (con confirmación) y
 * acciones sobre varios a la vez. Cada pedido avanza por su propia llamada atómica: si uno falla, los demás no se afectan.
 */
export function OrdersPage() {
  const [filters, setFilters] = useState<OrderFilters>(DEFAULT_FILTERS);
  const [searchText, setSearchText] = useState("");
  const [target, setTarget] = useState<AdvanceTarget | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const query = useOrders(filters);
  const counts = useStatusCounts();
  const methods = usePaymentMethodsLite();
  const invalidate = useInvalidateOrders();
  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const allCount = Object.values(counts.data ?? {}).reduce((a, b) => a + b, 0);

  const set = (patch: Partial<OrderFilters>) => {
    setFilters({ ...filters, ...patch, page: patch.page ?? 0 });
    setSelected(new Set());
  };
  const done = (message: string) => setStatus(message);

  function onSearch(event: FormEvent) {
    event.preventDefault();
    set({ search: searchText });
  }

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const pageAllSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  /** «Marcar preparando» a todos los seleccionados que estén pagados; los demás se omiten y se cuentan. */
  async function bulkPrepare() {
    if (busy) return;
    const eligible = rows.filter((r) => selected.has(r.id) && r.status === "paid");
    const skipped = selected.size - eligible.length;
    if (eligible.length === 0) {
      toast.error(t(`${L}.bulk.noneEligible`));
      return;
    }
    setBusy(true);
    let ok = 0;
    let failed = 0;
    for (const order of eligible) {
      try {
        const result = await transitionOrder(order.id, "preparing", null, "paid");
        if (result.ok === true) ok += 1;
        else failed += 1;
      } catch (error) {
        failed += 1;
        void toAppError(error);
      }
    }
    setBusy(false);
    setSelected(new Set());
    void invalidate();
    const message = t(`${L}.bulk.prepared`, { ok, failed, skipped });
    done(message);
    if (failed > 0) toast.error(message);
    else toast.success(message);
  }

  async function exportCsv(onlySelected: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      const data = onlySelected
        ? rows.filter((r) => selected.has(r.id))
        : await listOrdersForExport(filters);
      download(`pedidos-${new Date().toISOString().slice(0, 10)}.csv`, ordersToCsv(data));
      done(t(`${L}.bulk.exported`, { count: data.length }));
    } catch (error) {
      toast.error(toAppError(error).message);
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<OrderRow>[] = [
    {
      id: "select",
      header: (
        <input
          type="checkbox"
          aria-label={t(`${L}.columns.selectAll`)}
          checked={pageAllSelected}
          onChange={() => setSelected(pageAllSelected ? new Set() : new Set(rows.map((r) => r.id)))}
          className="h-5 w-5"
        />
      ),
      cell: (r) => (
        <input
          type="checkbox"
          aria-label={t(`${L}.columns.selectOne`, { number: r.number })}
          checked={selected.has(r.id)}
          onChange={() => toggle(r.id)}
          className="h-5 w-5"
        />
      ),
    },
    {
      id: "number",
      header: t(`${L}.columns.number`),
      cell: (r) => (
        <Link
          to={`/admin/pedidos/${r.id}`}
          className="font-medium underline-offset-2 hover:underline"
        >
          {r.number}
        </Link>
      ),
    },
    {
      id: "date",
      header: t(`${L}.columns.date`),
      cell: (r) => <span className="whitespace-nowrap">{formatDateTime(r.createdAt)}</span>,
    },
    {
      id: "client",
      header: t(`${L}.columns.client`),
      cell: (r) => (
        <div className="min-w-[8rem]">
          <p className="break-words">{r.contactName}</p>
          <p className="text-xs text-muted-foreground">{r.contactPhone}</p>
        </div>
      ),
    },
    {
      id: "method",
      header: t(`${L}.columns.method`),
      cell: (r) => (
        <div>
          <p>{methods.data?.find((m) => m.code === r.paymentMethod)?.name ?? r.paymentMethod}</p>
          {r.channel !== "web" && (
            <p className="text-xs text-muted-foreground">
              {t(`admin.orders.channel.${r.channel}` as MessageKey)}
            </p>
          )}
        </div>
      ),
    },
    {
      id: "status",
      header: t(`${L}.columns.status`),
      cell: (r) => <Badge tone={statusTone(r.status)}>{statusLabel(r.status)}</Badge>,
    },
    {
      id: "total",
      header: t(`${L}.columns.total`),
      className: "text-right",
      cell: (r) => (
        <span className="whitespace-nowrap tabular-nums">{formatMoney(r.total, r.currency)}</span>
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">{t(`${L}.columns.actions`)}</span>,
      cell: (r) => {
        const key = advanceLabelKey(r.status);
        return (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {key && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-label={`${t(key)} · ${r.number}`}
                onClick={() => setTarget({ id: r.id, number: r.number, status: r.status })}
              >
                {t(key)}
              </Button>
            )}
            <Link
              to={`/admin/pedidos/${r.id}`}
              aria-label={t(`${L}.detailLabel`, { number: r.number })}
              className="text-sm underline-offset-2 hover:underline"
            >
              {t(`${L}.detail`)}
            </Link>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>

      <div role="group" aria-label={t(`${L}.statusGroup`)} className="flex flex-wrap gap-2">
        {(["all", ...ORDER_STATUSES] as const).map((s) => {
          const count = s === "all" ? allCount : (counts.data?.[s] ?? 0);
          const active = filters.status === s;
          return (
            <button
              key={s}
              type="button"
              aria-pressed={active}
              onClick={() => set({ status: s as OrderStatus | "all" })}
              className={cn(
                "inline-flex min-h-11 items-center gap-2 rounded-pill border px-4 text-sm transition-colors",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted",
              )}
            >
              {s === "all" ? t(`${L}.statusAll`) : statusLabel(s)}
              <span className={cn("tabular-nums", active ? "opacity-90" : "text-muted-foreground")}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <form onSubmit={onSearch} className="flex flex-wrap items-end gap-4" role="search">
        <Field label={t(`${L}.search`)}>
          <Input
            type="search"
            value={searchText}
            maxLength={60}
            placeholder={t(`${L}.searchPlaceholder`)}
            onChange={(event) => setSearchText(event.target.value)}
          />
        </Field>
        <Field label={t(`${L}.method`)}>
          <Select value={filters.method} onChange={(event) => set({ method: event.target.value })}>
            <option value="all">{t(`${L}.all`)}</option>
            {(methods.data ?? []).map((m) => (
              <option key={m.code} value={m.code}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t(`${L}.channel`)}>
          <Select
            value={filters.channel}
            onChange={(event) => set({ channel: event.target.value as OrderFilters["channel"] })}
          >
            <option value="all">{t(`${L}.all`)}</option>
            {ORDER_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {t(`admin.orders.channel.${c}` as MessageKey)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t(`${L}.from`)}>
          <Input
            type="date"
            value={filters.from}
            onChange={(event) => set({ from: event.target.value })}
          />
        </Field>
        <Field label={t(`${L}.to`)}>
          <Input
            type="date"
            value={filters.to}
            onChange={(event) => set({ to: event.target.value })}
          />
        </Field>
        <Button type="submit" className="min-h-11">
          {t(`${L}.searchButton`)}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={() => {
            setSearchText("");
            setFilters(DEFAULT_FILTERS);
            setSelected(new Set());
          }}
        >
          {t(`${L}.clear`)}
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-2" aria-live="polite">
        <p className="text-sm text-muted-foreground">
          {t(`${L}.bulk.selected`, { count: selected.size })}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={selected.size === 0 || busy}
          onClick={() => void bulkPrepare()}
        >
          {t(`${L}.bulk.prepare`)}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={busy}
          onClick={() => void exportCsv(selected.size > 0)}
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          {selected.size > 0 ? t(`${L}.bulk.exportSelected`) : t(`${L}.bulk.exportAll`)}
        </Button>
        <Button
          asChild
          variant="outline"
          size="sm"
          className={selected.size === 0 ? "pointer-events-none opacity-50" : ""}
        >
          <Link
            to={`/admin/pedidos/imprimir?ids=${[...selected].join(",")}`}
            aria-disabled={selected.size === 0}
            tabIndex={selected.size === 0 ? -1 : undefined}
          >
            {selected.size > 0
              ? t("admin.analytics.print.openSelected", { count: selected.size })
              : t("admin.analytics.print.open")}
          </Link>
        </Button>
      </div>

      <DataTable
        caption={t(`${L}.caption`)}
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        loading={query.isPending}
        refreshing={query.isFetching && !query.isPending}
        error={query.isError}
        onRetry={() => void query.refetch()}
        empty={<EmptyState>{t(`${L}.empty`)}</EmptyState>}
      />
      {total > PAGE_SIZE && (
        <Pagination
          page={filters.page + 1}
          pageSize={PAGE_SIZE}
          total={total}
          onPageChange={(page) => setFilters({ ...filters, page: page - 1 })}
        />
      )}

      <AdvanceDialog
        order={target}
        onOpenChange={(open) => !open && setTarget(null)}
        onDone={done}
      />
    </div>
  );
}
