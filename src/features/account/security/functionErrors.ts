import { t, type MessageKey } from "@/i18n";
import type { FunctionResult } from "@/lib/functions";

/** Fallo de una Edge Function (la rama `ok: false` de `FunctionResult`). */
export type FunctionFailure = Extract<FunctionResult<unknown>, { ok: false }>;

/**
 * Espera legible: menos de 90 s en segundos («45 segundos»), después en minutos redondeados HACIA ARRIBA
 * («90 s» → «2 minutos», «900 s» → «15 minutos»): nunca se promete menos espera de la real.
 */
export function formatWait(seconds: number): string {
  const total = Math.max(1, Math.ceil(seconds));
  if (total < 90) {
    return t(total === 1 ? "acct.security.wait.second" : "acct.security.wait.seconds", {
      n: total,
    });
  }
  return t("acct.security.wait.minutes", { n: Math.ceil(total / 60) });
}

/**
 * Mensaje para los fallos que NO dependen de la operación (límite de intentos, red, sesión vencida, desconocido). Los
 * códigos propios de cada operación (`invalid_credentials`, `weak_password`…) los resuelve quien llama ANTES, porque
 * cada uno decide en qué campo mostrarlos.
 */
export function commonFailureMessage(failure: FunctionFailure): string {
  if (failure.status === 429 || failure.code === "rate_limited") {
    return t("acct.security.errors.rate_limited", { wait: formatWait(failure.retryAfter ?? 60) });
  }
  if (failure.code === "network") return t("auth.errors.network");
  if (failure.status === 401 || failure.code === "unauthorized") {
    return t("acct.security.errors.session");
  }
  return t("auth.errors.unknown");
}

const POLICY_FAILURES = new Set([
  "too_short",
  "too_long",
  "common",
  "repetitive",
  "sequential",
  "contains_identifier",
]);

/** Textos de las reglas de contraseña incumplidas que informa el servidor (los códigos que no se conocen se ignoran). */
export function passwordFailureMessages(failures: readonly string[] | undefined): string[] {
  return (failures ?? [])
    .filter((failure) => POLICY_FAILURES.has(failure))
    .map((failure) => t(`auth.password.${failure}` as MessageKey));
}
