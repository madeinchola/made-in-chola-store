import { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { useCart } from "./cart-context";
import { formatCountdown } from "./format";
import { reservationRemainingMs } from "./selectors";

/** Desde este punto (inclusive) se avisa a los lectores de pantalla: «queda menos de un minuto». */
const WARN_AT_MS = 60_000;

/**
 * Cuenta regresiva de la retención de stock. Reglas:
 *  · La hora es la del SERVIDOR (`reservationRemainingMs` aplica `clockOffsetMs`): un reloj mal puesto no la adelanta ni
 *    la atrasa.
 *  · UN solo intervalo de 1 s, que existe solo mientras la retención está vigente y se limpia al desmontar o al cambiar.
 *  · Para lectores de pantalla NO se anuncia cada segundo: el número visible no es una región viva; una región aparte
 *    anuncia solo al llegar a 1 minuto y al llegar a 0.
 *  · Al llegar a 0 se llama UNA vez a `store.reservationExpired()` (el almacén reintenta reservar si hay stock). Mientras
 *    tanto se muestra el mensaje de «ya no reservamos», con «Reintentar reserva».
 *  · Sin retención (`state: "none"`, p. ej. `reserve_on_add` desactivado o bolsa vacía) no se pinta nada.
 */
export function ReservationCountdown({ className }: { className?: string }) {
  const { state, store } = useCart();
  const reservation = state.snapshot?.reservation;
  const held = reservation?.state === "held";
  const expiresAt = reservation?.expires_at ?? null;

  const [now, setNow] = useState(() => Date.now());
  const remaining = held ? reservationRemainingMs(state, now) : null;
  const runOut = held && remaining === 0;

  // El intervalo solo existe mientras la retención está vigente (no al vencer ni sin retención).
  useEffect(() => {
    if (!held || runOut) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [held, runOut, expiresAt]);

  // Una sola llamada por vencimiento, aunque la pantalla se repinte (el almacén también lo evita, pero no depende de eso).
  const notified = useRef<string | null>(null);
  useEffect(() => {
    if (!runOut) return;
    const key = expiresAt ?? "none";
    if (notified.current === key) return;
    notified.current = key;
    void store.reservationExpired();
  }, [runOut, expiresAt, store]);

  if (!reservation || reservation.state === "none" || state.snapshot?.reserve_on_add === false) {
    return null;
  }

  const expired = reservation.state === "expired" || runOut;
  if (expired) {
    return (
      <div
        role="status"
        className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-muted px-3 py-2 text-sm",
          className,
        )}
      >
        <Clock aria-hidden="true" className="h-4 w-4 shrink-0" />
        <p className="min-w-0 flex-1 basis-40 break-words">{t("cart.reservation.expired")}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11"
          onClick={() => void store.retryReservation()}
        >
          {t("cart.reservation.retry")}
        </Button>
      </div>
    );
  }

  const left = remaining ?? 0;
  // Solo cambia al cruzar el minuto: ese cambio es lo único que se anuncia.
  const announcement = left <= WARN_AT_MS ? t("cart.reservation.oneMinute") : "";
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-sm",
        className,
      )}
    >
      <Clock aria-hidden="true" className="h-4 w-4 shrink-0" />
      <p className="min-w-0 break-words tabular-nums">
        {t("cart.reservation.held", { time: formatCountdown(left) })}
      </p>
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}
