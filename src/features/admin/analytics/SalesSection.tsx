import { Suspense, lazy, useState } from "react";
import { Link } from "react-router-dom";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { SectionCard } from "../ui/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "../ui/StateViews";
import { useFunnel, usePaymentMix, useSalesSummary, useTopProducts } from "./hooks";
import { KpiCard } from "./KpiCard";
import {
  bucketTitle,
  formatAmount,
  formatInt,
  formatPercent,
  formatRangeDate,
  granularityFor,
  hasSales,
  marginState,
  paymentMethodLabel,
  percentChange,
  pickCurrency,
  shareOf,
} from "./logic";
import { RangeFilter } from "./RangeFilter";
import { useRangeState } from "./useRangeState";
import { ShareBars } from "./ShareBars";
import type { CurrencySummary, Funnel, SalesSummary } from "./types";

const SalesChart = lazy(() => import("./SalesChart"));
const D = "admin.analytics.dashboard" as const;

/** Ventas del negocio: indicadores con su comparativa, la serie en el tiempo, lo más vendido, cómo pagan y el embudo. */
export function SalesSection() {
  const { preset, range, problem, setPreset, setCustom } = useRangeState();
  const [currencyChoice, setCurrencyChoice] = useState<string | null>(null);
  const [topBy, setTopBy] = useState<"revenue" | "units">("revenue");
  const granularity = problem === null ? granularityFor(range) : "day";
  const summary = useSalesSummary(range, granularity, problem === null);
  const current = pickCurrency(summary.data, currencyChoice);
  const currency = current?.currency ?? null;
  const top = useTopProducts(range, currency, topBy, "desc", 5, current !== undefined);
  const mix = usePaymentMix(range, current !== undefined);
  const funnel = useFunnel(range, problem === null);
  const data = summary.data;

  return (
    <div>
      <RangeFilter preset={preset} range={range} onPreset={setPreset} onCustom={setCustom} />
      {data && (
        <p className="mb-4 text-sm text-muted-foreground" data-testid="range-summary">
          {data.range.days === 1
            ? t(`${D}.range.summaryOne`, {
                from: formatRangeDate(data.range.from),
                prevFrom: formatRangeDate(data.previous.from),
              })
            : t(`${D}.range.summary`, {
                from: formatRangeDate(data.range.from),
                to: formatRangeDate(data.range.to),
                days: data.range.days,
                prevFrom: formatRangeDate(data.previous.from),
                prevTo: formatRangeDate(data.previous.to),
              })}
        </p>
      )}
      {problem ? (
        <ErrorState message={t(`${D}.range.problems.${problem}`)} />
      ) : summary.isError ? (
        <ErrorState message={t(`${D}.loadError`)} onRetry={() => void summary.refetch()} />
      ) : !data ? (
        <LoadingState />
      ) : !hasSales(data) ? (
        <EmptyState>
          <span className="block font-medium text-foreground">{t(`${D}.empty.title`)}</span>
          <span className="mt-1 block">{t(`${D}.empty.body`)}</span>
          {data.other.cancelled + data.other.pending + data.other.refunded_full > 0 && (
            <span className="mt-2 block">
              {t(`${D}.empty.otherBody`, {
                cancelled: data.other.cancelled,
                pending: data.other.pending,
                refunded: data.other.refunded_full,
              })}
            </span>
          )}
        </EmptyState>
      ) : (
        current && (
          <div className="space-y-6">
            {data.currencies.length > 1 && (
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{t(`${D}.currency.label`)}</span>
                  <Select
                    value={current.currency}
                    onChange={(e) => setCurrencyChoice(e.target.value)}
                    className="w-28"
                  >
                    {data.currencies.map((c) => (
                      <option key={c.currency} value={c.currency}>
                        {c.currency}
                      </option>
                    ))}
                  </Select>
                </label>
                <span className="text-xs text-muted-foreground">{t(`${D}.currency.note`)}</span>
              </div>
            )}
            <Kpis current={current} />
            {data.currencies.length > 1 && (
              <p className="rounded-lg border bg-muted/40 p-3 text-sm">
                <span className="font-medium">
                  {t(`${D}.consolidated.title`, { currency: data.consolidated.currency })}.{" "}
                </span>
                {t(`${D}.consolidated.body`, {
                  net: formatAmount(data.consolidated.current.net, data.consolidated.currency),
                  orders: formatInt(data.consolidated.current.orders),
                })}
              </p>
            )}
            <SeriesCard summary={data} current={current} />
            <div className="grid gap-6 lg:grid-cols-2">
              <TopCard
                rows={top.data}
                loading={top.isPending}
                error={top.isError}
                by={topBy}
                onBy={setTopBy}
                currency={current.currency}
              />
              <PaymentsCard
                rows={(mix.data ?? []).filter((r) => r.currency === current.currency)}
                loading={mix.isPending}
                currency={current.currency}
              />
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <FunnelCard funnel={funnel.data} loading={funnel.isPending} />
              <SectionCard
                id="other"
                title={t(`${D}.other.title`)}
                description={t(`${D}.other.description`)}
              >
                <dl className="grid gap-3 sm:grid-cols-3">
                  <Count label={t(`${D}.other.cancelled`)} value={data.other.cancelled} />
                  <Count label={t(`${D}.other.pending`)} value={data.other.pending} />
                  <Count label={t(`${D}.other.refunded`)} value={data.other.refunded_full} />
                </dl>
              </SectionCard>
            </div>
          </div>
        )
      )}
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-xl font-bold">{formatInt(value)}</dd>
    </div>
  );
}

