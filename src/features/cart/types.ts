/**
 * Contrato del carrito (S7). Lo calcula SIEMPRE el servidor (`_cart_snapshot` en la base, vía la función `cart`): el
 * navegador solo lo muestra. Los importes llegan como números JSON; no se suman ni se redondean aquí.
 */

/** Estado de una línea, de más a menos grave. */
export type LineStatus = "unavailable" | "out_of_stock" | "low_stock" | "price_changed" | "ok";

/**
 * Aviso de precio. `dropped` / `guaranteed`: dentro de la garantía (S-04) bajó / subió y se respeta el menor.
 * `expired_raised` / `expired_dropped`: la garantía venció y el precio vigente subió / bajó.
 */
export type PriceNotice = "dropped" | "guaranteed" | "expired_raised" | "expired_dropped";

export interface CartLine {
  variant_id: string;
  product_id: string;
  name: string;
  slug: string;
  sku: string | null;
  color_name: string | null;
  color_hex: string | null;
  size_label: string | null;
  /** Ruta dentro del bucket público de imágenes de productos; null si no hay foto. */
  image_path: string | null;
  qty: number;
  /** Unidades que se cobrarían ahora (0 si no está disponible o agotada; el tope si hay poco stock). */
  billable_qty: number;
  /** Unidades que este carrito podría tener ahora de esta variante. */
  available: number;
  status: LineStatus;
  /** No se puede pagar mientras exista una línea bloqueante. */
  blocking: boolean;
  price_notice: PriceNotice | null;
  /** Precio efectivo por unidad (el que se cobra). */
  unit_price: number;
  price_at_add: number;
  current_price: number | null;
  price_locked_until: string;
  line_total: number;
  reserved_qty: number;
  reservation_expires_at: string | null;
}

export interface CartTotals {
  subtotal: number;
  item_count: number;
  line_count: number;
  /** Puntos de extensión: S8 (envío) y S9 (descuento) los llenan; hasta entonces son null. */
  shipping: number | null;
  discount: number | null;
  total: number;
}

export interface CartLimits {
  max_qty_per_variant: number;
  max_lines: number;
  max_units: number;
}

/** `none`: sin retención (carrito vacío o retención desactivada) · `held`: vigente · `expired`: venció, falta reintentar. */
export type ReservationState = "none" | "held" | "expired";

export interface CartSnapshot {
  cart_id: string;
  status: "active" | "merged" | "converted" | "abandoned";
  currency: string;
  reserve_on_add: boolean;
  ttl_seconds: number;
  guarantee_days: number;
  limits: CartLimits;
  lines: CartLine[];
  totals: CartTotals;
  reservation: { state: ReservationState; expires_at: string | null };
  can_checkout: boolean;
}

/** Resultado de agregar/cambiar una línea. */
export type ItemOutcome =
  | "ok"
  | "adjusted"
  | "capped_variant"
  | "capped_units"
  | "removed"
  | "out_of_stock"
  | "unavailable"
  | "limit_lines"
  | "limit_units"
  | "token_retired";

export interface CartResponse {
  /** `ok` · `none` (no existe) · `retired` (token ya fusionado o abandonado) · `merged` (acaba de fusionarse). */
  token_state: "ok" | "none" | "retired" | "merged";
  server_time: string;
  cart: CartSnapshot | null;
  outcome?: ItemOutcome;
  requested?: number;
  applied?: number;
  /** Solo si el servidor acaba de emitir un token de invitado: se guarda en el navegador. */
  cart_token?: string;
  token_minted?: boolean;
  renewed?: number;
  merged?: boolean;
  already?: boolean;
  merged_lines?: number;
  adjusted_lines?: number;
  skipped_lines?: number;
}

export type CartRequestBody =
  | { action: "get"; cart_token?: string }
  | { action: "set_item"; variant_id: string; qty: number; cart_token?: string }
  | { action: "remove_item"; variant_id: string; cart_token?: string }
  | { action: "clear"; cart_token?: string }
  | { action: "refresh"; cart_token?: string }
  | {
      action: "accept_prices";
      variant_id?: string;
      /** El precio vigente que la persona VIO: si ya cambió, el servidor no acepta nada. Solo con `variant_id`. */
      expected_price?: number;
      cart_token?: string;
    }
  | { action: "merge"; cart_token: string };

/** Aviso al cliente tras cambiar una línea: la cantidad se ajustó, hay un tope o no se pudo agregar. */
export interface ItemResult {
  outcome: ItemOutcome;
  requested: number;
  applied: number;
}
