/* Utilidades SOLO de tests del carrito (exportan datos y funciones junto a componentes de apoyo). */
/* eslint-disable react-refresh/only-export-components */
import type { ReactElement } from "react";
import { act, configure, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { MemoryRouter, useLocation } from "react-router-dom";
import { vi } from "vitest";
import type { FunctionResult } from "@/lib/functions";
import { fakeAuth, WithAuth } from "@/test/auth-test-utils";
import type { AuthContextValue } from "@/features/auth/auth-context";
import { type CartContextValue, useCart } from "./cart-context";
import { CartProvider } from "./CartProvider";
import type { CartApi } from "./cartStore";
import { memoryCartStorage } from "./storage";
import type { CartLine, CartRequestBody, CartResponse, CartSnapshot } from "./types";

configure({ asyncUtilTimeout: 4000 });
// El canal entre pestañas no se prueba aquí: sin él cada prueba queda aislada de las demás.
vi.stubGlobal("BroadcastChannel", undefined);

export const TOKEN = `ct_${"A".repeat(43)}`;
export const NOW = Date.parse("2026-11-03T12:00:00.000Z");

/** Línea del servidor con valores por defecto sensatos (100 Bs por unidad, 10 disponibles, color y talla). */
export function makeLine(variantId: string, qty: number, extra: Partial<CartLine> = {}): CartLine {
  return {
    variant_id: variantId,
    product_id: `p-${variantId}`,
    name: `Chaqueta ${variantId}`,
    slug: `chaqueta-${variantId}`,
    sku: null,
    color_name: "Negro",
    color_hex: "#1F1F1F",
    size_label: "M",
    image_path: null,
    qty,
    billable_qty: qty,
    available: 10,
    status: "ok",
    blocking: false,
    price_notice: null,
    unit_price: 100,
    price_at_add: 100,
    current_price: 100,
    price_locked_until: "2026-11-10T12:00:00.000Z",
    line_total: 100 * qty,
    reserved_qty: qty,
    reservation_expires_at: "2026-11-03T12:10:00.000Z",
    ...extra,
  };
}

/** Foto del carrito como la entrega el servidor (los totales de PRUEBA se arman aquí, no en el código bajo prueba). */
export function makeSnapshot(lines: CartLine[], extra: Partial<CartSnapshot> = {}): CartSnapshot {
  const subtotal = lines.reduce((n, l) => n + l.line_total, 0);
  const blocking = lines.some((l) => l.blocking);
  return {
    cart_id: "cart-1",
    status: "active",
    currency: "BOB",
    reserve_on_add: true,
    ttl_seconds: 600,
    guarantee_days: 7,
    limits: { max_qty_per_variant: 10, max_lines: 30, max_units: 30 },
    lines,
    totals: {
      subtotal,
      item_count: lines.reduce((n, l) => n + l.qty, 0),
      line_count: lines.length,
      shipping: null,
      discount: null,
      total: subtotal,
    },
    reservation: {
      state: lines.length ? "held" : "none",
      expires_at: lines.length ? "2026-11-03T12:10:00.000Z" : null,
    },
    can_checkout: lines.length > 0 && !blocking,
    ...extra,
  };
}

export function okResponse(
  cart: CartSnapshot | null,
  extra: Partial<CartResponse> = {},
): FunctionResult<CartResponse> {
  return {
    ok: true,
    data: {
      token_state: cart ? "ok" : "none",
      server_time: new Date(NOW).toISOString(),
      cart,
      ...extra,
    },
  };
}

export const failure = (
  status: number,
  code = "error",
  retryAfter?: number,
): FunctionResult<CartResponse> => ({
  ok: false,
  status,
  code,
  message: code,
  ...(retryAfter ? { retryAfter } : {}),
});

/**
 * Servidor de mentira: guarda una foto y contesta a cada acción como lo haría el de verdad (de forma mínima). Los
 * importes de las líneas que cambian se rehacen aquí porque ES el servidor falso; el código bajo prueba nunca calcula.
 */
export class FakeCartServer {
  calls: CartRequestBody[] = [];
  snapshot: CartSnapshot | null;
  /** Para forzar la respuesta a un `set_item` (ajustes, topes, fallos de red…). */
  onSetItem:
    | ((
        body: Extract<CartRequestBody, { action: "set_item" }>,
      ) => FunctionResult<CartResponse> | null)
    | null = null;
  /** Para forzar la respuesta a un `set_coupon` (cualquier motivo de rechazo, un cupón guardado sin efecto…). */
  onSetCoupon:
    | ((
        body: Extract<CartRequestBody, { action: "set_coupon" }>,
      ) => FunctionResult<CartResponse> | null)
    | null = null;
  /** Respuesta fija para TODAS las peticiones (p. ej. un error de red). */
  forced: FunctionResult<CartResponse> | null = null;
  /** Qué contesta a «merge» (tras iniciar sesión). */
  mergeResult: Partial<CartResponse> = { merged: true };
  /** Cuánto adelanta (+) o atrasa (−) el reloj del servidor respecto al del dispositivo, en ms. */
  clockOffsetMs = 0;
  /** Cupones que conoce (clave: el código normalizado en mayúsculas y sin separadores). */
  coupons: Record<string, { percent: number; min?: number }> = {};
  /** El cupón guardado en la bolsa (normalizado). */
  couponCode: string | null = null;
  /** Lo ya quitado: si se vuelve a agregar (deshacer), regresa con sus datos (nombre, precio…). */
  private known = new Map<string, CartLine>();
  private gate: Promise<void> | null = null;
  private open: (() => void) | null = null;

  constructor(snapshot: CartSnapshot | null) {
    this.snapshot = snapshot;
    for (const line of snapshot?.lines ?? []) this.known.set(line.variant_id, line);
  }

  readonly api: CartApi = {
    request: async (body) => {
      this.calls.push(body);
      if (this.gate) await this.gate;
      return this.handle(body);
    },
  };

  /** Las peticiones esperan hasta llamar a la función devuelta (para ver el estado «actualizando»). */
  pause(): () => void {
    this.gate = new Promise<void>((resolve) => {
      this.open = resolve;
    });
    return () => {
      this.open?.();
      this.gate = null;
    };
  }

  callsOf(action: CartRequestBody["action"]) {
    return this.calls.filter((c) => c.action === action);
  }

  private lines(): CartLine[] {
    return this.snapshot?.lines ?? [];
  }

  private rebuild(lines: CartLine[]): void {
    const extra = this.snapshot
      ? { limits: this.snapshot.limits, currency: this.snapshot.currency }
      : {};
    // Los descuentos de una foto anterior no sobreviven a un cambio: se rehacen aquí (o desaparecen si ya no hay cupón).
    const plain = lines.map((line) => {
      const copy = { ...line };
      delete copy.discount;
      delete copy.final_total;
      delete copy.discount_offers;
      return copy;
    });
    this.snapshot = this.withCoupon(makeSnapshot(plain, extra));
  }

  /** El servidor falso aplica un porcentaje por línea (redondeado a centavos) si hay cupón y llega al mínimo. */
  private withCoupon(snapshot: CartSnapshot): CartSnapshot {
    const def = this.couponCode ? this.coupons[this.couponCode] : undefined;
    if (!def || !this.couponCode) return snapshot;
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const missing = def.min !== undefined ? round2(def.min - snapshot.totals.subtotal) : 0;
    if (missing > 0) {
      return {
        ...snapshot,
        discounts: {
          applied: [],
          rejected: [{ code: this.couponCode, reason: "min_not_reached", missing }],
          coupon: { status: "rejected", code: this.couponCode, reason: "min_not_reached", missing },
          free_shipping: false,
        },
      };
    }
    const lines = snapshot.lines.map((l) => {
      const discount = round2((l.line_total * def.percent) / 100);
      return {
        ...l,
        discount,
        final_total: round2(l.line_total - discount),
        discount_offers:
          discount > 0
            ? [
                {
                  discount_id: "d1",
                  name: `Cupón ${this.couponCode}`,
                  kind: "percent",
                  amount: discount,
                  coupon: true,
                },
              ]
            : [],
      };
    });
    const total = round2(lines.reduce((n, l) => n + (l.discount ?? 0), 0));
    return {
      ...snapshot,
      lines,
      totals: {
        ...snapshot.totals,
        discount: total > 0 ? total : null,
        total: round2(snapshot.totals.subtotal - total),
      },
      discounts: {
        applied: [
          {
            discount_id: "d1",
            coupon_id: "c1",
            name: `Cupón ${this.couponCode}`,
            kind: "percent",
            amount: total,
            automatic: false,
            free_shipping: false,
          },
        ],
        rejected: [],
        coupon: {
          status: "applied",
          code: this.couponCode,
          reason: null,
          missing: null,
          discount_id: "d1",
          coupon_id: "c1",
          name: `Cupón ${this.couponCode}`,
          kind: "percent",
        },
        free_shipping: false,
      },
    };
  }

  private handle(body: CartRequestBody): FunctionResult<CartResponse> {
    if (this.forced) return this.forced;
    const result = this.dispatch(body);
    // La hora del servidor avanza con la del dispositivo (más su desfase), como la real.
    return result.ok
      ? {
          ok: true,
          data: {
            ...result.data,
            server_time: new Date(Date.now() + this.clockOffsetMs).toISOString(),
          },
        }
      : result;
  }

  private dispatch(body: CartRequestBody): FunctionResult<CartResponse> {
    switch (body.action) {
      case "get":
      case "refresh":
        return okResponse(this.snapshot);
      case "clear":
        this.rebuild([]);
        return okResponse(this.snapshot);
      case "accept_prices": {
        this.rebuild(
          this.lines().map((l) =>
            body.variant_id && l.variant_id !== body.variant_id
              ? l
              : {
                  ...l,
                  price_notice: null,
                  status: "ok",
                  blocking: false,
                  unit_price: l.current_price ?? l.unit_price,
                  price_at_add: l.current_price ?? l.unit_price,
                  line_total: (l.current_price ?? l.unit_price) * l.billable_qty,
                },
          ),
        );
        return okResponse(this.snapshot);
      }
      case "remove_item":
        this.rebuild(this.lines().filter((l) => l.variant_id !== body.variant_id));
        return okResponse(this.snapshot, { outcome: "removed" });
      case "merge":
        return okResponse(this.snapshot, this.mergeResult);
      case "set_coupon": {
        const forcedCoupon = this.onSetCoupon?.(body);
        if (forcedCoupon) return forcedCoupon;
        const norm = body.code.toUpperCase().replace(/[\s_-]+/g, "");
        if (!this.snapshot) return okResponse(null, { outcome: "no_cart" });
        if (!this.coupons[norm]) {
          return okResponse(this.snapshot, { outcome: "coupon_rejected", reason: "invalid_code" });
        }
        if (this.couponCode && this.couponCode !== norm) {
          return okResponse(this.snapshot, {
            outcome: "coupon_rejected",
            reason: "coupon_already_applied",
          });
        }
        this.couponCode = norm;
        this.rebuild(this.lines());
        const missing = this.snapshot?.discounts?.coupon.missing ?? null;
        return okResponse(this.snapshot, {
          outcome: "coupon_set",
          ...(missing !== null ? { reason: "min_not_reached", missing } : {}),
        });
      }
      case "remove_coupon":
        this.couponCode = null;
        this.rebuild(this.lines());
        return okResponse(this.snapshot, { outcome: "coupon_removed" });
      case "set_item": {
        const forced = this.onSetItem?.(body);
        if (forced) return forced;
        const existing = this.lines().find((l) => l.variant_id === body.variant_id);
        if (existing) this.known.set(existing.variant_id, existing);
        if (body.qty === 0) {
          this.rebuild(this.lines().filter((l) => l.variant_id !== body.variant_id));
          return okResponse(this.snapshot, { outcome: "removed" });
        }
        const base =
          existing ?? this.known.get(body.variant_id) ?? makeLine(body.variant_id, body.qty);
        const unit = base.unit_price;
        // Un ajuste que ya cabe en lo disponible deja de ser «pocas unidades» (el servidor de verdad lo recalcula igual).
        const fits = base.status === "low_stock" && body.qty <= base.available;
        const next = {
          ...base,
          ...(fits ? { status: "ok" as const, blocking: false } : {}),
          qty: body.qty,
          billable_qty: body.qty,
          reserved_qty: body.qty,
          line_total: unit * body.qty,
        };
        this.rebuild(
          existing
            ? this.lines().map((l) => (l.variant_id === body.variant_id ? next : l))
            : [...this.lines(), next],
        );
        return okResponse(this.snapshot, { outcome: "ok", requested: body.qty, applied: body.qty });
      }
    }
  }
}

/** Guarda lo último que dijo `useCart()` para que la prueba pueda mirar el estado y llamar al almacén. */
export function CartSpy({ into }: { into: { current: CartContextValue | null } }) {
  into.current = useCart();
  return null;
}

/** Muestra la ruta actual para comprobar a dónde se navegó (y con qué estado). */
export function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location" data-state={JSON.stringify(location.state ?? null)}>
      {`${location.pathname}${location.search}`}
    </div>
  );
}

