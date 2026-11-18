import { useSyncExternalStore } from "react";
import { readConsent, subscribeConsent, type StoredConsent } from "./consentStore";

/** La elección actual de cookies (o `null` si todavía no decidió); la pantalla se actualiza cuando cambia. */
export function useConsent(): StoredConsent | null {
  return useSyncExternalStore(
    (onChange) => subscribeConsent(() => onChange()),
    readConsent,
    () => null,
  );
}
