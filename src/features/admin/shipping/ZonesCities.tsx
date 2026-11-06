import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addCities, MAX_CITIES, MAX_CITY_LENGTH, removeCity } from "./ZonesLogic";

interface ZonesCitiesProps {
  cities: string[];
  onChange: (cities: string[]) => void;
  /** Texto del problema de la lista (por ejemplo «Añade al menos una ciudad»), ya traducido. */
  error?: string | undefined;
}

const K = "admin.shipping.rates.zones.form.cities" as const;
const list = (items: string[]) =>
  new Intl.ListFormat("es", { style: "long", type: "conjunction" }).format(items);

/**
 * Entrada de varias ciudades: se escribe una (o se pegan varias separadas por comas) y se añade con el botón o con Intro.
 * Intro NO envía el formulario de la zona. Las repetidas (sin tildes ni mayúsculas) se ignoran y se dice por qué.
 */
export function ZonesCities({ cities, onChange, error }: ZonesCitiesProps) {
  const ids = useId();
  const inputId = `${ids}-input`;
  const hintId = `${ids}-hint`;
  const errorId = `${ids}-error`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [feedback, setFeedback] = useState("");

  // Tras quitar una ciudad el foco vuelve a la entrada: el botón que lo tenía ya no existe.
  const refocus = useRef(false);
  useEffect(() => {
    if (refocus.current) {
      refocus.current = false;
      inputRef.current?.focus();
    }
  });

  const add = () => {
    if (text.trim() === "") {
      setFeedback(t(`${K}.feedback.empty`));
      return;
    }
    const result = addCities(cities, text);
    const messages: string[] = [];
    if (result.added.length === 1) {
      messages.push(t(`${K}.feedback.addedOne`, { list: list(result.added) }));
    } else if (result.added.length > 1) {
      messages.push(
        t(`${K}.feedback.addedMany`, { count: result.added.length, list: list(result.added) }),
      );
    }
    if (result.duplicates.length > 0) {
      messages.push(t(`${K}.feedback.duplicates`, { list: list(result.duplicates) }));
    }
    if (result.tooLong.length > 0) {
      messages.push(
        t(`${K}.feedback.tooLong`, { max: MAX_CITY_LENGTH, list: list(result.tooLong) }),
      );
    }
    if (result.overLimit.length > 0) {
      messages.push(
        t(`${K}.feedback.overLimit`, { max: MAX_CITIES, list: list(result.overLimit) }),
      );
    }
    setFeedback(messages.join(" "));
    if (result.added.length > 0) onChange(result.cities);
    // Lo que no se pudo añadir se deja en el campo para corregirlo; si todo entró, se vacía.
    const leftovers = [...result.tooLong, ...result.overLimit];
    setText(leftovers.join(", "));
    inputRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    // Esta entrada vive dentro del formulario de la zona: Intro añade la ciudad, NO guarda la zona.
    event.preventDefault();
    add();
  };

  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className="text-sm font-medium">
        {t(`${K}.label`)}
      </label>
      <div className="flex gap-2">
        <Input
          ref={inputRef}
          id={inputId}
          className="min-h-11"
          type="text"
          autoComplete="off"
          enterKeyHint="enter"
          placeholder={t(`${K}.placeholder`)}
          value={text}
          aria-invalid={error ? true : undefined}
          aria-describedby={[hintId, error ? errorId : null].filter(Boolean).join(" ")}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button type="button" variant="outline" className="min-h-11 shrink-0" onClick={add}>
          {t(`${K}.add`)}
        </Button>
      </div>
      <p id={hintId} className="text-xs text-muted-foreground">
        {t(`${K}.hint`)}
      </p>
      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <p role="status" className="text-xs text-muted-foreground">
        {feedback}
      </p>
      <p className="text-xs text-muted-foreground">
        {t(`${K}.count`, { count: cities.length, max: MAX_CITIES })}
      </p>
      {cities.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(`${K}.none`)}</p>
      ) : (
        <ul aria-label={t(`${K}.listLabel`)} className="flex flex-wrap gap-2">
          {cities.map((city, i) => (
            <li
              key={`${city}-${i}`}
              className="inline-flex max-w-full items-center rounded-pill border bg-muted pl-3 text-sm"
            >
              <span className="break-all">{city}</span>
              <button
                type="button"
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-pill hover:bg-background"
                aria-label={t(`${K}.remove`, { city })}
                onClick={() => {
                  refocus.current = true;
                  setFeedback(t(`${K}.feedback.removed`, { city }));
                  onChange(removeCity(cities, i));
                }}
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
