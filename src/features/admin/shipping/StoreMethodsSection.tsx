import { useState } from "react";
import { toast } from "sonner";
import { t } from "@/i18n";
import { toAppError } from "@/lib/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { ConflictBanner } from "../ui/ConflictBanner";
import { DataTable, type Column } from "../ui/DataTable";
import { SectionCard } from "../ui/PageHeader";
import { EmptyState } from "../ui/StateViews";
import { isStaleVersion } from "../lib/versioned";
import { setMethodArchived } from "./api";
import { useInvalidateShipping, useLocations, useMethods, useShippingMutation } from "./hooks";
import { StoreMethodDialog } from "./StoreMethodDialog";
import { archivedLast } from "./storeLocationLogic";
import {
  etaLabel,
  isBaseDeliveryMethod,
  methodStatus,
  pickupProblem,
  type MethodStatus,
} from "./storeMethodLogic";
import type { ShippingMethod } from "./types";

const STATUS_TONE = {
  active: "success",
  inactive: "warning",
  archived: "neutral",
} as const satisfies Record<MethodStatus, string>;

const rowAction = (action: string, name: string) =>
  t("admin.shipping.store.rowAction", { action, name });

const ROW_BUTTON = "min-h-11";

/**
 * Métodos de envío: lista con tipo, código, plazo, estado y orden; alta, edición, archivar y restaurar. El código y el tipo
 * no se editan. Archivar el método base de domicilio avisa de que sin él no hay envíos a domicilio.
 */
