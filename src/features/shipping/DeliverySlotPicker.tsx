import { useId } from "react";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { sameSchedule, type ScheduleChoice } from "./destination";
import { formatSlotRange, groupSlotsByDate } from "./slotDates";
import type { QuoteSlot } from "./types";

/**
 * Franjas de entrega agrupadas por día. Es un grupo de opciones excluyentes (radios nativos: una sola parada con el
 * teclado y flechas para moverse). Las franjas llenas SIGUEN en la lista, deshabilitadas y con la palabra «Llena»: quien
 * las ve sabe que existen. Elegir no reserva nada (el cupo se reserva al pagar): solo lo comunica a quien llama.
 */
export function DeliverySlotPicker({
  slots,
  choice,
  onChoose,
  className,
}: {
  slots: readonly QuoteSlot[];
  choice: ScheduleChoice | null;
  onChoose: (choice: ScheduleChoice) => void;
  className?: string;
}) {
  const ids = useId();
  const helpId = `${ids}-help`;
  const days = groupSlotsByDate(slots);
  return (
    <fieldset aria-describedby={helpId} className={cn("min-w-0 space-y-4", className)}>
      <legend className="text-sm font-medium">{t("shipping.slots.legend")}</legend>
      <p id={helpId} className="text-xs text-muted-foreground">
        {t("shipping.slots.help")}
      </p>
      {days.map((day) => {
        const dayId = `${ids}-${day.date}`;
        return (
          <div key={day.date} role="group" aria-labelledby={dayId} className="space-y-1.5">
            <p id={dayId} className="text-sm font-medium">
              {day.label}
            </p>
            <div className="flex flex-wrap gap-2">
              {day.slots.map((slot) => {
                const option: ScheduleChoice = { date: slot.date, slotId: slot.slotId };
                const range = formatSlotRange(slot.start, slot.end);
                const full = !slot.available;
                const name = t(full ? "shipping.slots.optionFull" : "shipping.slots.option", {
                  date: day.label,
                  range,
                });
                return (
                  <label
                    key={`${slot.date}|${slot.slotId}`}
                    className={cn(
                      "flex min-h-11 items-center gap-2 rounded-md border border-input px-3 text-sm",
                      full ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-muted",
                      sameSchedule(choice, option) && "border-primary bg-muted",
                    )}
                  >
                    <input
                      type="radio"
                      name={`${ids}-slot`}
                      className="h-4 w-4 shrink-0 accent-primary"
                      aria-label={name}
                      disabled={full}
                      checked={sameSchedule(choice, option)}
                      onChange={() => onChoose(option)}
                    />
                    <span>{range}</span>
                    {full && (
                      <span className="text-xs font-medium text-muted-foreground">
                        {t("shipping.slots.full")}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
    </fieldset>
  );
}
