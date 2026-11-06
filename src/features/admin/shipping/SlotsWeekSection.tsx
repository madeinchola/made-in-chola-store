import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { t } from "@/i18n";
import { toAppError } from "@/lib/errors";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { ConflictBanner } from "../ui/ConflictBanner";
import { SectionCard } from "../ui/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "../ui/StateViews";
import { isStaleVersion } from "../lib/versioned";
import { setSlotArchived } from "./api";
import { useInvalidateShipping, useMethods, useShippingMutation, useSlots } from "./hooks";
import { SlotsDialog, type SlotTarget } from "./SlotsDialog";
import { groupSlotsByWeekday, slotRangeText, WEEKDAY_KEYS, type Weekday } from "./SlotsLogic";
import type { DeliverySlot } from "./types";

const TOUCH = "h-11";

const dayName = (weekday: Weekday) =>
  t(`admin.shipping.delivery.weekdays.${WEEKDAY_KEYS[weekday]}`);

function ActionButton(props: ButtonProps) {
  return <Button type="button" variant="ghost" size="sm" {...props} className={TOUCH} />;
}

function SlotRow({
  slot,
  weekday,
  onEdit,
  onArchive,
  onRestore,
}: {
  slot: DeliverySlot;
  weekday: Weekday;
  onEdit: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const range = slotRangeText(slot);
  const named = { range, day: dayName(weekday) };
  const status = slot.archived ? "archived" : slot.isActive ? "active" : "inactive";
  return (
    <li
      className={
        "flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border px-3 py-1" +
        (slot.archived ? " bg-muted/40" : "")
      }
    >
      <span className="font-medium tabular-nums">{range}</span>
      <span className="text-sm text-muted-foreground">
        {t("admin.shipping.delivery.slots.capacity", { n: slot.capacity })}
      </span>
      <Badge tone={status === "active" ? "success" : "neutral"}>
        {t(`admin.shipping.delivery.slots.status.${status}`)}
      </Badge>
      <div className="ml-auto flex flex-wrap gap-1">
        {slot.archived ? (
          <ActionButton
            aria-label={t("admin.shipping.delivery.slots.restoreNamed", named)}
            onClick={onRestore}
          >
            {t("admin.actions.restore")}
          </ActionButton>
        ) : (
          <>
            <ActionButton
              aria-label={t("admin.shipping.delivery.slots.editNamed", named)}
              onClick={onEdit}
            >
              {t("admin.actions.edit")}
            </ActionButton>
            <ActionButton
              aria-label={t("admin.shipping.delivery.slots.archiveNamed", named)}
              onClick={onArchive}
            >
              {t("admin.actions.archive")}
            </ActionButton>
          </>
        )}
      </div>
    </li>
  );
}

/** Franjas de entrega por día de la semana (lunes a domingo) del método de domicilio elegido: alta, edición, archivo. */
export function SlotsWeekSection() {
  const slots = useSlots();
  const methods = useMethods();
  const invalidate = useInvalidateShipping();
  const archive = useShippingMutation((v: { slot: DeliverySlot; archived: boolean }) =>
    setSlotArchived(v.slot.id, v.slot.updatedAt, v.archived),
  );

  const [methodId, setMethodId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [target, setTarget] = useState<SlotTarget>({ kind: "create", weekday: 1 });
  const [toArchive, setToArchive] = useState<DeliverySlot | null>(null);
  const [conflict, setConflict] = useState(false);

  const deliveryMethods = useMemo(
    () => (methods.data ?? []).filter((m) => m.kind === "delivery" && m.isActive && !m.archived),
    [methods.data],
  );
  // Si el método elegido ya no existe (otra persona lo archivó), se vuelve al primero en vez de quedar con uno fantasma.
  const method = deliveryMethods.find((m) => m.id === methodId) ?? deliveryMethods[0] ?? null;

  const week = useMemo(
    () =>
      method
        ? groupSlotsByWeekday(slots.data ?? [], method.id, { includeArchived: showArchived })
        : [],
    [slots.data, method, showArchived],
  );
  const archivedCount = useMemo(
    () => (slots.data ?? []).filter((s) => method && s.methodId === method.id && s.archived).length,
    [slots.data, method],
  );

  const openCreate = (weekday: Weekday) => {
    setTarget({ kind: "create", weekday });
    setDialogOpen(true);
  };
  const openEdit = (slot: DeliverySlot) => {
    setTarget({ kind: "edit", slot });
    setDialogOpen(true);
  };

  /** Archiva o restaura. Un conflicto de edición no es un error de la base: se muestra su aviso propio. */
  const run = async (slot: DeliverySlot, archived: boolean) => {
    try {
      await archive.mutateAsync({ slot, archived });
      toast.success(
        archived
          ? t("admin.shipping.delivery.slots.toasts.archived")
          : t("admin.shipping.delivery.slots.toasts.restored"),
      );
    } catch (e) {
      if (isStaleVersion(e)) {
        setConflict(true);
        return;
      }
      toast.error(toAppError(e).message);
      throw e;
    }
  };

  const loading = slots.isPending || methods.isPending;
  const failed = slots.isError || methods.isError;
  const retry = () => {
    if (slots.isError) void slots.refetch();
    if (methods.isError) void methods.refetch();
  };

  let body;
  if (failed) body = <ErrorState onRetry={retry} />;
  else if (loading) body = <LoadingState />;
  else if (!method) {
    body = (
      <EmptyState
        action={
          <Link
            to="/admin/envios"
            className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4"
          >
            {t("admin.shipping.delivery.slots.goToMethods")}
          </Link>
        }
      >
        {t("admin.shipping.delivery.slots.noMethods")}
      </EmptyState>
    );
  } else {
    body = (
      <div className="space-y-4">
        {conflict && (
          <ConflictBanner
            onReload={() => {
              setConflict(false);
              void invalidate();
            }}
          />
        )}
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          {deliveryMethods.length > 1 ? (
            <div className="w-full sm:w-72">
              <Field label={t("admin.shipping.delivery.slots.method")}>
                <Select
                  className={TOUCH}
                  value={method.id}
                  onChange={(e) => setMethodId(e.target.value)}
                >
                  {deliveryMethods.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          ) : (
            <p className="text-sm font-medium">
              {t("admin.shipping.delivery.slots.methodOnly", { name: method.name })}
            </p>
          )}
          {(archivedCount > 0 || showArchived) && (
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-5 w-5"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              {t("admin.shipping.delivery.slots.showArchived", { n: archivedCount })}
            </label>
          )}
        </div>
        <ul className="space-y-3">
          {week.map(({ weekday, slots: daySlots }) => {
            const headingId = `slots-day-${weekday}`;
            return (
              <li key={weekday}>
                <section aria-labelledby={headingId} className="rounded-lg border p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h3 id={headingId} className="font-display font-semibold">
                      {dayName(weekday)}
                    </h3>
                    <ActionButton
                      variant="outline"
                      aria-label={t("admin.shipping.delivery.slots.addForDayNamed", {
                        day: dayName(weekday),
                      })}
                      onClick={() => openCreate(weekday)}
                    >
                      {t("admin.shipping.delivery.slots.addForDay")}
                    </ActionButton>
                  </div>
                  {daySlots.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {t("admin.shipping.delivery.slots.none")}
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {daySlots.map((slot) => (
                        <SlotRow
                          key={slot.id}
                          slot={slot}
                          weekday={weekday}
                          onEdit={() => openEdit(slot)}
                          onArchive={() => setToArchive(slot)}
                          onRestore={() => void run(slot, false).catch(() => undefined)}
                        />
                      ))}
                    </ul>
                  )}
                </section>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <SectionCard
      id="delivery-slots"
      title={t("admin.shipping.delivery.slots.title")}
      description={t("admin.shipping.delivery.slots.description")}
      actions={
        method && (
          <Button type="button" className={TOUCH} onClick={() => openCreate(1)}>
            {t("admin.shipping.delivery.slots.new")}
          </Button>
        )
      }
    >
      {body}
      {method && (
        <SlotsDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          target={target}
          method={method}
          allSlots={slots.data ?? []}
        />
      )}
      <ConfirmDialog
        open={toArchive !== null}
        onOpenChange={(open) => !open && setToArchive(null)}
        title={t("admin.shipping.delivery.slots.confirmArchive.title")}
        description={t("admin.shipping.delivery.slots.confirmArchive.body")}
        confirmLabel={t("admin.shipping.delivery.slots.confirmArchive.confirm")}
        destructive
        onConfirm={() => run(toArchive as DeliverySlot, true)}
      />
    </SectionCard>
  );
}
