import { Link } from "react-router-dom";
import { t, type MessageKey } from "@/i18n";
import { ErrorState, LoadingState } from "../ui/StateViews";
import { SectionCard } from "../ui/PageHeader";
import { useAttention } from "./hooks";
import { formatDateTime, formatMoney, statusLabel } from "./logic";
import { ATTENTION_KINDS } from "./types";

const A = "admin.orders.attention" as const;

/**
 * «Atención requerida»: lo que el equipo no debería dejar pasar — pagos por revisar, pedidos sin confirmar hace demasiado,
 * contracargos, dinero por devolver o por cobrar, contra entrega sin cobrar, incidencias y devoluciones abiertas. Todo se deduce
 * de los datos (no hay una cola aparte que se desincronice) y cada fila lleva al pedido.
 */
export function AttentionPage() {
  const query = useAttention();
  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />;
  const items = query.data;
  if (items.length === 0) {
    return (
      <p className="rounded-lg border p-6 text-center text-muted-foreground" role="status">
        {t(`${A}.empty`)}
      </p>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t(`${A}.description`)}</p>
      {ATTENTION_KINDS.map((kind) => {
        const rows = items.filter((i) => i.kind === kind);
        if (rows.length === 0) return null;
        return (
          <SectionCard
            key={kind}
            id={kind}
            title={`${t(`${A}.kinds.${kind}` as MessageKey)} (${rows.length})`}
            description={t(`${A}.help.${kind}` as MessageKey)}
          >
            <ul className="divide-y text-sm">
              {rows.map((r) => (
                <li
                  key={`${r.kind}-${r.orderId}`}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <div className="min-w-0">
                    <Link
                      to={`/admin/pedidos/${r.orderId}`}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {r.number}
                    </Link>
                    <span className="text-muted-foreground">
                      {" "}
                      · {r.contactName} · {statusLabel(r.status)}
                    </span>
                  </div>
                  <div className="text-right tabular-nums text-muted-foreground">
                    {typeof r.detail.amount === "number" ? (
                      <span className="font-medium text-foreground">
                        {formatMoney(r.detail.amount, r.currency)}
                      </span>
                    ) : (
                      <span>{formatMoney(r.total, r.currency)}</span>
                    )}
                    <span className="block text-xs">
                      {t(`${A}.since`, { date: formatDateTime(r.since) })}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </SectionCard>
        );
      })}
    </div>
  );
}
