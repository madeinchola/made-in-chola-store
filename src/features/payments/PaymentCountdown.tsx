import { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { t } from "@/i18n";
import { formatClock, secondsLeft } from "./paymentsMapping";

/** Cortes que se anuncian a lectores de pantalla (en segundos que quedan). Lo demás NO se anuncia: no es una región viva por segundo. */
function announcementKey(left: number): "" | "oneHour" | "tenMinutes" | "oneMinute" | "over" {
  if (left <= 0) return "over";
  if (left <= 60) return "oneMinute";
  if (left <= 600) return "tenMinutes";
  if (left <= 3600) return "oneHour";
  return "";
}

/**
 * Cuenta regresiva del tiempo para pagar. Reglas:
 *  · La hora es la del SERVIDOR (`secondsLeft` aplica el desfase entre `serverNow` y el reloj del aparato al llegar la
 *    respuesta): un reloj mal puesto no la adelanta ni la atrasa.
 *  · UN solo intervalo de 1 s, que existe solo mientras queda tiempo y se limpia al desmontar.
 *  · El número visible NO está en una región viva (anunciaría cada segundo). Una región viva PERSISTENTE anuncia solo los cortes:
 *    «queda una hora», «diez minutos», «menos de un minuto» y «terminó».
 *  · Al llegar a 0 se llama UNA vez a `onElapsed` (la pantalla vuelve a preguntar al servidor, que es quien decide si el pedido se
 *    cancela o sigue esperando una revisión).
 */
export function PaymentCountdown({
  expiresAt,
  serverNow,
  fetchedAtMs,
  onElapsed,
}: {
  expiresAt: string | null;
  serverNow: string;
  /** El reloj del aparato (ms) cuando llegó `serverNow`: la referencia del desfase. */
  fetchedAtMs: number;
  onElapsed?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const left = secondsLeft(expiresAt, serverNow, fetchedAtMs, now);
  const running = left !== null && left > 0;

  useEffect(() => {
    if (!running) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running, expiresAt, serverNow, fetchedAtMs]);

  // Una sola llamada por vencimiento, aunque la pantalla se repinte.
  const notified = useRef<string | null>(null);
  useEffect(() => {
    if (left !== 0 || !expiresAt) return;
    if (notified.current === expiresAt) return;
    notified.current = expiresAt;
    onElapsed?.();
  }, [left, expiresAt, onElapsed]);

  if (left === null) return null;
  const key = announcementKey(left);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-muted px-3 py-2 text-sm">
      <Clock aria-hidden="true" className="h-4 w-4 shrink-0" />
      {left > 0 ? (
        <p className="min-w-0 tabular-nums">
          <span className="text-muted-foreground">{t("pay.deadline.label")}: </span>
          <strong data-testid="payment-countdown">{formatClock(left)}</strong>
        </p>
      ) : (
        <p>{t("pay.deadline.checking")}</p>
      )}
      {/* Región viva persistente: nace vacía y cambia de texto solo al cruzar un corte. */}
      <p role="status" className="sr-only">
        {key ? t(`pay.deadline.${key}`) : ""}
      </p>
    </div>
  );
}
