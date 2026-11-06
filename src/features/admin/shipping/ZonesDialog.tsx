import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { LocationPicker } from "@/components/map/LocationPicker";
import { toPinText, type LatLng, type PinText } from "@/components/map/coords";
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
import { createZone, updateZone } from "./api";
import { useInvalidateShipping, useShippingMutation } from "./hooks";
import { RatesCheckbox } from "./RatesCheckbox";
import {
  initialZoneValues,
  toZoneUpdateInput,
  validateZone,
  type ZoneFormValues,
} from "./ZonesLogic";
import { ZonesCities } from "./ZonesCities";
import {
  latitudeProblemText,
  longitudeProblemText,
  radiusProblemText,
  zoneCitiesText,
  zoneNameText,
} from "./ZonesMessages";
import type { ShippingZone, ZoneCreateInput, ZoneKind } from "./types";

interface ZonesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = zona nueva. */
  zone: ShippingZone | null;
  /** El origen del envío (la ubicación principal): centro por defecto de una zona de radio nueva. */
  origin: LatLng | null;
}

const F = "admin.shipping.rates.zones.form" as const;

function ZoneForm({
  zone,
  origin,
  onClose,
}: {
  zone: ShippingZone | null;
  origin: LatLng | null;
  onClose: () => void;
}) {
  const [values, setValues] = useState<ZoneFormValues>(() => initialZoneValues(zone));
  // Mientras nadie toque el centro de una zona NUEVA, vale el origen (aunque llegue después de abrir el diálogo).
  const [centerTouched, setCenterTouched] = useState(false);
  const originText: PinText = toPinText(origin);
  const center = zone || centerTouched ? values.center : originText;
  const current: ZoneFormValues = { ...values, center };

  const [submitted, setSubmitted] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const invalidate = useInvalidateShipping();

  const save = useShippingMutation(async (payload: ZoneCreateInput) =>
    zone
      ? await updateZone(zone.id, zone.updatedAt, toZoneUpdateInput(payload))
      : await createZone(payload),
  );

  const validation = validateZone(current);
  const errors = submitted && !validation.ok ? validation.errors : {};

  // Tras un guardado fallido el foco va al primer campo con problema (quien usa teclado o lector no tiene que buscarlo).
  useEffect(() => {
    if (attempt > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [attempt]);

  const set = <K extends keyof ZoneFormValues>(key: K, value: ZoneFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (save.isPending) return;
    setFormError(null);
    setSubmitted(true);
    if (!validation.ok) {
      setAttempt((n) => n + 1);
      return;
    }
    try {
      await save.mutateAsync(validation.payload);
      toast.success(
        zone
          ? t("admin.shipping.rates.zones.toasts.updated")
          : t("admin.shipping.rates.zones.toasts.created"),
      );
      onClose();
    } catch (e) {
      if (isStaleVersion(e)) {
        setConflict(true);
        // La lista que está detrás se refresca: así, al recargar, ya muestra la versión de la otra persona.
        void invalidate();
      } else {
        setFormError(toAppError(e).message);
      }
    }
  };

  return (
    <form ref={formRef} onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
      {conflict && (
        <ConflictBanner
          onReload={() => {
            void invalidate();
            onClose();
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
      <Field
        label={t(`${F}.name`)}
        hint={t(`${F}.nameHint`)}
        error={errors.name ? zoneNameText(errors.name) : undefined}
      >
        <Input
          className="min-h-11"
          autoComplete="off"
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
        />
      </Field>

      {zone ? (
        <p className="text-sm text-muted-foreground">
          {t(`${F}.kindFixed`, { kind: t(`admin.shipping.rates.zones.kind.${zone.kind}`) })}
        </p>
      ) : (
        <Field label={t(`${F}.kind`)} hint={t(`${F}.kindHint`)}>
          <Select
            className="min-h-11"
            value={values.kind}
            onChange={(e) => set("kind", e.target.value as ZoneKind)}
          >
            <option value="city">{t("admin.shipping.rates.zones.kind.city")}</option>
            <option value="radius">{t("admin.shipping.rates.zones.kind.radius")}</option>
          </Select>
        </Field>
      )}

      {values.kind === "city" ? (
        <ZonesCities
          cities={values.cities}
          onChange={(cities) => set("cities", cities)}
          error={errors.cities ? zoneCitiesText(errors.cities) : undefined}
        />
      ) : (
        <div className="grid gap-4">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">{t(`${F}.center.legend`)}</h3>
            <p className="text-xs text-muted-foreground">
              {zone || origin ? t(`${F}.center.hint`) : t(`${F}.center.noOrigin`)}
            </p>
            <LocationPicker
              value={center}
              onChange={(next) => {
                setCenterTouched(true);
                set("center", next);
              }}
              errors={{
                lat: errors.lat ? latitudeProblemText(errors.lat) : undefined,
                lng: errors.lng ? longitudeProblemText(errors.lng) : undefined,
              }}
              center={origin ?? undefined}
            />
            {errors.center && (
              <p role="alert" className="text-xs text-destructive">
                {t(`${F}.errors.centerRequired`)}
              </p>
            )}
          </div>
          <Field
            label={t(`${F}.radius`)}
            hint={t(`${F}.radiusHint`)}
            error={errors.radius ? radiusProblemText(errors.radius) : undefined}
          >
            <Input
              className="min-h-11"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={values.radius}
              onChange={(e) => set("radius", e.target.value)}
            />
          </Field>
        </div>
      )}

      <RatesCheckbox
        label={t(`${F}.noService`)}
        hint={t(`${F}.noServiceHint`)}
        checked={values.noService}
        onChange={(checked) => set("noService", checked)}
      />
      <RatesCheckbox
        label={t(`${F}.active`)}
        hint={t(`${F}.activeHint`)}
        checked={values.isActive}
        onChange={(checked) => set("isActive", checked)}
      />

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={save.isPending}
          onClick={onClose}
        >
          {t("admin.actions.cancel")}
        </Button>
        <Button type="submit" className="min-h-11" loading={save.isPending} disabled={conflict}>
          {save.isPending ? t(`${F}.submitting`) : t(`${F}.submit`)}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Diálogo de alta/edición de una zona. El formulario vive dentro del contenido: se reinicia cada vez que se abre. */
export function ZonesDialog({ open, onOpenChange, zone, origin }: ZonesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl"
        // Un clic fuera (o sobre un aviso) no debe tirar a la basura lo escrito: se cierra con Cancelar, la X o Esc.
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{zone ? t(`${F}.editTitle`) : t(`${F}.createTitle`)}</DialogTitle>
          <DialogDescription>
            {zone ? t(`${F}.editDescription`) : t(`${F}.createDescription`)}
          </DialogDescription>
        </DialogHeader>
        <ZoneForm zone={zone} origin={origin} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
