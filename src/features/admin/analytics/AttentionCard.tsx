import { Link } from "react-router-dom";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { SectionCard } from "../ui/PageHeader";
import { ErrorState, LoadingState } from "../ui/StateViews";
import { useAttentionSummary } from "../orders/hooks";

const A = "admin.analytics.dashboard.attention" as const;

/** Los pedidos que piden una decisión (pago en disputa, dinero por devolver, pedidos viejos): lo calcula S12, aquí solo se avisa. */
export function AttentionCard() {
  const summary = useAttentionSummary();
  const count = summary.data?.orders ?? 0;
  return (
    <SectionCard id="attention" title={t(`${A}.title`)}>
      {summary.isError ? (
        <ErrorState message={t(`${A}.error`)} onRetry={() => void summary.refetch()} />
      ) : summary.isPending ? (
        <LoadingState />
      ) : count === 0 ? (
        <p className="text-sm text-muted-foreground">{t(`${A}.none`)}</p>
      ) : (
        <>
          <p className="text-sm">{t(`${A}.some`, { count })}</p>
          <Button asChild variant="outline" size="sm" className="mt-3">
            <Link to="/admin/pedidos/atencion">{t(`${A}.open`)}</Link>
          </Button>
        </>
      )}
    </SectionCard>
  );
}
