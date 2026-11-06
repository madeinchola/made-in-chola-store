import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { LocationPicker } from "@/components/map/LocationPicker";
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
import { t } from "@/i18n";
import { DEFAULT_COUNTRY } from "@/lib/countries";
import { toAppError } from "@/lib/errors";
import { ConflictBanner } from "../ui/ConflictBanner";
import { isStaleVersion } from "../lib/versioned";
import { createLocation, updateLocation } from "./api";
import { useInvalidateShipping, useShippingMutation } from "./hooks";
import {
  locationToValues,
  validateLocation,
  type LocationErrors,
  type LocationFormValues,
} from "./storeLocationLogic";
import type { LocationInput, ShippingMethod, StoreLocation } from "./types";

interface StoreLocationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = ubicación nueva. */
  location: StoreLocation | null;
  /** Métodos de recojo que usan esta ubicación (avisa si se desactiva). */
  pickupMethods: readonly ShippingMethod[];
}

const CHECK_ROW = "flex min-h-11 items-center gap-2 text-sm font-medium";

function LocationForm({
  location,
  pickupMethods,
  onClose,
  onBusyChange,
}: {
  location: StoreLocation | null;
  pickupMethods: readonly ShippingMethod[];
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [values, setValues] = useState<LocationFormValues>(() => locationToValues(location));
  const [submitted, setSubmitted] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const savingRef = useRef(false);
  const invalidate = useInvalidateShipping();
  const activeNoteId = useId();

  const create = useShippingMutation((input: LocationInput) => createLocation(input));
  const update = useShippingMutation((v: { id: string; updatedAt: string; input: LocationInput }) =>
    updateLocation(v.id, v.updatedAt, v.input),
  );

  useEffect(() => {
    onBusyChange(saving);
    return () => onBusyChange(false);
  }, [saving, onBusyChange]);

  // Tras el primer intento de guardar, los errores siguen a lo que se escribe (el mensaje no queda viejo).
  const validation = useMemo(() => validateLocation(values), [values]);
  const errors: LocationErrors = submitted && !validation.ok ? validation.errors : {};

  // El primer campo inválido recibe el foco (en orden de pantalla) cuando sus errores ya están pintados.
  useEffect(() => {
    if (focusTick === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusTick]);

  const set = <K extends keyof LocationFormValues>(key: K, value: LocationFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const isOrigin = location?.isPrimary === true;
  const affected = pickupMethods.map((m) => m.name).join(", ");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (savingRef.current) return;
    setFormError(null);
    setSubmitted(true);
    if (!validation.ok) {
      setFocusTick((n) => n + 1);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      if (location) {
        await update.mutateAsync({
          id: location.id,
          updatedAt: location.updatedAt,
          input: validation.input,
        });
      } else {
        await create.mutateAsync(validation.input);
      }
      toast.success(
        location
          ? t("admin.shipping.store.locations.toasts.updated")
          : t("admin.shipping.store.locations.toasts.created"),
      );
      onClose();
    } catch (e) {
      if (isStaleVersion(e)) setConflict(true);
      else setFormError(toAppError(e).message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const reload = async () => {
    await invalidate();
    onClose();
  };

  return (
    <form ref={formRef} onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
      {conflict && <ConflictBanner onReload={() => void reload()} />}
      {formError && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {formError}
        </p>
      )}
      <Field
        label={t("admin.shipping.store.locations.form.name")}
        hint={t("admin.shipping.store.locations.form.nameHint")}
        error={errors.name}
      >
        <Input
          autoComplete="off"
          className="min-h-11"
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
        />
      </Field>
      <Field label={t("admin.shipping.store.locations.form.address")} error={errors.addressText}>
        <Input
          autoComplete="off"
          className="min-h-11"
          value={values.addressText}
          onChange={(e) => set("addressText", e.target.value)}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("admin.shipping.store.locations.form.city")} error={errors.city}>
          <Input
            autoComplete="off"
            className="min-h-11"
            value={values.city}
            onChange={(e) => set("city", e.target.value)}
          />
        </Field>
        <Field
          label={t("admin.shipping.store.locations.form.hours")}
          hint={t("admin.shipping.store.locations.form.hoursHint")}
          error={errors.pickupHours}
        >
          <Input
            autoComplete="off"
            className="min-h-11"
            value={values.pickupHours}
            onChange={(e) => set("pickupHours", e.target.value)}
          />
        </Field>
      </div>

      <p className="text-sm font-medium">{t("admin.shipping.store.locations.form.pinNote")}</p>
      <LocationPicker
        value={{ lat: values.lat, lng: values.lng }}
        onChange={(pin) => setValues((v) => ({ ...v, lat: pin.lat, lng: pin.lng }))}
        errors={{ lat: errors.lat, lng: errors.lng }}
        country={DEFAULT_COUNTRY}
      />

      <div>
        <label className={CHECK_ROW}>
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={values.isActive}
            disabled={isOrigin}
            aria-describedby={isOrigin ? activeNoteId : undefined}
            onChange={(e) => set("isActive", e.target.checked)}
          />
          {t("admin.shipping.store.locations.form.active")}
        </label>
        {isOrigin && (
          <p id={activeNoteId} className="text-xs text-muted-foreground">
            {t("admin.shipping.store.locations.form.activeLocked")}
          </p>
        )}
        {!values.isActive && !isOrigin && pickupMethods.length > 0 && (
          <p role="status" className="text-xs text-warning">
            {t("admin.shipping.store.locations.form.deactivateWarning", { names: affected })}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          aria-disabled={saving || undefined}
          onClick={() => {
            if (!saving) onClose();
          }}
        >
          {t("admin.actions.cancel")}
        </Button>
        <Button type="submit" className="min-h-11" loading={saving}>
          {saving
            ? t("admin.shipping.store.locations.form.submitting")
            : t("admin.shipping.store.locations.form.submit")}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * Diálogo de alta/edición de una ubicación. El formulario vive dentro del contenido: se monta al abrir y se desmonta al
 * cerrar, así que nunca arrastra lo escrito en otra ubicación. Mientras guarda no se puede cerrar.
 */
export function StoreLocationDialog({
  open,
  onOpenChange,
  location,
  pickupMethods,
}: StoreLocationDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {location
              ? t("admin.shipping.store.locations.form.editTitle")
              : t("admin.shipping.store.locations.form.createTitle")}
          </DialogTitle>
          <DialogDescription>{t("admin.shipping.store.locations.form.intro")}</DialogDescription>
        </DialogHeader>
        <LocationForm
          key={location?.id ?? "new"}
          location={location}
          pickupMethods={pickupMethods}
          onClose={() => onOpenChange(false)}
          onBusyChange={setBusy}
        />
      </DialogContent>
    </Dialog>
  );
}
