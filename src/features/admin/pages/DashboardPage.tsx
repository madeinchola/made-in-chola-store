import { Link } from "react-router-dom";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/useAuth";
import { PageHeader, SectionCard } from "../ui/PageHeader";
import { ErrorState, LoadingState } from "../ui/StateViews";
import { StockLightBadge } from "../ui/badges";
import { useStockAlertSummary, useStockAlertVariants } from "../stock/hooks";

function Counter({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`rounded-lg border p-4 ${tone}`}>
      <p className="text-3xl font-bold">{value}</p>
      <p className="text-sm">{label}</p>
    </div>
  );
}

/** Resumen del panel: lo que necesita atención hoy (alertas de stock) y accesos rápidos. */
export function DashboardPage() {
  const { profile } = useAuth();
  const summary = useStockAlertSummary();
  const variants = useStockAlertVariants();

  return (
    <>
      <PageHeader
        title={t("admin.title")}
        description={t("admin.dashboard.welcome", { name: profile?.full_name ?? "" })}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionCard id="alerts" title={t("admin.dashboard.alerts.title")}>
            {summary.isError ? (
              <ErrorState
                message={t("admin.dashboard.alerts.error")}
                onRetry={() => void summary.refetch()}
              />
            ) : summary.isPending ? (
              <LoadingState />
            ) : summary.data.total === 0 ? (
              <p className="text-sm text-muted-foreground">{t("admin.dashboard.alerts.none")}</p>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Counter
                    label={t("admin.dashboard.alerts.low")}
                    value={summary.data.low}
                    tone="border-amber-300 bg-amber-50"
                  />
                  <Counter
                    label={t("admin.dashboard.alerts.critical")}
                    value={summary.data.critical}
                    tone="border-red-300 bg-red-50"
                  />
                  <Counter
                    label={t("admin.dashboard.alerts.out")}
                    value={summary.data.out}
                    tone="border-red-400 bg-red-100"
                  />
                </div>
                <h3 className="mb-2 mt-6 text-sm font-semibold">
                  {t("admin.dashboard.alerts.variantsTitle")}
                </h3>
                {variants.isPending ? (
                  <LoadingState />
                ) : (
                  <ul className="divide-y rounded-lg border">
                    {(variants.data ?? []).map((v) => (
                      <li
                        key={v.variantId}
                        className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm"
                      >
                        <Link
                          to={`/admin/productos/${v.productId}`}
                          className="font-medium hover:underline"
                        >
                          {v.productName}
                        </Link>
                        <span className="text-muted-foreground">
                          {t("admin.dashboard.alerts.variantLine", {
                            color: v.colorName,
                            size: v.sizeLabel ?? t("admin.dashboard.alerts.noSize"),
                          })}
                        </span>
                        <span className="ml-auto flex items-center gap-2">
                          <span>{t("admin.dashboard.alerts.units", { count: v.stockOnHand })}</span>
                          <StockLightBadge light={v.light} />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <Button asChild variant="outline" size="sm" className="mt-4">
                  <Link to="/admin/productos?estado=publicados&stock=alert">
                    {t("admin.dashboard.alerts.seeAll")}
                  </Link>
                </Button>
              </>
            )}
          </SectionCard>
        </div>
        <SectionCard id="shortcuts" title={t("admin.dashboard.shortcuts.title")}>
          <div className="flex flex-col gap-2">
            <Button asChild>
              <Link to="/admin/productos/nuevo">{t("admin.dashboard.shortcuts.newProduct")}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/admin/productos">{t("admin.dashboard.shortcuts.products")}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/admin/ajustes">{t("admin.dashboard.shortcuts.settings")}</Link>
            </Button>
          </div>
        </SectionCard>
      </div>
    </>
  );
}
