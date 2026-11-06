import { useEffect, useSyncExternalStore } from "react";
import type { Destination, ScheduleChoice } from "./destination";

/**
 * Lo que la clienta eligió para estimar su envío, recordado MIENTRAS la pestaña siga abierta: así no tiene que volver a
 * marcar su dirección si va a la tienda a agregar otra cosa y regresa a la bolsa, o si la bolsa se vacía y se rehace.
 *
 * Solo vive en la MEMORIA del módulo. No se escribe en `localStorage` ni en `sessionStorage` (una ubicación es un dato
 * personal y recordarla en disco no aporta nada que justifique el riesgo: al recargar basta con elegirla otra vez). Tiene
 * dueño: lo elegido por una persona NUNCA lo ve otra (cerrar sesión, otra cuenta en el mismo equipo, o pasar de invitada a
 * cuenta). Al cambiar de dueño se descarta.
 */
export const GUEST_OWNER = "guest";

export interface Remembered {
  owner: string | null;
  destination: Destination | null;
  schedule: ScheduleChoice | null;
}

const EMPTY: Remembered = { owner: null, destination: null, schedule: null };

let memory: Remembered = EMPTY;
const listeners = new Set<() => void>();

function commit(next: Remembered): void {
  memory = next;
  for (const listener of [...listeners]) listener();
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Lo recordado para `owner`; nada si lo guardado es de otro dueño (o no hay dueño todavía). */
export function recalled(owner: string | null): Remembered {
  return owner !== null && memory.owner === owner ? memory : EMPTY;
}

/** Recuerda el destino elegido. La franja elegida se conserva: las franjas no dependen del destino y el servidor la vuelve a validar. */
export function rememberDestination(owner: string, destination: Destination | null): void {
  const base = recalled(owner);
  commit({ owner, destination, schedule: base.schedule });
}

export function rememberSchedule(owner: string, schedule: ScheduleChoice | null): void {
  const base = recalled(owner);
  commit({ owner, destination: base.destination, schedule });
}

/** Olvida todo (también para las pruebas). */
export function forgetDestination(): void {
  if (memory !== EMPTY) commit(EMPTY);
}

/**
 * Lo recordado para `owner` (null mientras no se sepa quién es: la sesión sigue cargando). Si lo guardado es de otro
 * dueño se descarta al montar o al cambiar de dueño.
 */
export function useRemembered(owner: string | null): Remembered {
  const current = useSyncExternalStore(subscribe, () => memory);
  useEffect(() => {
    if (owner !== null && current.owner !== null && current.owner !== owner) forgetDestination();
  }, [owner, current]);
  return owner !== null && current.owner === owner ? current : EMPTY;
}
