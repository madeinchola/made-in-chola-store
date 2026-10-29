import { t, type MessageKey } from "@/i18n";
import type { AuthFailure } from "./auth-context";

const KNOWN = new Set([
  "invalid_credentials",
  "rate_limited",
  "register_failed",
  "pwned_password",
  "weak_password",
  "invalid_email",
  "invalid_phone",
  "identifier_required",
  "network",
]);

/** Mensaje en español para un fallo de auth. Los códigos desconocidos caen en un mensaje genérico. */
export function authErrorMessage(failure: AuthFailure): string {
  const code = KNOWN.has(failure.code) ? failure.code : "unknown";
  if (code === "rate_limited") {
    return t("auth.errors.rate_limited", { seconds: failure.retryAfter ?? 60 });
  }
  if (code === "weak_password" && failure.failures?.length) {
    return failure.failures.map((f) => t(`auth.password.${f}` as MessageKey)).join(" ");
  }
  return t(`auth.errors.${code}` as MessageKey);
}
