import { Link } from "react-router-dom";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { SectionCard } from "../ui/PageHeader";
import { ErrorState, LoadingState } from "../ui/StateViews";
import { useInventorySummary } from "./hooks";
import { formatAmount, formatInt } from "./logic";

const I = "admin.analytics.dashboard.inventory" as const;

/** Lo que hay hoy en el taller: valor al costo, unidades y el semáforo de las variantes. */
export function InventoryCard() {
  const inventory = useInventorySummary();
  const data = inventory.data;
  return (
    <SectionCard id="inventory" title={t(`${I}.title`)} description={t(`${I}.description`)}>
      {inventory.isError ? (
        <ErrorState message={t(`${I}.error`)} onRetry={() => void inventory.refetch()} />
      ) : !data ? (
        <LoadingState />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t(`${I}.value`)}</p>
          <p className="text-2xl font-bold" data-testid="inventory-value">
            {formatAmount(data.value, data.currency)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t(`${I}.units`, { count: formatInt(data.units), variants: formatInt(data.variants) })}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <Light label={t(`${I}.ok`)} value={data.ok} />
            <Light label={t(`${I}.low`)} value={data.low} />
            <Light label={t(`${I}.critical`)} value={data.critical} />
            <Light label={t(`${I}.out`)} value={data.out} />
          </dl>
          {data.variants_without_cost > 0 && (
            <p className="mt-3 rounded-md border border-warning/40 bg-warning-soft p-2 text-xs">
              {t(`${I}.withoutCost`, { count: formatInt(data.variants_without_cost) })}
            </p>
          )}
          <Button asChild variant="outline" size="sm" className="mt-4">
            <Link to="/admin/reportes/inventario">{t(`${I}.reportLink`)}</Link>
          </Button>
        </>
      )}
    </SectionCard>
  );
}

function Light({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-2 rounded-md border px-2 py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-semibold tabular-nums">{formatInt(value)}</dd>
    </div>
  );
}
