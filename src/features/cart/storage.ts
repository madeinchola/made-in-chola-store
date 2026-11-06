import type { CartSnapshot } from "./types";

/**
 * Lo que el carrito guarda en el navegador:
 *  · SOLO para invitados, su token opaco y la última foto del carrito (para pintarlo al instante y sin conexión).
 *  · Para invitados Y usuarios con sesión, los cambios PENDIENTES de confirmar (variante → cantidad), con el dueño y la
 *    hora: sobreviven a una recarga sin conexión. No llevan datos personales (ids opacos y cantidades). Solo se
 *    restauran si el dueño coincide con quien abre la tienda y no pasaron `PENDING_TTL_MS`; al cambiar de identidad
 *    (cerrar sesión, otro usuario) se borran, así que el equipo queda limpio.
 * Un usuario con sesión NO guarda su foto del carrito: vive en el servidor.
 */
export const GUEST_CART_KEY = "mic.cart.guest.v1";
export const PENDING_KEY = "mic.cart.pending.v1";
/** Un cambio sin confirmar más viejo que esto ya no es lo que la persona quiere: se descarta al volver. */
export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
/** Tolerancia con relojes mal puestos: un guardado «del futuro» por poco no se descarta. */
const PENDING_CLOCK_SKEW_MS = 60_000;
/** Cantidad máxima de variantes que se guardan (el carrito admite 30 líneas; el resto es manipulación). */
const MAX_PERSISTED_PENDING = 100;
const TOKEN_PATTERN = /^ct_[A-Za-z0-9_-]{43}$/;
const OWNER_PATTERN = /^(guest|user:[A-Za-z0-9-]{1,64})$/;
const VARIANT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export interface GuestMirror {
  token: string;
  snapshot: CartSnapshot | null;
  savedAt: number;
}

/** Cambios sin confirmar guardados: `owner` es «guest» o «user:<id>». */
export interface PersistedPending {
  owner: string;
  pending: Record<string, number>;
  savedAt: number;
}

export interface CartStorage {
  read(): GuestMirror | null;
  write(mirror: GuestMirror): void;
  clear(): void;
  readPending(): PersistedPending | null;
  writePending(value: PersistedPending): void;
  clearPending(): void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const isNum = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const isStr = (value: unknown): value is string => typeof value === "string";
const isStrOrNull = (value: unknown): boolean => value === null || isStr(value);
const isNumOrNull = (value: unknown): boolean => value === null || isNum(value);

function looksLikeLine(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isStr(value.variant_id) &&
    isStr(value.product_id) &&
    isStr(value.name) &&
    isStr(value.slug) &&
    isStr(value.status) &&
    isStrOrNull(value.sku) &&
    isStrOrNull(value.color_name) &&
    isStrOrNull(value.color_hex) &&
    isStrOrNull(value.size_label) &&
    isStrOrNull(value.image_path) &&
    isStrOrNull(value.price_notice) &&
    isStr(value.price_locked_until) &&
    isStrOrNull(value.reservation_expires_at) &&
    typeof value.blocking === "boolean" &&
    isNum(value.qty) &&
    isNum(value.billable_qty) &&
    isNum(value.available) &&
    isNum(value.unit_price) &&
    isNum(value.price_at_add) &&
    isNumOrNull(value.current_price) &&
    isNum(value.line_total) &&
    isNum(value.reserved_qty)
  );
}

/**
 * Comprueba CADA parte que la pantalla va a leer (líneas, totales, retención, límites): un espejo manipulado o de una
 * versión vieja del contrato se descarta aquí en vez de tumbar la tienda con un error al pintar. El servidor lo
 * reemplaza en cuanto responde, así que descartarlo no pierde nada.
 */
function looksLikeSnapshot(value: unknown): value is CartSnapshot {
  if (!isRecord(value)) return false;
  const { totals, reservation, limits } = value;
  return (
    isStr(value.cart_id) &&
    isStr(value.currency) &&
    typeof value.reserve_on_add === "boolean" &&
    typeof value.can_checkout === "boolean" &&
    isNum(value.ttl_seconds) &&
    Array.isArray(value.lines) &&
    value.lines.every(looksLikeLine) &&
    isRecord(totals) &&
    isNum(totals.subtotal) &&
    isNum(totals.item_count) &&
    isNum(totals.line_count) &&
    isNum(totals.total) &&
    isNumOrNull(totals.shipping) &&
    isNumOrNull(totals.discount) &&
    isRecord(reservation) &&
    isStr(reservation.state) &&
    isStrOrNull(reservation.expires_at) &&
    isRecord(limits) &&
    isNum(limits.max_qty_per_variant) &&
    isNum(limits.max_lines) &&
    isNum(limits.max_units)
  );
}

