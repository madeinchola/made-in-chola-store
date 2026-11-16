import { useState } from "react";
import { Link } from "react-router-dom";
import { t, type MessageKey } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "../ui/DataTable";
import { EmptyState } from "../ui/StateViews";
import { AddBlacklistDialog, LiftBlacklistDialog } from "./ActionDialogs";
import { useBlacklist } from "./hooks";
import { formatDateTime } from "./logic";
import type { BlacklistRow } from "./types";

const B = "admin.orders.blacklist" as const;

const labelOf = (b: BlacklistRow): string =>
  b.kind === "profile" ? (b.profileName ?? t(`${B}.kinds.profile`)) : (b.phone ?? b.email ?? "");

/**
 * Lista negra (S-07): bloquea la contra entrega y los pedidos manuales de una cuenta, un teléfono o un correo; el resto de la
 * cuenta sigue funcionando. Quien abre otra cuenta con el mismo teléfono o correo queda bloqueado igual. Cada alta y cada baja
 * piden un motivo y quedan en la auditoría.
 */
export function BlacklistPage() {
  const query = useBlacklist();
  const [showAll, setShowAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const [lifting, setLifting] = useState<BlacklistRow | null>(null);
  const [status, setStatus] = useState("");
  const rows = (query.data ?? []).filter((b) => showAll || b.isActive);

  const columns: Column<BlacklistRow>[] = [
    {
      id: "kind",
      header: t(`${B}.columns.kind`),
      cell: (r) => t(`${B}.kinds.${r.kind}` as MessageKey),
    },
    {
      id: "who",
      header: t(`${B}.columns.who`),
      cell: (r) => <span className="break-words">{labelOf(r)}</span>,
    },
    {
      id: "reason",
      header: t(`${B}.columns.reason`),
      cell: (r) => <span className="block min-w-[10rem] break-words">{r.reason}</span>,
    },
    {
      id: "order",
      header: t(`${B}.columns.order`),
      cell: (r) =>
        r.sourceOrderId ? (
          <Link to={`/admin/pedidos/${r.sourceOrderId}`} className="underline underline-offset-2">
            {t(`${B}.viewOrder`)}
          </Link>
        ) : (
          "—"
        ),
    },
    {
      id: "date",
      header: t(`${B}.columns.date`),
      cell: (r) => <span className="whitespace-nowrap">{formatDateTime(r.createdAt)}</span>,
    },
    {
      id: "state",
      header: t(`${B}.columns.state`),
      cell: (r) =>
        r.isActive ? (
          <Badge tone="danger">{t(`${B}.active`)}</Badge>
        ) : (
          <span className="text-muted-foreground">
            {t(`${B}.liftedOn`, { date: formatDateTime(r.liftedAt) })}
          </span>
        ),
    },
    {
      id: "actions",
      header: <span className="sr-only">{t(`${B}.columns.actions`)}</span>,
      cell: (r) =>
        r.isActive ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label={t(`${B}.liftLabel`, { name: labelOf(r) })}
            onClick={() => setLifting(r)}
          >
            {t(`${B}.lift`)}
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
      <p className="text-sm text-muted-foreground">{t(`${B}.description`)}</p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={showAll}
            onChange={(event) => setShowAll(event.target.checked)}
          />
          {t(`${B}.showAll`)}
        </label>
        <Button type="button" className="min-h-11" onClick={() => setAdding(true)}>
          {t(`${B}.addButton`)}
        </Button>
      </div>
      <DataTable
        caption={t(`${B}.caption`)}
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        loading={query.isPending}
        error={query.isError}
        onRetry={() => void query.refetch()}
        empty={<EmptyState>{t(`${B}.empty`)}</EmptyState>}
      />
      {adding && (
        <AddBlacklistDialog
          preset={null}
          onOpenChange={(open) => !open && setAdding(false)}
          onDone={setStatus}
        />
      )}
      {lifting && (
        <LiftBlacklistDialog
          entryId={lifting.id}
          label={labelOf(lifting)}
          onOpenChange={(open) => !open && setLifting(null)}
          onDone={setStatus}
        />
      )}
    </div>
  );
}