export function StoreMethodsSection() {
  const methods = useMethods();
  const locations = useLocations();
  const invalidate = useInvalidateShipping();
  const archive = useShippingMutation((v: { method: ShippingMethod; archived: boolean }) =>
    setMethodArchived(v.method.id, v.method.updatedAt, v.archived),
  );

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ShippingMethod | null>(null);
  const [toArchive, setToArchive] = useState<ShippingMethod | null>(null);
  const [conflict, setConflict] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);

  const rows = methods.data ?? [];
  const locationRows = locations.data ?? [];

  /** Un conflicto de edición NO se relanza: se muestra su aviso. Cualquier otro error se avisa y se relanza. */
  const run = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      setConflict(false);
      toast.success(success);
    } catch (e) {
      if (isStaleVersion(e)) {
        setConflict(true);
        return;
      }
      toast.error(toAppError(e).message);
      throw e;
    }
  };

  const restore = async (m: ShippingMethod) => {
    if (restoring !== null) return;
    setRestoring(m.id);
    try {
      await run(
        () => archive.mutateAsync({ method: m, archived: false }),
        t("admin.shipping.store.methods.toasts.restored"),
      );
    } catch {
      // ya se avisó con un mensaje
    } finally {
      setRestoring(null);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (m: ShippingMethod) => {
    setEditing(m);
    setDialogOpen(true);
  };

  const columns: Column<ShippingMethod>[] = [
    {
      id: "name",
      header: t("admin.shipping.store.methods.columns.name"),
      cell: (m) => (
        <div className="max-w-xs">
          <p className="break-words font-medium">{m.name}</p>
          {m.description && (
            <p className="break-words text-xs text-muted-foreground">{m.description}</p>
          )}
        </div>
      ),
    },
    {
      id: "kind",
      header: t("admin.shipping.store.methods.columns.kind"),
      cell: (m) => {
        const problem = locations.isSuccess ? pickupProblem(m, locationRows) : null;
        const place = locationRows.find((l) => l.id === m.pickupLocationId);
        return (
          <div className="max-w-xs">
            <p>{t(`admin.shipping.store.methods.kinds.${m.kind}`)}</p>
            {m.kind === "pickup" && locations.isSuccess && (
              <p className="break-words text-xs text-muted-foreground">
                {t("admin.shipping.store.methods.pickupAt", {
                  name: place?.name ?? t("admin.shipping.store.methods.unknownLocation"),
                })}
              </p>
            )}
            {problem !== null && (
              <p className="break-words text-xs text-warning">
                {t(`admin.shipping.store.methods.pickupProblem.${problem}`)}
              </p>
            )}
          </div>
        );
      },
    },
    {
      id: "code",
      header: t("admin.shipping.store.methods.columns.code"),
      cell: (m) => <span className="break-all font-mono text-xs">{m.code}</span>,
    },
    {
      id: "eta",
      header: t("admin.shipping.store.methods.columns.eta"),
      cell: (m) => (
        <span className="whitespace-nowrap">{etaLabel(m.etaMinDays, m.etaMaxDays)}</span>
      ),
    },
    {
      id: "order",
      header: t("admin.shipping.store.methods.columns.order"),
      cell: (m) => m.sortOrder,
    },
    {
      id: "state",
      header: t("admin.shipping.store.methods.columns.state"),
      cell: (m) => {
        const status = methodStatus(m);
        return (
          <Badge tone={STATUS_TONE[status]}>
            {t(`admin.shipping.store.methods.status.${status}`)}
          </Badge>
        );
      },
    },
    {
      id: "actions",
      header: t("admin.shipping.store.methods.columns.actions"),
      cell: (m) => (
        <div className="flex flex-wrap gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={ROW_BUTTON}
            aria-label={rowAction(t("admin.shipping.store.methods.actions.edit"), m.name)}
            onClick={() => openEdit(m)}
          >
            {t("admin.shipping.store.methods.actions.edit")}
          </Button>
          {m.archived ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={ROW_BUTTON}
              loading={restoring === m.id}
              aria-label={rowAction(t("admin.shipping.store.methods.actions.restore"), m.name)}
              onClick={() => void restore(m)}
            >
              {t("admin.shipping.store.methods.actions.restore")}
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={ROW_BUTTON}
              aria-label={rowAction(t("admin.shipping.store.methods.actions.archive"), m.name)}
              onClick={() => setToArchive(m)}
            >
              {t("admin.shipping.store.methods.actions.archive")}
            </Button>
          )}
        </div>
      ),
    },
  ];

  const archivingBase = toArchive !== null && isBaseDeliveryMethod(toArchive);

  return (
    <SectionCard
      id="methods"
      title={t("admin.shipping.store.methods.title")}
      description={t("admin.shipping.store.methods.description")}
      actions={
        <Button type="button" className={ROW_BUTTON} onClick={openCreate}>
          {t("admin.shipping.store.methods.new")}
        </Button>
      }
    >
      {conflict && (
        <div className="mb-4">
          <ConflictBanner
            onReload={() => {
              setConflict(false);
              void invalidate();
            }}
          />
        </div>
      )}
      <DataTable
        caption={t("admin.shipping.store.methods.title")}
        columns={columns}
        rows={archivedLast(rows)}
        getRowId={(m) => m.id}
        loading={methods.isPending}
        refreshing={methods.isFetching && !methods.isPending}
        error={methods.isError}
        onRetry={() => void methods.refetch()}
        empty={
          <EmptyState
            action={
              <Button type="button" className={ROW_BUTTON} onClick={openCreate}>
                {t("admin.shipping.store.methods.newFirst")}
              </Button>
            }
          >
            {t("admin.shipping.store.methods.empty")}
          </EmptyState>
        }
      />

      <StoreMethodDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        method={editing}
        locations={locationRows}
        locationsFailed={locations.isError}
        existingCodes={rows.map((m) => m.code)}
      />
      <ConfirmDialog
        open={toArchive !== null}
        onOpenChange={(open) => !open && setToArchive(null)}
        title={
          archivingBase
            ? t("admin.shipping.store.methods.confirmArchive.baseTitle")
            : t("admin.shipping.store.methods.confirmArchive.title")
        }
        description={
          archivingBase
            ? t("admin.shipping.store.methods.confirmArchive.baseBody", {
                name: toArchive.name,
              })
            : t("admin.shipping.store.methods.confirmArchive.body")
        }
        confirmLabel={
          archivingBase
            ? t("admin.shipping.store.methods.confirmArchive.baseConfirm")
            : t("admin.shipping.store.methods.confirmArchive.confirm")
        }
        destructive
        onConfirm={() =>
          run(
            () => archive.mutateAsync({ method: toArchive as ShippingMethod, archived: true }),
            t("admin.shipping.store.methods.toasts.archived"),
          )
        }
      />
    </SectionCard>
  );
}