/** Lee y valida lo guardado: algo corrupto o manipulado se descarta en vez de romper la pantalla. */
export function parseGuestMirror(raw: string | null): GuestMirror | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== "object") return null;
    const v = value as Record<string, unknown>;
    if (typeof v.token !== "string" || !TOKEN_PATTERN.test(v.token)) return null;
    return {
      token: v.token,
      snapshot: looksLikeSnapshot(v.snapshot) ? v.snapshot : null,
      savedAt: typeof v.savedAt === "number" ? v.savedAt : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Lee y valida los cambios pendientes guardados. Todo lo raro (JSON roto, dueño con otra forma, claves o cantidades
 * inválidas, demasiadas variantes, fecha que no es un número) descarta TODO: es preferible perder un cambio sin
 * confirmar a mandar al servidor algo manipulado.
 */
export function parsePersistedPending(raw: string | null): PersistedPending | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return null;
    const { owner, pending, savedAt } = value;
    if (!isStr(owner) || !OWNER_PATTERN.test(owner)) return null;
    if (!isNum(savedAt)) return null;
    if (!isRecord(pending)) return null;
    const entries = Object.entries(pending);
    if (entries.length === 0 || entries.length > MAX_PERSISTED_PENDING) return null;
    const clean: Record<string, number> = {};
    for (const [variantId, qty] of entries) {
      // `__proto__` cumple el patrón pero como clave de un objeto no se comporta como dato: se rechaza expresamente.
      if (variantId === "__proto__" || !VARIANT_ID_PATTERN.test(variantId)) return null;
      if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 0 || qty > 1000) return null;
      clean[variantId] = qty;
    }
    return { owner, pending: clean, savedAt };
  } catch {
    return null;
  }
}

/** ¿Sigue vigente un guardado de `savedAt` visto desde `now`? (ni demasiado viejo ni «del futuro» más allá de la tolerancia). */
export function isPendingFresh(savedAt: number, now: number): boolean {
  const age = now - savedAt;
  return age >= -PENDING_CLOCK_SKEW_MS && age <= PENDING_TTL_MS;
}

/** `localStorage` puede faltar o lanzar (modo privado, datos bloqueados): todo va protegido y degrada a "sin espejo". */
export function browserCartStorage(): CartStorage {
  const area = (): Storage | null => {
    try {
      return typeof localStorage === "undefined" ? null : localStorage;
    } catch {
      return null;
    }
  };
  return {
    read() {
      try {
        return parseGuestMirror(area()?.getItem(GUEST_CART_KEY) ?? null);
      } catch {
        return null;
      }
    },
    write(mirror) {
      try {
        area()?.setItem(GUEST_CART_KEY, JSON.stringify(mirror));
      } catch {
        /* cuota llena o bloqueado: el carrito sigue en el servidor */
      }
    },
    clear() {
      try {
        area()?.removeItem(GUEST_CART_KEY);
      } catch {
        /* nada que limpiar */
      }
    },
    readPending() {
      try {
        return parsePersistedPending(area()?.getItem(PENDING_KEY) ?? null);
      } catch {
        return null;
      }
    },
    writePending(value) {
      try {
        area()?.setItem(PENDING_KEY, JSON.stringify(value));
      } catch {
        /* cuota llena o bloqueado: lo pendiente sigue en memoria mientras la pestaña esté abierta */
      }
    },
    clearPending() {
      try {
        area()?.removeItem(PENDING_KEY);
      } catch {
        /* nada que limpiar */
      }
    },
  };
}

export function memoryCartStorage(
  initial: GuestMirror | null = null,
  initialPending: PersistedPending | null = null,
): CartStorage {
  let value = initial;
  let pending = initialPending;
  return {
    read: () => value,
    write: (mirror) => {
      value = mirror;
    },
    clear: () => {
      value = null;
    },
    readPending: () => pending,
    writePending: (next) => {
      pending = { ...next, pending: { ...next.pending } };
    },
    clearPending: () => {
      pending = null;
    },
  };
}
