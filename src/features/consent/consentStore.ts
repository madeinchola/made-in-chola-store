/**
 * Consentimiento de cookies (Sprint 15). Tres categorías: las NECESARIAS (sesión, bolsa y esta misma elección) siempre están activas y
 * no se preguntan; las de ANALÍTICA y de MARKETING solo se activan si la persona las acepta. Hasta que decide, no hay consentimiento:
 * nada opcional se carga ni se envía.
 *
 * La elección vive en el navegador (`localStorage`), no en el servidor: un visitante anónimo no tiene cuenta donde guardarla y no hay
 * nada que probar contra nadie. Si el navegador no deja guardar (modo privado estricto), la elección dura mientras la pestaña esté
 * abierta. Un cambio de `CONSENT_VERSION` (p. ej. si se agrega una categoría) vuelve a preguntar.
 */
export type ConsentCategory = "analytics" | "marketing";

export interface ConsentChoice {
  analytics: boolean;
  marketing: boolean;
}

export interface StoredConsent extends ConsentChoice {
  v: number;
  decidedAt: string;
}

export const CONSENT_VERSION = 1;
export const CONSENT_KEY = "mic_consent";

// La elección se lee del almacenamiento UNA vez y se guarda aquí: así `readConsent()` devuelve siempre el mismo objeto mientras nada cambie
// (React lo necesita para suscribirse) y un navegador sin almacenamiento sigue funcionando con lo que hay en memoria.
let memory: StoredConsent | null = null;
let loaded = false;
const listeners = new Set<(state: StoredConsent | null) => void>();

function parse(raw: string | null): StoredConsent | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredConsent> | null;
    if (
      value !== null &&
      typeof value === "object" &&
      value.v === CONSENT_VERSION &&
      typeof value.analytics === "boolean" &&
      typeof value.marketing === "boolean" &&
      typeof value.decidedAt === "string"
    ) {
      return {
        v: value.v,
        analytics: value.analytics,
        marketing: value.marketing,
        decidedAt: value.decidedAt,
      };
    }
  } catch {
    /* JSON roto: como si no hubiera decidido */
  }
  return null;
}

function load() {
  loaded = true;
  try {
    memory = parse(window.localStorage.getItem(CONSENT_KEY)) ?? memory;
  } catch {
    /* sin acceso al almacenamiento: vale lo que haya en memoria */
  }
}

/** La elección guardada, o `null` si todavía no decidió (o la guardada ya no vale). El mismo objeto mientras nada cambie. */
export function readConsent(): StoredConsent | null {
  if (!loaded) load();
  return memory;
}

export const isDecided = (): boolean => readConsent() !== null;

/** Sin decisión = sin consentimiento. */
export function hasConsent(category: ConsentCategory): boolean {
  return readConsent()?.[category] === true;
}

function emit(state: StoredConsent | null) {
  for (const listener of [...listeners]) {
    try {
      listener(state);
    } catch {
      /* un oyente roto no puede impedir que los demás se enteren (sobre todo de un retiro) */
    }
  }
}

/** Guarda la elección y avisa a quien escucha (los proveedores se activan o se detienen). */
export function saveConsent(choice: ConsentChoice): StoredConsent {
  const state: StoredConsent = {
    v: CONSENT_VERSION,
    analytics: choice.analytics,
    marketing: choice.marketing,
    decidedAt: new Date().toISOString(),
  };
  memory = state;
  loaded = true;
  try {
    window.localStorage.setItem(CONSENT_KEY, JSON.stringify(state));
  } catch {
    /* queda en memoria */
  }
  emit(state);
  return state;
}

export const acceptAll = () => saveConsent({ analytics: true, marketing: true });
export const rejectOptional = () => saveConsent({ analytics: false, marketing: false });

/** Quién quiera enterarse de cada cambio. Devuelve la función para dejar de escuchar. */
export function subscribeConsent(listener: (state: StoredConsent | null) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** SOLO PARA PRUEBAS: vuelve al estado «sin decidir». */
export function resetConsentForTests(): void {
  memory = null;
  loaded = false;
  try {
    window.localStorage.removeItem(CONSENT_KEY);
  } catch {
    /* nada */
  }
  emit(null);
}

// Otra pestaña cambió la elección (o la borró): esta se entera, y si fue un retiro los proveedores se detienen aquí también.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== CONSENT_KEY && event.key !== null) return;
    memory = null;
    load();
    emit(memory);
  });
}
