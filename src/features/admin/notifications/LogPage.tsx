import { useState, type FormEvent } from "react";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "../ui/DataTable";
import { Pagination } from "../ui/Pagination";
import { EmptyState } from "../ui/StateViews";
import { NotificationDetailDialog } from "./NotificationDetailDialog";
import { useNotificationCounts, useNotifications } from "./hooks";
import {
  channelLabel,
  errorLabel,
  formatDateTime,
  statusLabel,
  statusTone,
  typeLabel,
} from "./logic";
import {
  DEFAULT_FILTERS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_STATUSES,
  NOTIFICATION_TYPES,
  PAGE_SIZE,
  type NotificationFilters,
  type NotificationRow,
  type NotificationStatus,
} from "./types";

const L = "admin.notifications.log" as const;

/** El registro de avisos: qué se envió, a quién, cuándo y qué pasó; con filtros y las acciones sobre cada uno. */
export function LogPage() {
  const [filters, setFilters] = useState<NotificationFilters>(DEFAULT_FILTERS);
  const [searchText, setSearchText] = useState("");
  const [open, setOpen] = useState<NotificationRow | null>(null);
  const query = useNotifications(filters);
  const counts = useNotificationCounts();
  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const allCount = Object.values(counts.data ?? {}).reduce((a, b) => a + b, 0);

  const set = (patch: Partial<NotificationFilters>) =>
    setFilters({ ...filters, ...patch, page: patch.page ?? 0 });

  function onSearch(event: FormEvent) {
    event.preventDefault();
    set({ search: searchText });
  }

  const columns: Column<NotificationRow>[] = [
    {
      id: "when",
      header: t(`${L}.col.when`),
      cell: (r) => <span className="whitespace-nowrap">{formatDateTime(r.createdAt)}</span>,
    },
    { id: "type", header: t(`${L}.col.type`), cell: (r) => typeLabel(r.type) },
    { id: "channel", header: t(`${L}.col.channel`), cell: (r) => channelLabel(r.channel) },
    {
      id: "recipient",
      header: t(`${L}.col.recipient`),
      cell: (r) => <span className="break-all">{r.recipient ?? t(`${L}.admins`)}</span>,
    },
    {
      id: "order",
      header: t(`${L}.col.order`),
      cell: (r) => r.orderNumber ?? t("admin.none"),
    },
    {
      id: "status",
      header: t(`${L}.col.status`),
      cell: (r) => (
        <div className="space-y-1">
          <Badge tone={statusTone(r.status)}>{statusLabel(r.status)}</Badge>
          {r.lastError && r.status !== "sent" && (
            <p className="text-xs text-muted-foreground">{errorLabel(r.lastError)}</p>
          )}
        </div>
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">{t(`${L}.col.actions`)}</span>,
      cell: (r) => (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-11"
          aria-label={t(`${L}.openLabel`, { id: r.id, type: typeLabel(r.type) })}
          onClick={() => setOpen(r)}
        >
          {t(`${L}.open`)}
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div role="group" aria-label={t(`${L}.statusGroup`)} className="flex flex-wrap gap-2">
        {(["all", ...NOTIFICATION_STATUSES] as const).map((s) => {
          const count = s === "all" ? allCount : (counts.data?.[s] ?? 0);
          const active = filters.status === s;
          return (
            <button
              key={s}
              type="button"
              aria-pressed={active}
              onClick={() => set({ status: s as NotificationStatus | "all" })}
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
        <Field label={t(`${L}.type`)}>
          <Select value={filters.type} onChange={(event) => set({ type: event.target.value })}>
            <option value="all">{t(`${L}.all`)}</option>
            {NOTIFICATION_TYPES.map((type) => (
              <option key={type} value={type}>
                {typeLabel(type)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t(`${L}.channel`)}>
          <Select
            value={filters.channel}
            onChange={(event) =>
              set({ channel: event.target.value as NotificationFilters["channel"] })
            }
          >
            <option value="all">{t(`${L}.all`)}</option>
            {NOTIFICATION_CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                {channelLabel(channel)}
              </option>
            ))}
          </Select>
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
          }}
        >
          {t(`${L}.clear`)}
        </Button>
      </form>

      <DataTable
        caption={t(`${L}.caption`)}
        columns={columns}
        rows={rows}
        getRowId={(r) => String(r.id)}
        loading={query.isLoading}
        refreshing={query.isFetching && !query.isLoading}
        error={query.isError}
        onRetry={() => void query.refetch()}
        empty={<EmptyState>{t(`${L}.empty`)}</EmptyState>}
      />
      <Pagination
        page={filters.page + 1}
        pageSize={PAGE_SIZE}
        total={total}
        onPageChange={(page) => set({ page: page - 1 })}
      />

      <NotificationDetailDialog row={open} onClose={() => setOpen(null)} />
    </div>
  );
}
