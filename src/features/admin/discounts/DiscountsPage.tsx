import { useMemo, useState } from "react";
import { toast } from "sonner";
import { t } from "@/i18n";
import { toAppError } from "@/lib/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCategoryOptions, useCollectionOptions } from "../products/hooks";
import { categoryPaths } from "../products/edit/categoryPaths";
import { isStaleVersion } from "../lib/versioned";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { DataTable, type Column } from "../ui/DataTable";
import { SectionCard } from "../ui/PageHeader";
import { EmptyState } from "../ui/StateViews";
import { setDiscountActive, setDiscountArchived } from "./api";
import { CouponsDialog } from "./CouponsDialog";
import { describeParts, describeScope, formatMoment, type DiscountNames } from "./describe";
import { DiscountDialog } from "./DiscountDialog";
import {
  useAllTargets,
  useDiscountMutation,
  useDiscounts,
  useDiscountUsage,
  useGroups,
  useInvalidateDiscounts,
} from "./hooks";
import { discountStatus, sortDiscounts } from "./status";
import type { Discount, DiscountStatus, DiscountTarget } from "./types";

const STATUS_TONE = {
  active: "success",
  scheduled: "info",
  exhausted: "warning",
  inactive: "warning",
  expired: "neutral",
  archived: "neutral",
} as const satisfies Record<DiscountStatus, string>;

const L = "admin.discounts.list" as const;

type Job =
  | { type: "active"; discount: Discount; value: boolean }
  | { type: "archive"; discount: Discount; value: boolean };

function validityText(d: Discount): string {
  const from = d.startsAt ? formatMoment(d.startsAt, true) : null;
  const to = d.endsAt ? formatMoment(d.endsAt, true) : null;
  if (from && to) return t(`${L}.validity.range`, { from, to });
  if (from) return t(`${L}.validity.from`, { date: from });
  if (to) return t(`${L}.validity.until`, { date: to });
  return t(`${L}.validity.always`);
}

/**
 * Listado de descuentos: lo que hace cada uno en lenguaje claro, su alcance, vigencia, usos y estado de HOY. Los que
 * funcionan van primero y los archivados al final. Alta y edición en un asistente; archivar pide confirmación.
 */