function Kpis({ current }: { current: CurrencySummary }) {
  const k = current.current;
  const prev = current.previous;
  const cur = current.currency;
  const state = marginState(k);
  const K = `${D}.kpi` as const;
  const delta = (
    value: number,
    previous: number | null | undefined,
    goodWhen: "up" | "down" | "neutral",
  ) => ({
    pct: percentChange(value, previous),
    goodWhen,
  });
  return (
    <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="kpis">
      <KpiCard
        label={t(`${K}.net`)}
        value={formatAmount(k.net, cur)}
        delta={delta(k.net, prev.net, "up")}
        hint={t(`${K}.netHint`)}
      />
      <KpiCard
        label={t(`${K}.orders`)}
        value={formatInt(k.orders)}
        delta={delta(k.orders, prev.orders, "up")}
        hint={t(`${K}.units`, { count: formatInt(k.units) })}
      />
      <KpiCard
        label={t(`${K}.avgTicket`)}
        value={k.avg_ticket === null ? "—" : formatAmount(k.avg_ticket, cur)}
        delta={k.avg_ticket === null ? undefined : delta(k.avg_ticket, prev.avg_ticket, "up")}
        hint={t(`${K}.avgHint`)}
      />
      <KpiCard
        label={t(`${K}.gross`)}
        value={formatAmount(k.gross, cur)}
        delta={delta(k.gross, prev.gross, "up")}
        hint={t(`${K}.grossHint`)}
      />
      <KpiCard
        label={t(`${K}.discounts`)}
        value={formatAmount(k.discounts, cur)}
        delta={delta(k.discounts, prev.discounts, "neutral")}
      />
      <KpiCard
        label={t(`${K}.refunds`)}
        value={formatAmount(k.refunds, cur)}
        delta={delta(k.refunds, prev.refunds, "down")}
      />
      <KpiCard
        label={t(`${K}.margin`)}
        tone={state === "unknown" || state === "partial" ? "warn" : "default"}
        value={
          k.margin === null
            ? state === "unknown"
              ? t(`${K}.unknown`)
              : "—"
            : formatAmount(k.margin, cur)
        }
        delta={
          k.margin !== null && prev.margin !== null && prev.margin !== undefined
            ? delta(k.margin, prev.margin, "up")
            : undefined
        }
        hint={
          k.margin_pct === null
            ? undefined
            : t(`${K}.marginPct`, { pct: formatPercent(k.margin_pct) })
        }
        note={
          state === "unknown"
            ? t(`${K}.marginUnknown`)
            : state === "partial"
              ? t(`${K}.marginPartial`, { costed: k.costed_orders, orders: k.orders })
              : undefined
        }
      />
      <KpiCard
        label={t(`${K}.profit`)}
        tone={state === "unknown" ? "warn" : "default"}
        value={
          k.profit === null
            ? state === "unknown"
              ? t(`${K}.unknownF`)
              : "—"
            : formatAmount(k.profit, cur)
        }
        delta={
          k.profit !== null && prev.profit !== null && prev.profit !== undefined
            ? delta(k.profit, prev.profit, "up")
            : undefined
        }
        note={
          k.profit === null
            ? state === "unknown"
              ? t(`${K}.profitUnknown`)
              : undefined
            : t(`${K}.profitHint`, { amount: formatAmount(k.incident_cost, cur) })
        }
      />
    </dl>
  );
}

