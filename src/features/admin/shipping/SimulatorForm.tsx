import { useMemo, useRef, useState, type FormEvent } from "react";
import { LocationPicker } from "@/components/map/LocationPicker";
import {
  EMPTY_PIN,
  formatCoordinate,
  type CoordinateProblem,
  type PinText,
} from "@/components/map/coords";
import { quoteShipping } from "@/features/shipping/quote";
import type { QuoteSlot } from "@/features/shipping/types";
import { t } from "@/i18n";
import { toAppError } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SectionCard } from "../ui/PageHeader";
import { formatShortDate } from "./SlotsDates";
import {
  buildQuoteParams,
  groupSlotsByDate,
  sameQuoteParams,
  type AmountProblem,
  type SimulatorRun,
  type SimulatorValues,
} from "./SimulatorLogic";
import { SimulatorResult } from "./SimulatorResult";
import type { ShippingMethod, StoreLocation } from "./types";

const P = "admin.shipping.delivery.simulator";
const FIELD = "h-11";
const NO_SLOTS: readonly QuoteSlot[] = [];
/**
 * El servidor repite la MISMA franja (mismo `slotId`) en cada día de la ventana; lo que identifica una opción es el par
 * día + franja. Con solo el `slotId`, elegir «lun 16 nov 10:00» seleccionaba (y fechaba) el primer lunes.
 */
const slotKey = (slot: QuoteSlot) => `${slot.date}|${slot.slotId}`;

const amountMessage = (problem: AmountProblem) =>
  problem === "required"
    ? t(`${P}.form.errors.amountRequired`)
    : t(`${P}.form.errors.amountInvalid`);

const coordMessage = (axis: "lat" | "lng", problem: CoordinateProblem) =>
  t(`${P}.form.errors.${axis}.${problem}`);

interface SimulatorFormProps {
  /** Métodos activos (al menos uno). */
  methods: readonly ShippingMethod[];
  /** La ubicación principal de la tienda: el destino parte de ahí. */
  origin: StoreLocation | null;
}

/**
 * Formulario del simulador y su resultado. La cotización la calcula SIEMPRE el servidor (`quoteShipping`): aquí solo se arma
 * la pregunta y se muestra la respuesta. El resultado se guarda junto con la pregunta que lo originó, y solo se muestra
 * mientras el formulario siga diciendo lo mismo: cambiar cualquier dato lo oculta (nunca un costo viejo con datos nuevos).
 */
