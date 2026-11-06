import { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { useCart } from "./cart-context";
import { formatCountdown } from "./format";
import { RescueButton } from "./RescueButton";
import { reservationRemainingMs } from "./selectors";
import { reservationView } from "./viewState";

/** Desde este punto (inclusive) se avisa a los lectores de pantalla: «queda menos de un minuto». */
const WARN_AT_MS = 60_000;

/**
 * Cuenta regresiva de la retención de stock. Reglas:
 *  · La hora es la del SERVIDOR (`reservationRemainingMs` aplica `clockOffsetMs`): un reloj mal puesto no la adelanta ni
 *    la atrasa.
 *  · UN solo intervalo de 1 s, que existe solo mientras la retención está vigente y se limpia al desmontar o al cambiar.
 *  · Para lectores de pantalla NO se anuncia cada segundo: el número visible no está en una región viva. Una región
 *    viva PERSISTENTE (existe desde que se pinta la cuenta, aunque esté vacía) anuncia solo: «queda menos de un minuto»,
 *    «reservando de nuevo» y «ya no reservamos». Un aviso que nace ya con su `role="status"` no se anuncia de forma
 *    fiable; uno que entra en una región que ya existía, sí.
 *  · Al llegar a 0 se llama UNA vez a `store.reservationExpired()` (el almacén reintenta reservar si hay stock). Hasta que
 *    ese intento termine se ve «Reservando de nuevo…» (neutro, sin botón); «Ya no reservamos…» + «Reintentar reserva» solo
 *    si no hubo stock. El estado se DERIVA (`reservationView`), no depende de un efecto: no hay un fotograma de «ya no
 *    reservamos» antes de que se pida.
 *  · Sin retención (`state: "none"`, p. ej. `reserve_on_add` desactivado o bolsa vacía) no se pinta nada.
 */
export function ReservationCountdown({ className }: { className?: string }) {
  const { state, store } = useCart();
  const reservation = state.snapshot?.reservation;
  const held = reservation?.state === "held";
  const expiresAt = reservation?.expires_at ?? null;

  const [now, setNow] = useState(() => Date.now());
  // El vencimiento para el que ya se pidió reservar de nuevo: es ESTADO (no solo una ref) para que, al pedirlo, se repinte
  // y quede claro que el intento ya se hizo aunque el almacén no lo repita (ver `reservationView`).
  const [requestedKey, setRequestedKey] = useState<string | null>(null);
  const view = reservationView(state, now, requestedKey);
  const runOut = held && reservationRemainingMs(state, now) === 0;

  // El intervalo solo existe mientras la retención está vigente (no al vencer ni sin retención).
  useEffect(() => {
    if (!held || runOut) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [held, runOut, expiresAt]);

  // Una sola llamada por vencimiento, aunque la pantalla se repinte (el almacén también lo evita, pero no depende de eso).
  // Primero se pide (el almacén marca `reserving`) y después se anota: así no hay un repintado intermedio «ya pedido y no
  // reservando».
  const notified = useRef<string | null>(null);
  useEffect(() => {
    if (!runOut) return;
    const key = expiresAt ?? "none";
    if (notified.current === key) return;
    notified.current = key;
    void store.reservationExpired();
    setRequestedKey(key);
  }, [runOut, expiresAt, store]);

  if (view.kind === "none") return null;

  const left = view.kind === "counting" ? view.remainingMs : 0;
  // Solo cambia al cruzar el minuto: ese cambio es lo único que se anuncia mientras corre la cuenta.
  const announcement =
    view.kind === "counting" && left <= WARN_AT_MS ? t("cart.reservation.oneMinute") : "";
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-muted px-3 py-2 text-sm",
        className,
      )}
    >
      <Clock aria-hidden="true" className="h-4 w-4 shrink-0" />
      {view.kind === "counting" && (
        <p className="min-w-0 break-words tabular-nums">
          {t("cart.reservation.held", { time: formatCountdown(left) })}
        </p>
      )}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="false"
        className={cn(
          view.kind !== "counting" &&
            "flex min-w-0 flex-1 basis-40 flex-wrap items-center gap-x-3 gap-y-1",
        )}
      >
        {announcement && <span className="sr-only">{announcement}</span>}
        {view.kind === "reserving" && (
          <p className="min-w-0 flex-1 basis-40 break-words">{t("cart.reservation.reserving")}</p>
        )}
        {view.kind === "expired" && (
          <>
            <p className="min-w-0 flex-1 basis-40 break-words">{t("cart.reservation.expired")}</p>
            <RescueButton
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11"
              onClick={() => void store.retryReservation()}
            >
              {t("cart.reservation.retry")}
            </RescueButton>
          </>
        )}
      </div>
    </div>
  );
}
