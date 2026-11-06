import { useMemo, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { t } from "@/i18n";
import { toAppError } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ConflictBanner } from "../ui/ConflictBanner";
import { isStaleVersion } from "../lib/versioned";
import { createSlot, updateSlot } from "./api";
import { useInvalidateShipping, useShippingMutation } from "./hooks";
import {
  findSlotConflicts,
  slotRangeText,
  validateSlotForm,
  WEEKDAY_KEYS,
  WEEKDAYS,
  type SlotFieldProblem,
  type SlotFormErrors,
  type SlotFormValues,
  type Weekday,
} from "./SlotsLogic";
import type { DeliverySlot, ShippingMethod, SlotCreateInput, SlotUpdateInput } from "./types";

/** Qué abre el diálogo: una franja nueva (con su día ya elegido) o la edición de una existente. */
export type SlotTarget =
  { kind: "create"; weekday: Weekday } | { kind: "edit"; slot: DeliverySlot };

interface SlotsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: SlotTarget;
  method: ShippingMethod;
  /** Todas las franjas (para avisar de solapes con las del mismo día). */
  allSlots: readonly DeliverySlot[];
}

const FIELD = "h-11";

const initialValues = (target: SlotTarget): SlotFormValues =>
  target.kind === "edit"
    ? {
        weekday: target.slot.weekday,
        startTime: target.slot.startTime,
        endTime: target.slot.endTime,
        capacity: String(target.slot.capacity),
        isActive: target.slot.isActive,
      }
    : { weekday: target.weekday, startTime: "", endTime: "", capacity: "", isActive: true };

const problemText = (problem: SlotFieldProblem): string =>
  t(`admin.shipping.delivery.slots.form.errors.${problem}`);

function SlotForm({
  target,
  method,
  allSlots,
  onClose,
}: Omit<SlotsDialogProps, "open" | "onOpenChange"> & { onClose: () => void }) {
  const editing = target.kind === "edit" ? target.slot : null;
  const [values, setValues] = useState<SlotFormValues>(() => initialValues(target));
  const [errors, setErrors] = useState<SlotFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);

  const invalidate = useInvalidateShipping();
  const create = useShippingMutation((input: SlotCreateInput) => createSlot(input));
  const update = useShippingMutation((v: { slot: DeliverySlot; input: SlotUpdateInput }) =>
    updateSlot(v.slot.id, v.slot.updatedAt, v.input),
  );

  const set = <K extends keyof SlotFormValues>(key: K, value: SlotFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  // Los choques se calculan al escribir: el solape es un AVISO que se ve antes de guardar; la misma hora de inicio bloquea.
  const conflicts = useMemo(
    () =>
      findSlotConflicts(
        {
          ...(editing ? { id: editing.id } : {}),
          methodId: method.id,
          weekday: values.weekday,
          startTime: values.startTime,
          endTime: values.endTime,
          isActive: values.isActive,
        },
        allSlots,
      ),
    [
      editing,
      method.id,
      values.weekday,
      values.startTime,
      values.endTime,
      values.isActive,
      allSlots,
    ],
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current) return;
    setFormError(null);
    setConflict(false);
    const result = validateSlotForm(values, conflicts);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    busy.current = true;
    setSaving(true);
    try {
      if (editing) await update.mutateAsync({ slot: editing, input: result.value });
      else
        await create.mutateAsync({
          methodId: method.id,
          weekday: values.weekday,
          ...result.value,
        });
      toast.success(
        editing
          ? t("admin.shipping.delivery.slots.toasts.updated")
          : t("admin.shipping.delivery.slots.toasts.created"),
      );
      onClose();
    } catch (e) {
      if (isStaleVersion(e)) setConflict(true);
      else setFormError(toAppError(e).message);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
      {conflict && (
        <ConflictBanner
          onReload={() => {
            onClose();
            void invalidate();
          }}
        />
      )}
      {formError && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {formError}
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        {t("admin.shipping.delivery.slots.form.method", { name: method.name })}
      </p>
      {editing ? (
        <p className="text-sm">
          <span className="font-medium">
            {t("admin.shipping.delivery.slots.form.weekdayFixed", {
              day: t(
                `admin.shipping.delivery.weekdays.${WEEKDAY_KEYS[editing.weekday as Weekday]}`,
              ),
            })}
          </span>
          <span className="block text-xs text-muted-foreground">
            {t("admin.shipping.delivery.slots.form.weekdayFixedHint")}
          </span>
        </p>
      ) : (
        <Field label={t("admin.shipping.delivery.slots.form.weekday")}>
          <Select
            className={FIELD}
            value={String(values.weekday)}
            onChange={(e) => set("weekday", Number(e.target.value))}
          >
            {WEEKDAYS.map((day) => (
              <option key={day} value={day}>
                {t(`admin.shipping.delivery.weekdays.${WEEKDAY_KEYS[day]}`)}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t("admin.shipping.delivery.slots.form.start")}
          {...(errors.startTime ? { error: problemText(errors.startTime) } : {})}
        >
          <Input
            type="time"
            step={60}
            className={FIELD}
            value={values.startTime}
            onChange={(e) => set("startTime", e.target.value)}
          />
        </Field>
        <Field
          label={t("admin.shipping.delivery.slots.form.end")}
          {...(errors.endTime ? { error: problemText(errors.endTime) } : {})}
        >
          <Input
            type="time"
            step={60}
            className={FIELD}
            value={values.endTime}
            onChange={(e) => set("endTime", e.target.value)}
          />
        </Field>
      </div>
      <div role="status">
        {conflicts.overlaps.length > 0 && (
          <p className="rounded-md border border-warning/50 bg-warning-soft p-3 text-sm text-warning">
            {t("admin.shipping.delivery.slots.form.overlap", {
              ranges: conflicts.overlaps.map(slotRangeText).join(", "),
            })}
          </p>
        )}
      </div>
      <Field
        label={t("admin.shipping.delivery.slots.form.capacity")}
        hint={t("admin.shipping.delivery.slots.form.capacityHint")}
        {...(errors.capacity ? { error: problemText(errors.capacity) } : {})}
      >
        <Input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          className={FIELD}
          value={values.capacity}
          onChange={(e) => set("capacity", e.target.value)}
        />
      </Field>
      <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          className="h-5 w-5"
          checked={values.isActive}
          onChange={(e) => set("isActive", e.target.checked)}
        />
        {t("admin.shipping.delivery.slots.form.active")}
      </label>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          className={FIELD}
          disabled={saving}
          onClick={onClose}
        >
          {t("admin.actions.cancel")}
        </Button>
        <Button type="submit" className={FIELD} loading={saving}>
          {saving
            ? t("admin.shipping.delivery.slots.form.submitting")
            : t("admin.shipping.delivery.slots.form.submit")}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Diálogo de alta/edición de una franja. El formulario vive dentro del contenido: se reinicia cada vez que se abre. */
export function SlotsDialog({ open, onOpenChange, target, method, allSlots }: SlotsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {target.kind === "edit"
              ? t("admin.shipping.delivery.slots.form.editTitle")
              : t("admin.shipping.delivery.slots.form.createTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("admin.shipping.delivery.slots.form.description")}
          </DialogDescription>
        </DialogHeader>
        <SlotForm
          target={target}
          method={method}
          allSlots={allSlots}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
