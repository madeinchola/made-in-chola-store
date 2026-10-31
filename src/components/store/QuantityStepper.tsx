import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { clampQuantity, parseQuantityDraft, upperBound } from "./quantity";

interface QuantityStepperProps {
  value: number;
  /** Solo recibe enteros dentro de [min, max]: nunca NaN, 0 (con min 1) ni valores fuera de rango. */
  onChange: (value: number) => void;
  min?: number;
  /** Sin valor = sin tope (hasta 9999). */
  max?: number | undefined;
  disabled?: boolean;
  className?: string;
}

/**
 * Selector de cantidad en píldora: `−  [n]  +`. Los botones se bloquean en los límites con `aria-disabled` y NO con
 * `disabled`: quien sube la cantidad con Intro y llega al tope no debe perder el foco (un botón que se desactiva
 * estando enfocado lo suelta y el teclado deja de funcionar). El campo solo admite dígitos, emite en vivo los valores
 * válidos y al salir (o con Intro) acota al rango; si queda vacío vuelve al último valor válido.
 */
export function QuantityStepper({
  value,
  onChange,
  min = 1,
  max,
  disabled = false,
  className,
}: QuantityStepperProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const current = clampQuantity(value, min, max);
  const upper = upperBound(min, max);
  const atMin = current <= min;
  const atMax = current >= upper;

  const commit = (next: number) => {
    setDraft(null);
    if (next !== current) onChange(next);
  };

  const finishEditing = () => {
    if (draft === null) return;
    const parsed = Number(draft);
    commit(draft === "" ? current : clampQuantity(parsed, min, max));
  };

  return (
    <div
      role="group"
      aria-label={t("store.quantity.group")}
      className={cn(
        "inline-flex h-11 items-center rounded-pill border border-input bg-background",
        disabled && "opacity-50",
        className,
      )}
    >
      <button
        type="button"
        aria-label={t("store.quantity.decrease")}
        disabled={disabled}
        aria-disabled={atMin || undefined}
        onClick={() => !atMin && commit(current - 1)}
        className="inline-flex h-11 w-11 items-center justify-center rounded-pill transition-colors duration-fast ease-standard hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:bg-transparent"
      >
        <Minus aria-hidden="true" className="h-4 w-4" />
      </button>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        aria-label={t("store.quantity.input")}
        disabled={disabled}
        value={draft ?? String(current)}
        onChange={(event) => {
          const next = parseQuantityDraft(event.target.value);
          if (next === null) return; // carácter no numérico: se ignora y el campo conserva lo anterior
          setDraft(next);
          if (next !== "") {
            const n = Number(next);
            if (n >= min && n <= upper && n !== current) onChange(n);
          }
        }}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={finishEditing}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            finishEditing();
          }
        }}
        className="h-11 w-12 bg-transparent text-center text-base tabular-nums focus-visible:ring-offset-0 disabled:cursor-not-allowed"
      />
      <button
        type="button"
        aria-label={t("store.quantity.increase")}
        disabled={disabled}
        aria-disabled={atMax || undefined}
        onClick={() => !atMax && commit(current + 1)}
        className="inline-flex h-11 w-11 items-center justify-center rounded-pill transition-colors duration-fast ease-standard hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:bg-transparent"
      >
        <Plus aria-hidden="true" className="h-4 w-4" />
      </button>
      <span aria-live="polite" className="sr-only">
        {t("store.quantity.live", { n: current })}
      </span>
    </div>
  );
}
