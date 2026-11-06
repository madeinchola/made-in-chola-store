import { useMemo, useState } from "react";
import { toast } from "sonner";
import { t } from "@/i18n";
import { toAppError } from "@/lib/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { DataTable, type Column } from "../ui/DataTable";
import { SectionCard } from "../ui/PageHeader";
import { EmptyState } from "../ui/StateViews";
import { isStaleVersion } from "../lib/versioned";
import { setZoneArchived } from "./api";
import {
  useInvalidateShipping,
  useLocations,
  useRates,
  useShippingMutation,
  useZones,
} from "./hooks";
import type { ShippingZone } from "./types";
import { ZonesDialog } from "./ZonesDialog";
import {
  hasCoverage,
  sortZones,
  zoneArchiveImpact,
  zoneStatus,
  zoneSummary,
  type ZoneStatus,
} from "./ZonesLogic";

const STATUS_TONE = {
  active: "success",
  inactive: "warning",
  archived: "neutral",
} as const satisfies Record<ZoneStatus, string>;

const Z = "admin.shipping.rates.zones" as const;

/** Zonas de cobertura: lista con su servicio y estado, alta y edición en un diálogo, archivar y restaurar. */
export function ShippingZonesPage() {
  const zones = useZones();
  const rates = useRates();
  const locations = useLocations();
  const invalidate = useInvalidateShipping();
  const archive = useShippingMutation((v: { zone: ShippingZone; archived: boolean }) =>
    setZoneArchived(v.zone.id, v.zone.updatedAt, v.archived),
  );

  const [editing, setEditing] = useState<ShippingZone | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toArchive, setToArchive] = useState<ShippingZone | null>(null);

  const origin = useMemo(() => {
    const primary = locations.data?.find((l) => l.isPrimary && l.isActive && !l.archived);
    return primary ? { lat: primary.lat, lng: primary.lng } : null;
  }, [locations.data]);
  const rows = useMemo(() => sortZones(zones.data ?? []), [zones.data]);

  const run = async (zone: ShippingZone, archived: boolean, success: string) => {
    try {
      await archive.mutateAsync({ zone, archived });
      toast.success(success);
    } catch (e) {
      toast.error(isStaleVersion(e) ? t("admin.conflict.body") : toAppError(e).message);
      // Si alguien cambió la zona, la lista debe mostrar ya la versión nueva.
      void invalidate();
      throw e;
    }
  };

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (zone: ShippingZone) => {
    setEditing(zone);
    setDialogOpen(true);
  };

  const archiveDescription = (zone: ShippingZone): string => {
    const impact = zoneArchiveImpact(zone, zones.data ?? [], rates.data ?? []);
    return [
      t(`${Z}.confirmArchive.body`),
      impact.rules === 1 ? t(`${Z}.confirmArchive.rulesOne`) : null,
      impact.rules > 1 ? t(`${Z}.confirmArchive.rulesMany`, { count: impact.rules }) : null,
      impact.lastCoverage ? t(`${Z}.confirmArchive.lastCoverage`) : null,
    ]
      .filter((part) => part !== null)
      .join(" ");
  };

  const columns: Column<ShippingZone>[] = [
    {
      id: "zone",
      header: t(`${Z}.columns.zone`),
      cell: (z) => (
        <div className="min-w-[10rem]">
          <p className="break-words font-medium">{z.name}</p>
          <p className="text-xs text-muted-foreground">{t(`${Z}.kind.${z.kind}`)}</p>
        </div>
      ),
    },
    {
      id: "coverage",
      header: t(`${Z}.columns.coverage`),
      cell: (z) => <p className="max-w-xs break-words">{zoneSummary(z)}</p>,
    },
    {
      id: "service",
      header: t(`${Z}.columns.service`),
      cell: (z) =>
        z.allowed ? (
          <Badge tone="success">{t(`${Z}.service.allowed`)}</Badge>
        ) : (
          <Badge tone="danger">{t(`${Z}.service.blocked`)}</Badge>
        ),
    },
    {
      id: "state",
      header: t(`${Z}.columns.state`),
      cell: (z) => {
        const status = zoneStatus(z);
        return <Badge tone={STATUS_TONE[status]}>{t(`${Z}.status.${status}`)}</Badge>;
      },
    },
    {
      id: "actions",
      header: t(`${Z}.columns.actions`),
      cell: (z) => (
        <div className="flex flex-wrap gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-11"
            aria-label={t(`${Z}.editNamed`, { name: z.name })}
            onClick={() => openEdit(z)}
          >
            {t("admin.actions.edit")}
          </Button>
          {z.archived ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11"
              aria-label={t(`${Z}.restoreNamed`, { name: z.name })}
              onClick={() => void run(z, false, t(`${Z}.toasts.restored`)).catch(() => undefined)}
            >
              {t("admin.actions.restore")}
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11"
              aria-label={t(`${Z}.archiveNamed`, { name: z.name })}
              onClick={() => setToArchive(z)}
            >
              {t("admin.actions.archive")}
            </Button>
          )}
        </div>
      ),
    },
  ];

  const newButton = (
    <Button type="button" className="min-h-11" onClick={openCreate}>
      {t(`${Z}.new`)}
    </Button>
  );

  return (
    <SectionCard
      id="zones"
      title={t(`${Z}.title`)}
      description={t(`${Z}.description`)}
      actions={newButton}
    >
      <p className="mb-4 text-sm">{t(`${Z}.combine`)}</p>
      {zones.isSuccess && zones.data.length > 0 && !hasCoverage(zones.data) && (
        <p
          role="status"
          className="mb-4 rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-warning"
        >
          {t(`${Z}.noCoverage`)}
        </p>
      )}
      <DataTable
        caption={t(`${Z}.title`)}
        columns={columns}
        rows={rows}
        getRowId={(z) => z.id}
        loading={zones.isPending}
        refreshing={zones.isFetching && !zones.isPending}
        error={zones.isError}
        onRetry={() => void zones.refetch()}
        empty={
          <EmptyState
            action={
              <Button type="button" className="min-h-11" onClick={openCreate}>
                {t(`${Z}.emptyAction`)}
              </Button>
            }
          >
            {t(`${Z}.empty`)}
          </EmptyState>
        }
      />

      <ZonesDialog open={dialogOpen} onOpenChange={setDialogOpen} zone={editing} origin={origin} />
      <ConfirmDialog
        open={toArchive !== null}
        onOpenChange={(open) => !open && setToArchive(null)}
        title={t(`${Z}.confirmArchive.title`, { name: toArchive?.name ?? "" })}
        description={toArchive ? archiveDescription(toArchive) : ""}
        confirmLabel={t(`${Z}.confirmArchive.confirm`)}
        destructive
        onConfirm={() => run(toArchive as ShippingZone, true, t(`${Z}.toasts.archived`))}
      />
    </SectionCard>
  );
}
