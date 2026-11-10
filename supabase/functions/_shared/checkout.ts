import { z } from "https://esm.sh/zod@3.25.76";

/**
 * Lógica pura de la función `checkout` (sin red ni base): el esquema de las peticiones, los topes y qué función SQL corresponde a
 * cada acción. Así se prueba entera con Deno sin levantar nada.
 *
 * Decisión de S7 sobre el aviso de zod < 4.6.6 (GHSA-mrhx-c7xc-m3w5): NINGUNA petición lleva listas. Las líneas del pedido salen
 * del carrito de la clienta en el servidor; aquí solo viajan valores sueltos, el esquema es `.strict()` y el cuerpo se corta en 2 kB.
 */
export const MAX_BODY_BYTES = 2048;

/** Topes de tasa. Crear un pedido bloquea stock y números: va mucho más apretado que mirar la vista previa. */
export const LIMITS = {
  anyPerIp: { max: 600, windowSeconds: 60 },
  previewPerUser: { max: 60, windowSeconds: 60 },
  createPerUser: { max: 10, windowSeconds: 600 },
  createPerIp: { max: 60, windowSeconds: 600 },
  cancelPerUser: { max: 20, windowSeconds: 600 },
} as const;

const uuid = z.string().uuid();
const code = z.string().regex(/^[a-z][a-z0-9_]{1,31}$/);

/** «AAAA-MM-DD» de un día que EXISTE (2026-02-31 no): la base lanzaría un error de fecha inválida y sería un 500. */
export function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
const isoDate = z.string().refine(isRealDate, "fecha inválida");

const destination = {
  address_id: uuid.optional(),
  tax_profile_id: uuid.optional(),
  shipping_method: code,
  slot_id: uuid.optional(),
  delivery_date: isoDate.optional(),
};

export const checkoutRequestSchema = z.discriminatedUnion("action", [
  // Vista previa: mismos números que el pedido, sin escribir nada. El método de pago puede faltar todavía.
  z
    .object({ action: z.literal("preview"), ...destination, payment_method: code.optional() })
    .strict(),
  z
    .object({
      action: z.literal("create"),
      ...destination,
      payment_method: code,
      contact_name: z.string().trim().min(1).max(120),
      contact_email: z.string().max(254).email().optional(),
      contact_phone: z.string().regex(/^\+[1-9][0-9]{7,14}$/),
      // El total que la persona VIO: si ya no es el que corresponde, no se crea y se le muestra la diferencia (BR-CHK-04).
      expected_total: z.number().min(0).max(1_000_000_000),
      idempotency_key: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    })
    .strict(),
  z
    .object({
      action: z.literal("cancel"),
      order_id: uuid,
      reason: z.string().trim().max(300).optional(),
    })
    .strict(),
]);
export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;

export interface RpcPlan {
  fn: string;
  args: Record<string, unknown>;
}

/** Qué función SQL ejecuta cada acción. La identidad SIEMPRE es la del JWT verificado: nunca viene en el cuerpo. */
export function planRpc(request: CheckoutRequest, userId: string): RpcPlan {
  switch (request.action) {
    case "preview":
      return {
        fn: "checkout_preview",
        args: {
          p_profile_id: userId,
          p_address_id: request.address_id ?? null,
          p_tax_profile_id: request.tax_profile_id ?? null,
          p_shipping_method: request.shipping_method,
          p_slot_id: request.slot_id ?? null,
          p_delivery_date: request.delivery_date ?? null,
          p_payment_method: request.payment_method ?? null,
        },
      };
    case "create":
      return {
        fn: "create_order",
        args: {
          p_profile_id: userId,
          p_address_id: request.address_id ?? null,
          p_tax_profile_id: request.tax_profile_id ?? null,
          p_shipping_method: request.shipping_method,
          p_slot_id: request.slot_id ?? null,
          p_delivery_date: request.delivery_date ?? null,
          p_payment_method: request.payment_method,
          p_contact_name: request.contact_name,
          p_contact_email: request.contact_email ?? null,
          p_contact_phone: request.contact_phone,
          p_expected_total: request.expected_total,
          p_idempotency_key: request.idempotency_key,
        },
      };
    case "cancel":
      return {
        fn: "cancel_order_by_customer",
        args: {
          p_profile_id: userId,
          p_order_id: request.order_id,
          p_reason: request.reason ?? null,
        },
      };
  }
}

/** Cuántos límites por usuario aplican a cada acción (para no repetir la lógica en la función). */
export function userLimit(action: CheckoutRequest["action"]): {
  name: string;
  max: number;
  windowSeconds: number;
} {
  switch (action) {
    case "preview":
      return { name: "preview", ...LIMITS.previewPerUser };
    case "create":
      return { name: "create", ...LIMITS.createPerUser };
    case "cancel":
      return { name: "cancel", ...LIMITS.cancelPerUser };
  }
}