export interface RenderCartOptions {
  /** Foto inicial del servidor. Con ella el invitado arranca con espejo local (token + foto), como tras una visita previa. */
  snapshot?: CartSnapshot | null;
  server?: FakeCartServer;
  auth?: AuthContextValue;
  path?: string;
}

/** Una persona con sesión (para el botón «Pagar»). */
export function signedIn(extra: Partial<AuthContextValue> = {}): AuthContextValue {
  return fakeAuth({
    status: "authenticated",
    session: { user: { id: "user-1" } } as unknown as Session,
    ...extra,
  });
}

/**
 * Renderiza `ui` dentro de un `CartProvider` REAL con un servidor de mentira (sin red). Sin sesión es un invitado: si hay
 * `snapshot`, se parte de un espejo local con esa foto (pinta al instante) y el almacén la relee del servidor falso.
 */
export function renderWithCart(ui: ReactElement, options: RenderCartOptions = {}) {
  const { snapshot = null, auth = fakeAuth(), path = "/carrito" } = options;
  const server = options.server ?? new FakeCartServer(snapshot);
  const storage = memoryCartStorage(snapshot ? { token: TOKEN, snapshot, savedAt: NOW } : null);
  const cart: { current: CartContextValue | null } = { current: null };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <WithAuth value={auth}>
        <MemoryRouter initialEntries={[path]}>
          <CartProvider api={server.api} storage={storage}>
            <CartSpy into={cart} />
            {ui}
            <LocationProbe />
          </CartProvider>
        </MemoryRouter>
      </WithAuth>
    </QueryClientProvider>,
  );
  return { ...view, server, storage, queryClient, cart: () => cart.current as CartContextValue };
}

/** Deja correr las promesas pendientes (respuestas del servidor falso) dentro de `act`. */
export async function flush(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}
