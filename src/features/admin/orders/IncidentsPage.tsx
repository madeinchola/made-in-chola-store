import { useState } from "react";
import { Link } from "react-router-dom";
import { t, type MessageKey } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "../ui/DataTable";
import { EmptyState } from "../ui/StateViews";
import { UpdateIncidentDialog } from "./ActionDialogs";
import { useIncidents } from "./hooks";
import { formatDateTime, formatMoney } from "./logic";
import type { IncidentRow, IncidentStatus } from "./types";

const I = "admin.orders.incidents" as const;
const TONE = { open: "danger", investigating: "warning", resolved: "success" } as const;

/** Incidencias de entrega de todos los pedidos (perdido, dañado, dirección incorrecta, ausente, rechazado) con su seguimiento. */
export function IncidentsPage() {
  const query = useIncidents();
  const [filter, setFilter] = useState<IncidentStatus | "active" | "all">("active");
  const [target, setTarget] = useState<IncidentRow | null>(null);
  const [status, setStatus] = useState("");
  const rows = (query.data ?? []).filter((i) =>
    filter === "all" ? true : filter === "active" ? i.status !== "resolved" : i.status === filter,
  );

  const columns: Column<IncidentRow>[] = [
    {
      id: "order",
      header: t(`${I}.columns.order`),
      cell: (r) => (
        <Link
          to={`/admin/pedidos/${r.orderId}`}
          className="font-medium underline-offset-2 hover:underline"
        >
          {r.orderNumber}
        </Link>
      ),
    },
    { id: "client", header: t(`${I}.columns.client`), cell: (r) => r.contactName },
    {
      id: "type",
      header: t(`${I}.columns.type`),
      cell: (r) => t(`${I}.types.${r.type}` as MessageKey),
    },
    {
      id: "status",
      header: t(`${I}.columns.status`),
      cell: (r) => (
        <Badge tone={TONE[r.status]}>{t(`${I}.statuses.${r.status}` as MessageKey)}</Badge>
      ),
    },
    {
      id: "cost",
      header: t(`${I}.columns.cost`),
      cell: (r) =>
        r.costAssumed > 0
          ? `${formatMoney(r.costAssumed, "BOB")} · ${t(`${I}.bearers.${r.costBorneBy}` as MessageKey)}`
          : "—",
    },
    {
      id: "date",
      header: t(`${I}.columns.date`),
      cell: (r) => <span className="whitespace-nowrap">{formatDateTime(r.openedAt)}</span>,
    },
    {
      id: "actions",
      header: <span className="sr-only">{t(`${I}.columns.actions`)}</span>,
      cell: (r) =>
        r.status !== "resolved" ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setTarget(r)}>
            {t(`${I}.follow`)}
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
      <Field label={t(`${I}.filter`)}>
        <Select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
          <option value="active">{t(`${I}.filters.active`)}</option>
          <option value="all">{t(`${I}.filters.all`)}</option>
          <option value="resolved">{t(`${I}.statuses.resolved`)}</option>
        </Select>
      </Field>
      <DataTable
        caption={t(`${I}.caption`)}
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        loading={query.isPending}
        error={query.isError}
        onRetry={() => void query.refetch()}
        empty={<EmptyState>{t(`${I}.empty`)}</EmptyState>}
      />
      {target && (
        <UpdateIncidentDialog
          key={target.id}
          incident={target}
          onOpenChange={(open) => !open && setTarget(null)}
          onDone={setStatus}
        />
      )}
    </div>
  );
}
