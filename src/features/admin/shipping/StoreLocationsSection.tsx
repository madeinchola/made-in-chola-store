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
import { setLocationArchived, setPrimaryLocation } from "./api";
import { useInvalidateShipping, useLocations, useMethods, useShippingMutation } from "./hooks";
import { StoreLocationDialog } from "./StoreLocationDialog";
import {
  archivedLast,
  canBecomeOrigin,
  currentOrigin,
  hasOriginCandidate,
  hasUsableOrigin,
  locationStatus,
  pickupMethodsUsing,
  type LocationStatus,
} from "./storeLocationLogic";
import type { StoreLocation } from "./types";

const STATUS_TONE = {
  active: "success",
  inactive: "warning",
  archived: "neutral",
} as const satisfies Record<LocationStatus, string>;

const rowAction = (action: string, name: string) =>
  t("admin.shipping.store.rowAction", { action, name });

const ROW_BUTTON = "min-h-11";

/**
 * Ubicaciones de la tienda: lista con su estado, cuál es el origen del envío, alta/edición, «usar como origen», archivar y
 * restaurar. Nada se borra. Avisa con claridad cuando no hay un origen (sin él no se cotiza ningún envío a domicilio).
 */
export function StoreLocationsSection() {
  const locations = useLocations();
  const methods = useMethods();
  const invalidate = useInvalidateShipping();
  const archive = useShippingMutation((v: { location: StoreLocation; archived: boolean }) =>
    setLocationArchived(v.location.id, v.location.updatedAt, v.archived),
  );
  const makeOrigin = useShippingMutation((id: string) => setPrimaryLocation(id));

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<StoreLocation | null>(null);
  const [toArchive, setToArchive] = useState<StoreLocation | null>(null);
  const [toOrigin, setToOrigin] = useState<StoreLocation | null>(null);
  const [conflict, setConflict] = useState(false);
  /** Acción rápida en curso (una a la vez): `origin:<id>` o `restore:<id>`. */
  const [pending, setPending] = useState<string | null>(null);

  const rows = locations.data ?? [];
  const methodRows = methods.data ?? [];
  const origin = currentOrigin(rows);

  /** Ejecuta, avisa del resultado y deja que el llamador sepa si falló. Un conflicto de edición NO se relanza: se muestra su aviso. */
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

  const quick = async (key: string, task: () => Promise<void>) => {
    if (pending !== null) return;
    setPending(key);
    try {
      await task();
    } catch {
      // ya se avisó con un mensaje
    } finally {
      setPending(null);
    }
  };

  const doOrigin = (l: StoreLocation): Promise<void> =>
    run(
      () => makeOrigin.mutateAsync(l.id),
      t("admin.shipping.store.locations.toasts.origin", { name: l.name }),
    );

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (l: StoreLocation) => {
    setEditing(l);
    setDialogOpen(true);
  };

  const columns: Column<StoreLocation>[] = [
    {
      id: "name",
      header: t("admin.shipping.store.locations.columns.name"),
      cell: (l) => (
        <div>
          <p className="break-words font-medium">{l.name}</p>
          {l.isPrimary && (
            <>
              <Badge tone="success" className="mt-1">
                {t("admin.shipping.store.locations.origin")}
              </Badge>
              <p id={`origin-note-${l.id}`} className="mt-1 max-w-xs text-xs text-muted-foreground">
                {t("admin.shipping.store.locations.primaryLocked")}
              </p>
            </>
          )}
        </div>
      ),
    },
    {
      id: "address",
      header: t("admin.shipping.store.locations.columns.address"),
      cell: (l) => (
        <div>
          <p className="break-words">{l.addressText}</p>
          <p className="text-xs text-muted-foreground">{l.city}</p>
        </div>
      ),
    },
    {
      id: "hours",
      header: t("admin.shipping.store.locations.columns.hours"),
      cell: (l) =>
        l.pickupHours ? (
          <span className="break-words">{l.pickupHours}</span>
        ) : (
          <span className="text-muted-foreground">
            {t("admin.shipping.store.locations.noHours")}
          </span>
        ),
    },
    {
      id: "state",
      header: t("admin.shipping.store.locations.columns.state"),
      cell: (l) => {
        const status = locationStatus(l);
        return (
          <Badge tone={STATUS_TONE[status]}>
            {t(`admin.shipping.store.locations.status.${status}`)}
          </Badge>
        );
      },
    },
    {
      id: "actions",
      header: t("admin.shipping.store.locations.columns.actions"),
      cell: (l) => (
        <div className="flex flex-wrap gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={ROW_BUTTON}
            aria-label={rowAction(t("admin.shipping.store.locations.actions.edit"), l.name)}
            onClick={() => openEdit(l)}
          >
            {t("admin.shipping.store.locations.actions.edit")}
          </Button>
          {canBecomeOrigin(l) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={ROW_BUTTON}
              loading={pending === `origin:${l.id}`}
              aria-label={rowAction(t("admin.shipping.store.locations.actions.makeOrigin"), l.name)}
              onClick={() => {
                if (origin) setToOrigin(l);
                else void quick(`origin:${l.id}`, () => doOrigin(l));
              }}
            >
              {t("admin.shipping.store.locations.actions.makeOrigin")}
            </Button>
          )}
          {l.archived ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={ROW_BUTTON}
              loading={pending === `restore:${l.id}`}
              aria-label={rowAction(t("admin.shipping.store.locations.actions.restore"), l.name)}
              onClick={() =>
                void quick(`restore:${l.id}`, () =>
                  run(
                    () => archive.mutateAsync({ location: l, archived: false }),
                    t("admin.shipping.store.locations.toasts.restored"),
                  ),
                )
              }
            >
              {t("admin.shipping.store.locations.actions.restore")}
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={ROW_BUTTON}
              // La principal no se archiva sin cambiar antes el origen: queda enfocable y explicada (no «disabled»).
              aria-disabled={l.isPrimary || undefined}
              aria-describedby={l.isPrimary ? `origin-note-${l.id}` : undefined}
              aria-label={rowAction(t("admin.shipping.store.locations.actions.archive"), l.name)}
              onClick={() => {
                if (!l.isPrimary) setToArchive(l);
              }}
            >
              {t("admin.shipping.store.locations.actions.archive")}
            </Button>
          )}
        </div>
      ),
    },
  ];

  const usedByArchive = toArchive ? pickupMethodsUsing(toArchive.id, methodRows) : [];

  return (
    <SectionCard
      id="locations"
      title={t("admin.shipping.store.locations.title")}
      description={t("admin.shipping.store.locations.description")}
      actions={
        <Button type="button" className={ROW_BUTTON} onClick={openCreate}>
          {t("admin.shipping.store.locations.new")}
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
      {locations.isSuccess && !hasUsableOrigin(rows) && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-warning/50 bg-warning-soft p-4 text-sm text-warning"
        >
          <p className="font-semibold">{t("admin.shipping.store.locations.noOrigin.title")}</p>
          <p className="mt-1">
            {hasOriginCandidate(rows)
              ? t("admin.shipping.store.locations.noOrigin.withCandidates")
              : t("admin.shipping.store.locations.noOrigin.withoutCandidates")}
          </p>
        </div>
      )}
      <DataTable
        caption={t("admin.shipping.store.locations.title")}
        columns={columns}
        rows={archivedLast(rows)}
        getRowId={(l) => l.id}
        loading={locations.isPending}
        refreshing={locations.isFetching && !locations.isPending}
        error={locations.isError}
        onRetry={() => void locations.refetch()}
        empty={
          <EmptyState
            action={
              <Button type="button" className={ROW_BUTTON} onClick={openCreate}>
                {t("admin.shipping.store.locations.newFirst")}
              </Button>
            }
          >
            {t("admin.shipping.store.locations.empty")}
          </EmptyState>
        }
      />

      <StoreLocationDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        location={editing}
        pickupMethods={editing ? pickupMethodsUsing(editing.id, methodRows) : []}
      />
      <ConfirmDialog
        open={toArchive !== null}
        onOpenChange={(open) => !open && setToArchive(null)}
        title={t("admin.shipping.store.locations.confirmArchive.title")}
        description={[
          t("admin.shipping.store.locations.confirmArchive.body"),
          usedByArchive.length > 0
            ? t("admin.shipping.store.locations.confirmArchive.usedBy", {
                names: usedByArchive.map((m) => m.name).join(", "),
              })
            : "",
        ]
          .filter(Boolean)
          .join(" ")}
        confirmLabel={t("admin.shipping.store.locations.confirmArchive.confirm")}
        destructive
        onConfirm={() =>
          run(
            () => archive.mutateAsync({ location: toArchive as StoreLocation, archived: true }),
            t("admin.shipping.store.locations.toasts.archived"),
          )
        }
      />
      <ConfirmDialog
        open={toOrigin !== null}
        onOpenChange={(open) => !open && setToOrigin(null)}
        title={t("admin.shipping.store.locations.confirmOrigin.title", {
          name: toOrigin?.name ?? "",
        })}
        description={t("admin.shipping.store.locations.confirmOrigin.body", {
          current: origin?.name ?? "",
        })}
        confirmLabel={t("admin.shipping.store.locations.confirmOrigin.confirm")}
        onConfirm={() => doOrigin(toOrigin as StoreLocation)}
      />
    </SectionCard>
  );
}