export function DiscountsPage() {
  const discounts = useDiscounts();
  const usage = useDiscountUsage();
  const targets = useAllTargets();
  const categories = useCategoryOptions();
  const collections = useCollectionOptions();
  const groups = useGroups();
  const invalidate = useInvalidateDiscounts();
  const mutation = useDiscountMutation((job: Job) =>
    job.type === "active"
      ? setDiscountActive(job.discount.id, job.discount.updatedAt, job.value)
      : setDiscountArchived(job.discount.id, job.discount.updatedAt, job.value),
  );

  const [editing, setEditing] = useState<Discount | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toArchive, setToArchive] = useState<Discount | null>(null);
  const [codesFor, setCodesFor] = useState<Discount | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // "Ahora" se fija al recibir datos: el estado de cada descuento se calcula con las mismas reglas que el servidor.
  const now = useMemo(() => new Date(), [discounts.dataUpdatedAt, usage.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const usageById = useMemo(
    () => new Map((usage.data ?? []).map((u) => [u.discountId, u])),
    [usage.data],
  );
  const statusOf = (d: Discount) => discountStatus(d, usageById.get(d.id), now);
  const rows = useMemo(
    () => sortDiscounts(discounts.data ?? [], statusOf),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [discounts.data, usageById, now],
  );

  const targetsByDiscount = useMemo(() => {
    const map = new Map<string, DiscountTarget[]>();
    for (const target of targets.data ?? []) {
      map.set(target.discountId, [...(map.get(target.discountId) ?? []), target]);
    }
    return map;
  }, [targets.data]);
  const categoryNames = useMemo(() => categoryPaths(categories.data ?? []), [categories.data]);
  const collectionNames = useMemo(
    () => new Map((collections.data ?? []).map((c) => [c.id, c.name])),
    [collections.data],
  );
  const groupNames = useMemo(
    () => new Map((groups.data ?? []).map((g) => [g.id, g.name])),
    [groups.data],
  );

  /** Los nombres que el listado conoce. Los productos se resumen por cantidad (no se leen sus nombres aquí). */
  const namesFor = (d: Discount): DiscountNames => {
    const group = d.customerGroupId ? (groupNames.get(d.customerGroupId) ?? null) : null;
    if (d.scope === "order") return { targets: [], group };
    if (!targets.data) return { targets: null, group };
    const mine = targetsByDiscount.get(d.id) ?? [];
    if (d.scope === "product") return { targets: [], targetCount: mine.length, group };
    const names = mine.flatMap((x) => {
      const name =
        d.scope === "category"
          ? categoryNames.get(x.categoryId ?? "")
          : collectionNames.get(x.collectionId ?? "");
      return name ? [name] : [];
    });
    return { targets: names, targetCount: mine.length, group };
  };

  const run = async (job: Job, success: string) => {
    setBusyId(job.discount.id);
    try {
      await mutation.mutateAsync(job);
      toast.success(success);
    } catch (e) {
      toast.error(isStaleVersion(e) ? t("admin.conflict.body") : toAppError(e).message);
      // Si alguien cambió el descuento, la lista debe mostrar ya la versión nueva.
      void invalidate();
      throw e;
    } finally {
      setBusyId(null);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (d: Discount) => {
    setEditing(d);
    setDialogOpen(true);
  };

  const columns: Column<Discount>[] = [
    {
      id: "discount",
      header: t(`${L}.columns.discount`),
      cell: (d) => (
        <div className="min-w-[10rem]">
          <p className="break-words font-medium">{d.name}</p>
          <p className="text-xs text-muted-foreground">
            {t(`${L}.kind.${d.kind}`)} ·{" "}
            {d.requiresCoupon ? t(`${L}.mode.coupon`) : t(`${L}.mode.automatic`)}
          </p>
        </div>
      ),
    },
    {
      id: "effect",
      header: t(`${L}.columns.effect`),
      cell: (d) => {
        if (d.params === null) {
          return (
            <p className="max-w-sm break-words text-warning">
              <Badge tone="warning" className="mr-2">
                {t(`${L}.invalidParams.badge`)}
              </Badge>
              {t(`${L}.invalidParams.body`)}
            </p>
          );
        }
        const parts = describeParts(d, namesFor(d));
        return (
          <div className="min-w-[15rem] max-w-sm">
            <p className="break-words">{parts.effect}</p>
            {parts.details.length > 0 && (
              <p className="mt-1 break-words text-xs text-muted-foreground">
                {parts.details.join(t(`${L}.describe.separator`))}
              </p>
            )}
          </div>
        );
      },
    },
    {
      id: "scope",
      header: t(`${L}.columns.scope`),
      cell: (d) => <span className="break-words">{describeScope(d, namesFor(d))}</span>,
    },
    {
      id: "validity",
      header: t(`${L}.columns.validity`),
      cell: (d) => (
        <div className="min-w-[8rem]">
          <p>{validityText(d)}</p>
          {(d.startsAt || d.endsAt) && (
            <p className="text-xs text-muted-foreground">{t(`${L}.validity.timezone`)}</p>
          )}
        </div>
      ),
    },
    {
      id: "usage",
      header: t(`${L}.columns.usage`),
      cell: (d) => {
        if (usage.isError && !usage.data) return t("admin.none");
        const used = usageById.get(d.id)?.used ?? 0;
        return d.usageLimitTotal !== null
          ? t(`${L}.usage.of`, { used, limit: d.usageLimitTotal })
          : t(`${L}.usage.plain`, { used });
      },
    },
    {
      id: "state",
      header: t(`${L}.columns.state`),
      cell: (d) => {
        const status = statusOf(d);
        return <Badge tone={STATUS_TONE[status]}>{t(`${L}.status.${status}`)}</Badge>;
      },
    },
    {
      id: "actions",
      header: t(`${L}.columns.actions`),
      cell: (d) => (
        <div className="flex min-w-[11rem] flex-wrap gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-11"
            aria-label={t(`${L}.editNamed`, { name: d.name })}
            onClick={() => openEdit(d)}
          >
            {t("admin.actions.edit")}
          </Button>
          {!d.archived && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11"
              loading={busyId === d.id}
              aria-label={t(d.isActive ? `${L}.deactivateNamed` : `${L}.activateNamed`, {
                name: d.name,
              })}
              onClick={() =>
                void run(
                  { type: "active", discount: d, value: !d.isActive },
                  t(d.isActive ? `${L}.toasts.deactivated` : `${L}.toasts.activated`),
                ).catch(() => undefined)
              }
            >
              {t(d.isActive ? `${L}.actions.deactivate` : `${L}.actions.activate`)}
            </Button>
          )}
          {d.requiresCoupon && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11"
              aria-label={t(`${L}.codesNamed`, { name: d.name })}
              onClick={() => setCodesFor(d)}
            >
              {t(`${L}.actions.codes`)}
            </Button>
          )}
          {d.archived ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11"
              loading={busyId === d.id}
              aria-label={t(`${L}.restoreNamed`, { name: d.name })}
              onClick={() =>
                void run(
                  { type: "archive", discount: d, value: false },
                  t(`${L}.toasts.restored`),
                ).catch(() => undefined)
              }
            >
              {t("admin.actions.restore")}
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11"
              aria-label={t(`${L}.archiveNamed`, { name: d.name })}
              onClick={() => setToArchive(d)}
            >
              {t("admin.actions.archive")}
            </Button>
          )}
        </div>
      ),
    },
  ];

  const createButton = (label: string) => (
    <Button type="button" className="min-h-11" onClick={openCreate}>
      {label}
    </Button>
  );

  return (
    <SectionCard
      id="discounts"
      title={t(`${L}.title`)}
      description={t(`${L}.description`)}
      actions={createButton(t(`${L}.new`))}
    >
      {usage.isError && (
        <p role="status" className="mb-3 text-sm text-warning">
          {t(`${L}.usageError`)}
        </p>
      )}
      <DataTable
        caption={t(`${L}.title`)}
        columns={columns}
        rows={rows}
        getRowId={(d) => d.id}
        loading={discounts.isPending}
        refreshing={discounts.isFetching && !discounts.isPending}
        error={discounts.isError}
        onRetry={() => void discounts.refetch()}
        empty={
          <EmptyState action={createButton(t(`${L}.emptyAction`))}>{t(`${L}.empty`)}</EmptyState>
        }
      />
      <DiscountDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        discount={editing}
        onOpenCodes={setCodesFor}
      />
      <ConfirmDialog
        open={toArchive !== null}
        onOpenChange={(open) => !open && setToArchive(null)}
        title={t(`${L}.confirmArchive.title`, { name: toArchive?.name ?? "" })}
        description={t(`${L}.confirmArchive.body`)}
        confirmLabel={t(`${L}.confirmArchive.confirm`)}
        destructive
        onConfirm={() =>
          run(
            { type: "archive", discount: toArchive as Discount, value: true },
            t(`${L}.toasts.archived`),
          )
        }
      />
      {codesFor && (
        <CouponsDialog
          discount={codesFor}
          open
          onOpenChange={(open) => !open && setCodesFor(null)}
        />
      )}
    </SectionCard>
  );
}