export function SimulatorForm({ methods, origin }: SimulatorFormProps) {
  const [methodCode, setMethodCode] = useState<string | null>(null);
  const [pin, setPin] = useState<PinText | null>(null);
  const [city, setCity] = useState("");
  const [amount, setAmount] = useState("0");
  const [date, setDate] = useState("");
  const [pickedSlot, setPickedSlot] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [edits, setEdits] = useState(0);
  const [run, setRun] = useState<SimulatorRun | null>(null);
  const [slotSource, setSlotSource] = useState<{ methodCode: string; slots: QuoteSlot[] } | null>(
    null,
  );
  const latest = useRef(0);

  // Si el método elegido ya no está activo, se vuelve al primero en vez de quedar con uno fantasma.
  const method = methods.find((m) => m.code === methodCode) ?? (methods[0] as ShippingMethod);
  const isDelivery = method.kind === "delivery";

  const originPin: PinText = origin
    ? { lat: formatCoordinate(origin.lat), lng: formatCoordinate(origin.lng) }
    : EMPTY_PIN;

  // Las franjas salen de la última respuesta del servidor PARA ESTE MÉTODO; si ya no está la elegida, se descarta.
  const slotOptions =
    slotSource && slotSource.methodCode === method.code ? slotSource.slots : NO_SLOTS;
  const slotDays = useMemo(() => groupSlotsByDate(slotOptions), [slotOptions]);
  const chosenSlot = slotOptions.find((s) => slotKey(s) === pickedSlot);
  const effectiveSlotId = chosenSlot?.slotId ?? "";

  const values: SimulatorValues = {
    methodCode: method.code,
    kind: method.kind,
    pin: pin ?? originPin,
    city,
    amount,
    date,
    slotId: effectiveSlotId,
  };
  const built = buildQuoteParams(values);
  const errors = submitted && !built.ok ? built.errors : {};
  // El resultado se muestra solo si NO se editó nada desde que se pidió Y el formulario sigue haciendo la misma pregunta
  // (esto último cubre cambios que no son ediciones, como que el origen de la tienda cambie por debajo).
  const current =
    run !== null && run.edits === edits && built.ok && sameQuoteParams(run.params, built.params);
  const touch = () => setEdits((n) => n + 1);

  const calculate = async () => {
    setSubmitted(true);
    if (!built.ok) return;
    const params = built.params;
    const id = ++latest.current;
    setRun({ status: "pending", params, edits });
    try {
      const result = await quoteShipping(params);
      if (id !== latest.current) return; // llegó tarde: ya se pidió otra cosa
      setRun({ status: "done", params, edits, result });
      setSlotSource({ methodCode: method.code, slots: result.slots });
    } catch (e) {
      if (id !== latest.current) return;
      setRun({ status: "failed", params, edits, error: toAppError(e) });
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void calculate();
  };

  const onSlotChange = (key: string) => {
    touch();
    setPickedSlot(key);
    const chosen = slotOptions.find((s) => slotKey(s) === key);
    if (chosen) setDate(chosen.date); // la franja ya es de un día concreto
  };

  const pending = run?.status === "pending" && current;

  return (
    <div className="space-y-6">
      <SectionCard
        id="simulator-form"
        title={t(`${P}.form.title`)}
        description={t(`${P}.description`)}
      >
        <form onSubmit={onSubmit} noValidate className="grid gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t(`${P}.form.method`)}>
              <Select
                className={FIELD}
                value={method.code}
                onChange={(e) => {
                  touch();
                  setMethodCode(e.target.value);
                  setPickedSlot("");
                }}
              >
                {methods.map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.kind === "delivery"
                      ? t(`${P}.form.methodDelivery`, { name: m.name })
                      : t(`${P}.form.methodPickup`, { name: m.name })}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={t(`${P}.form.amount`)}
              hint={t(`${P}.form.amountHint`)}
              {...(errors.amount ? { error: amountMessage(errors.amount) } : {})}
            >
              <Input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                className={FIELD}
                value={amount}
                onChange={(e) => {
                  touch();
                  setAmount(e.target.value);
                }}
              />
            </Field>
          </div>

          {isDelivery ? (
            <>
              <div className="space-y-2">
                <LocationPicker
                  value={pin ?? originPin}
                  onChange={(next) => {
                    touch();
                    setPin(next);
                  }}
                  errors={{
                    lat: errors.lat ? coordMessage("lat", errors.lat) : undefined,
                    lng: errors.lng ? coordMessage("lng", errors.lng) : undefined,
                  }}
                  country="BO"
                  center={origin ? { lat: origin.lat, lng: origin.lng } : undefined}
                />
                {origin ? (
                  pin !== null && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className={FIELD}
                      onClick={() => {
                        touch();
                        setPin(null);
                      }}
                    >
                      {t(`${P}.form.useOrigin`)}
                    </Button>
                  )
                ) : (
                  <p role="status" className="text-sm text-warning">
                    {t(`${P}.form.noOrigin`)}
                  </p>
                )}
              </div>
              <Field label={t(`${P}.form.city`)} hint={t(`${P}.form.cityHint`)}>
                <Input
                  type="text"
                  autoComplete="off"
                  className={FIELD}
                  value={city}
                  onChange={(e) => {
                    touch();
                    setCity(e.target.value);
                  }}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t(`${P}.form.date`)} hint={t(`${P}.form.dateHint`)}>
                  <Input
                    type="date"
                    className={FIELD}
                    value={date}
                    onChange={(e) => {
                      touch();
                      setDate(e.target.value);
                    }}
                  />
                </Field>
                <Field
                  label={t(`${P}.form.slot`)}
                  hint={
                    slotOptions.length === 0 ? t(`${P}.form.slotHintNone`) : t(`${P}.form.slotHint`)
                  }
                >
                  <Select
                    className={FIELD}
                    value={chosenSlot ? pickedSlot : ""}
                    disabled={slotOptions.length === 0}
                    onChange={(e) => onSlotChange(e.target.value)}
                  >
                    <option value="">{t(`${P}.form.slotNone`)}</option>
                    {slotDays.map((day) => (
                      <optgroup key={day.date} label={formatShortDate(day.date)}>
                        {day.slots.map((slot) => (
                          <option
                            key={slotKey(slot)}
                            value={slotKey(slot)}
                            disabled={!slot.available}
                          >
                            {slot.available
                              ? t(`${P}.form.slotOption`, {
                                  start: slot.start,
                                  end: slot.end,
                                  remaining: slot.remaining,
                                  capacity: slot.capacity,
                                })
                              : t(`${P}.form.slotOptionFull`, {
                                  start: slot.start,
                                  end: slot.end,
                                })}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </Select>
                </Field>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t(`${P}.form.pickupNote`)}</p>
          )}

          <div>
            <Button type="submit" className={FIELD} loading={pending}>
              {pending ? t(`${P}.form.submitting`) : t(`${P}.form.submit`)}
            </Button>
          </div>
        </form>
      </SectionCard>

      <SimulatorResult run={run} current={current} onRetry={() => void calculate()} />
    </div>
  );
}
