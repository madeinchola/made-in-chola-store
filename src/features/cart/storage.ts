import type { CartSnapshot } from "./types";

/**
 * Lo único que el carrito guarda en el navegador, y SOLO para invitados: su token opaco y la última foto del carrito
 * (para pintarlo al instante y sin conexión). Nada identifica a nadie. Un usuario con sesión NO guarda nada aquí: su
 * carrito vive en el servidor, y al cerrar sesión el equipo queda limpio.
 */
export const GUEST_CART_KEY = "mic.cart.guest.v1";
const TOKEN_PATTERN = /^ct_[A-Za-z0-9_-]{43}$/;

export interface GuestMirror {
  token: string;
  snapshot: CartSnapshot | null;
  savedAt: number;
}

export interface CartStorage {
  read(): GuestMirror | null;
  write(mirror: GuestMirror): void;
  clear(): void;
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
  };
}

export function memoryCartStorage(initial: GuestMirror | null = null): CartStorage {
  let value = initial;
  return {
    read: () => value,
    write: (mirror) => {
      value = mirror;
    },
    clear: () => {
      value = null;
    },
  };
}
