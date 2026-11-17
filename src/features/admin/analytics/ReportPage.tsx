import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { t } from "@/i18n";
import { BASE_CURRENCY } from "@/lib/currencies";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "../ui/DataTable";
import { Pagination } from "../ui/Pagination";
import { EmptyState } from "../ui/StateViews";
import { useCurrencies } from "../config/hooks";
import { ExportPanel } from "./ExportPanel";
import { useReport } from "./hooks";
import { RangeFilter } from "./RangeFilter";
import { displayValue } from "./reportFormat";
import { reportById } from "./reports";
import type { ReportId, ReportRow } from "./reportTypes";
import { useRangeState } from "./useRangeState";

const R = "admin.analytics.reports" as const;
export const REPORT_PAGE_SIZE = 50;

/** Un reporte: su filtro (período y moneda), la tabla paginada en el servidor, el total y la descarga del CSV completo. */
export function ReportPage({ id }: { id: ReportId }) {
  const report = reportById(id);
  const { preset, range, problem, setPreset, setCustom } = useRangeState();
  const [params, setParams] = useSearchParams();
  const currencies = useCurrencies();
  const currency = params.get("moneda") ?? BASE_CURRENCY;
  const page = Math.max(1, Math.floor(Number(params.get("pagina") ?? 1)) || 1);
  const ready = !report.usesRange || problem === null;
  const args = {
    from: range.from,
    to: range.to,
    currency: report.usesCurrency ? currency : null,
    offset: (page - 1) * REPORT_PAGE_SIZE,
    limit: REPORT_PAGE_SIZE,
  };
  const query = useReport(id, args, ready);
  const data = query.data;

  // Si el filtro cambió y la página pedida ya no existe, se vuelve a la primera (no se muestra una tabla vacía engañosa).
  useEffect(() => {
    if (data && data.rows.length === 0 && page > 1) {
      const copy = new URLSearchParams(params);
      copy.delete("pagina");
      setParams(copy, { replace: true });
    }
  }, [data, page]); // eslint-disable-line react-hooks/exhaustive-deps

  function setParam(name: string, value: string | null) {
    const copy = new URLSearchParams(params);
    if (value === null) copy.delete(name);
    else copy.set(name, value);
    if (name !== "pagina") copy.delete("pagina");
    setParams(copy, { replace: true });
  }

  const columns: Column<ReportRow>[] = report.columns.map((c) => ({
    id: c.key,
    header: t(`${R}.cols.${c.header}`),
    className:
      c.align === "right" ? "text-right tabular-nums whitespace-nowrap" : "whitespace-nowrap",
    cell: (row) => {
      const rowCurrency = c.currencyKey ? String(row[c.currencyKey] ?? currency) : currency;
      return displayValue(c.kind, row[c.key] ?? null, rowCurrency);
    },
  }));

  const summary = data?.summary;
  return (
    <div className="space-y-4">
      <p className="max-w-prose text-sm text-muted-foreground">
        {t(`${R}.about.${report.aboutKey as "sales"}`)}
      </p>
      {report.usesRange && (
        <RangeFilter preset={preset} range={range} onPreset={setPreset} onCustom={setCustom} />
      )}
      {report.usesCurrency && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="font-medium">{t(`${R}.currency`)}</span>
            <Select
              value={currency}
              onChange={(e) => setParam("moneda", e.target.value)}
              className="w-28"
            >
              {(currencies.data ?? [{ code: BASE_CURRENCY }]).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code}
                </option>
              ))}
            </Select>
          </label>
          <span className="text-xs text-muted-foreground">{t(`${R}.currencyNote`)}</span>
        </div>
      )}
      {summary && (
        <p className="rounded-lg border bg-muted/40 p-3 text-sm" data-testid="report-summary">
          {t(`${R}.customersSummary`, {
            customers: summary.customers ?? 0,
            fresh: summary.new_customers ?? 0,
            recurring: summary.recurring_customers ?? 0,
            accounts: summary.new_accounts ?? 0,
          })}
        </p>
      )}
      {problem && report.usesRange ? (
        <EmptyState>{t(`admin.analytics.dashboard.range.problems.${problem}`)}</EmptyState>
      ) : (
        <>
          <DataTable
            caption={t(`${R}.tabs.${report.tabKey as "sales"}`)}
            columns={columns}
            rows={data?.rows ?? []}
            getRowId={(row) => report.rowKey(row, (data?.rows ?? []).indexOf(row))}
            loading={query.isPending}
            refreshing={query.isFetching && !query.isPending}
            error={query.isError}
            onRetry={() => void query.refetch()}
            empty={<EmptyState>{t(`${R}.empty`)}</EmptyState>}
          />
          {data && data.total > 0 && (
            <Pagination
              page={page}
              pageSize={REPORT_PAGE_SIZE}
              total={data.total}
              onPageChange={(next) => setParam("pagina", next <= 1 ? null : String(next))}
            />
          )}
          <ExportPanel
            report={report}
            filters={{
              from: range.from,
              to: range.to,
              currency: report.usesCurrency ? currency : null,
            }}
            currency={currency}
            disabled={query.isPending || query.isError || (data?.total ?? 0) === 0}
          />
        </>
      )}
    </div>
  );
}

export const SalesReport = () => <ReportPage id="ventas" />;
export const ProductsReport = () => <ReportPage id="productos" />;
export const InventoryReport = () => <ReportPage id="inventario" />;
export const DiscountsReport = () => <ReportPage id="descuentos" />;
export const PaymentsReport = () => <ReportPage id="pagos" />;
export const ReturnsReport = () => <ReportPage id="devoluciones" />;
export const CustomersReport = () => <ReportPage id="clientas" />;
