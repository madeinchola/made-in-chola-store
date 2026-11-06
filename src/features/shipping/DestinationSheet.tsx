import { useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { LocationPicker } from "@/components/map/LocationPicker";
import type { CoordinateProblem, PinText } from "@/components/map/coords";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { DEFAULT_COUNTRY } from "@/lib/countries";
import { t } from "@/i18n";
import { checkPinForm } from "./destination";

/** Con qué se abre el formulario del mapa. */
export interface SheetContext {
  /** Nombre de la dirección guardada que se va a ubicar (si la hay). */
  label: string | null;
  addressId: string | null;
  city: string;
  pin: PinText;
}

export interface DestinationSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: SheetContext;
  onConfirm: (values: { lat: number; lng: number; city: string }) => void;
}

const pinMessage = (axis: "lat" | "lng", problem: CoordinateProblem | null): string | undefined => {
  if (problem === null) return undefined;
  if (problem === "missing") {
    return t(
      axis === "lat"
        ? "shipping.estimator.sheet.latMissing"
        : "shipping.estimator.sheet.lngMissing",
    );
  }
  if (problem === "format") return t("shipping.estimator.sheet.format");
  return t(
    axis === "lat" ? "shipping.estimator.sheet.latRange" : "shipping.estimator.sheet.lngRange",
  );
};

/**
 * Cajón con el mapa para marcar a dónde se envía (y la ciudad). Es un diálogo modal (foco atrapado, Esc cierra, el foco
 * vuelve a quien lo abrió) y vive en su propio fragmento: Leaflet solo se descarga cuando la clienta llega aquí. El pin
 * y la ciudad son OBLIGATORIOS (sin ellos no hay cotización); no se guardan en su cuenta.
 */
export default function DestinationSheet({
  open,
  onOpenChange,
  context,
  onConfirm,
}: DestinationSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        bodyClassName="p-6"
        closeClassName="right-2 top-2 flex h-11 w-11 items-center justify-center p-0"
      >
        <DestinationForm
          context={context}
          onCancel={() => onOpenChange(false)}
          onConfirm={onConfirm}
        />
      </SheetContent>
    </Sheet>
  );
}

/** El contenido solo existe con el cajón abierto: cada vez que se abre arranca con lo que le da `context`. */
function DestinationForm({
  context,
  onCancel,
  onConfirm,
}: {
  context: SheetContext;
  onCancel: () => void;
  onConfirm: DestinationSheetProps["onConfirm"];
}) {
  const [pin, setPin] = useState<PinText>(context.pin);
  const [city, setCity] = useState(context.city);
  const [submitted, setSubmitted] = useState(false);
  const cityRef = useRef<HTMLInputElement>(null);
  const pinErrorRef = useRef<HTMLParagraphElement>(null);

  const check = checkPinForm({ pin, city });
  const shown = submitted && !check.ok ? check : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    // `flushSync`: el aviso del punto (el destino del foco) solo existe cuando `submitted` ya se pintó; sin esto, en el primer
    // intento `pinErrorRef` aún es nulo y el foco se quedaba en el botón (el lector de pantalla no oía el error).
    flushSync(() => setSubmitted(true));
    if (check.ok) {
      onConfirm({ lat: check.lat, lng: check.lng, city: check.city });
      return;
    }
    // El foco va al primer problema (la ciudad está antes que el mapa; el aviso del pin, si no).
    if (check.city) cityRef.current?.focus();
    else pinErrorRef.current?.focus();
  };

  return (
    <>
      <SheetHeader className="pr-10">
        <SheetTitle>
          {context.label
            ? t("shipping.estimator.sheet.titleFor", { label: context.label })
            : t("shipping.estimator.sheet.title")}
        </SheetTitle>
        <SheetDescription>{t("shipping.estimator.sheet.description")}</SheetDescription>
      </SheetHeader>

      <form onSubmit={submit} noValidate className="mt-6 space-y-5">
        <Field
          label={t("shipping.estimator.sheet.city")}
          hint={t("shipping.estimator.sheet.cityHint")}
          error={shown?.city ? t("shipping.estimator.sheet.cityRequired") : undefined}
        >
          <Input
            ref={cityRef}
            value={city}
            onChange={(event) => setCity(event.target.value)}
            autoComplete="address-level2"
            maxLength={120}
          />
        </Field>

        {shown?.pin && (
          <p ref={pinErrorRef} role="alert" tabIndex={-1} className="text-sm text-destructive">
            {shown.pin === "none"
              ? t("shipping.estimator.sheet.pinRequired")
              : t("shipping.estimator.sheet.pinInvalid")}
          </p>
        )}

        <LocationPicker
          value={pin}
          onChange={setPin}
          errors={{
            lat: pinMessage("lat", shown?.lat ?? null),
            lng: pinMessage("lng", shown?.lng ?? null),
          }}
          country={DEFAULT_COUNTRY}
          hint={t("shipping.estimator.sheet.pickerHint")}
        />

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" className="min-h-11" onClick={onCancel}>
            {t("shipping.estimator.sheet.cancel")}
          </Button>
          <Button type="submit" className="min-h-11">
            {t("shipping.estimator.sheet.confirm")}
          </Button>
        </div>
      </form>
    </>
  );
}