function SeriesCard({ summary, current }: { summary: SalesSummary; current: CurrencySummary }) {
  const S = `${D}.series` as const;
  return (
    <SectionCard
      id="series"
      title={t(`${S}.title`)}
      description={t(`${S}.description`, { unit: t(`${S}.units.${summary.granularity}`) })}
    >
      <div aria-hidden="true" className="h-[260px]">
        <Suspense fallback={<div className="h-[260px]" />}>
          <SalesChart
            series={current.series}
            granularity={summary.granularity}
            currency={current.currency}
          />
        </Suspense>
      </div>
      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-medium underline-offset-2 hover:underline">
          {t(`${S}.dataToggle`)}
        </summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <caption className="sr-only">{t(`${S}.title`)}</caption>
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t(`${S}.colBucket`)}
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  {t(`${S}.orders`)}
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  {t(`${S}.net`)}
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  {t(`${S}.margin`)}
                </th>
              </tr>
            </thead>
            <tbody>
              {current.series.map((p) => (
                <tr key={p.bucket} className="border-b last:border-b-0">
                  <th scope="row" className="py-2 pr-3 text-left font-normal">
                    {bucketTitle(p.bucket, summary.granularity)}
                  </th>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatInt(p.orders)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {formatAmount(p.net, current.currency)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {p.margin === null ? "—" : formatAmount(p.margin, current.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </SectionCard>
  );
}

function TopCard({
  rows,
  loading,
  error,
  by,
  onBy,
  currency,
}: {
  rows: import("./types").TopProduct[] | undefined;
  loading: boolean;
  error: boolean;
  by: "revenue" | "units";
  onBy: (by: "revenue" | "units") => void;
  currency: string;
}) {
  const T = `${D}.top` as const;
  const max = Math.max(1, ...(rows ?? []).map((r) => (by === "revenue" ? r.revenue : r.units)));
  return (
    <SectionCard
      id="top"
      title={t(`${T}.title`)}
      actions={
        <div role="group" aria-label={t(`${T}.title`)} className="flex gap-1">
          {(["revenue", "units"] as const).map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={by === option ? "default" : "outline"}
              aria-pressed={by === option}
              onClick={() => onBy(option)}
            >
              {t(option === "revenue" ? `${T}.byRevenue` : `${T}.byUnits`)}
            </Button>
          ))}
        </div>
      }
    >
      {error ? (
        <ErrorState message={t(`${D}.loadError`)} />
      ) : loading || !rows ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(`${T}.none`)}</p>
      ) : (
        <ShareBars
          rows={rows.map((r) => ({
            key: r.productId,
            label: r.archived ? `${r.name} (${t(`${T}.archived`)})` : r.name,
            value:
              by === "revenue" ? formatAmount(r.revenue, currency) : `${formatInt(r.units)} u.`,
            detail:
              by === "revenue" ? `${formatInt(r.units)} u.` : formatAmount(r.revenue, currency),
            percent: ((by === "revenue" ? r.revenue : r.units) / max) * 100,
          }))}
        />
      )}
      <Button asChild variant="outline" size="sm" className="mt-4">
        <Link to="/admin/reportes/productos">{t(`${T}.all`)}</Link>
      </Button>
    </SectionCard>
  );
}

function PaymentsCard({
  rows,
  loading,
  currency,
}: {
  rows: import("./types").PaymentMixRow[];
  loading: boolean;
  currency: string;
}) {
  const P = `${D}.payments` as const;
  const total = rows.reduce((sum, r) => sum + r.net, 0);
  return (
    <SectionCard id="payments" title={t(`${P}.title`)} description={t(`${P}.description`)}>
      {loading ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(`${P}.none`)}</p>
      ) : (
        <ShareBars
          rows={rows.map((r) => ({
            key: r.paymentMethod,
            label: paymentMethodLabel(r.paymentMethod),
            value: formatAmount(r.net, currency),
            detail: `${t(`${P}.orders`, { count: formatInt(r.orders) })} · ${formatPercent(shareOf(r.net, total))}`,
            percent: shareOf(r.net, total),
          }))}
        />
      )}
    </SectionCard>
  );
}

function FunnelCard({ funnel, loading }: { funnel: Funnel | undefined; loading: boolean }) {
  const F = `${D}.funnel` as const;
  const steps = funnel
    ? [
        { key: "carts", label: t(`${F}.carts`), value: funnel.carts },
        { key: "items", label: t(`${F}.cartsWithItems`), value: funnel.carts_with_items },
        { key: "orders", label: t(`${F}.orders`), value: funnel.orders },
        { key: "paid", label: t(`${F}.paid`), value: funnel.paid },
      ]
    : [];
  const first = Math.max(1, steps[0]?.value ?? 1);
  return (
    <SectionCard id="funnel" title={t(`${F}.title`)} description={t(`${F}.description`)}>
      {loading || !funnel ? (
        <LoadingState />
      ) : (
        <ShareBars
          rows={steps.map((s, i) => ({
            key: s.key,
            label: s.label,
            value: formatInt(s.value),
            detail:
              i === 0
                ? undefined
                : t(`${F}.ofPrevious`, {
                    pct: formatPercent(shareOf(s.value, steps[i - 1]?.value ?? 0)),
                  }),
            percent: (s.value / Math.max(first, ...steps.map((x) => x.value))) * 100,
          }))}
          className={cn(funnel.carts === 0 && "opacity-70")}
        />
      )}
    </SectionCard>
  );
}
