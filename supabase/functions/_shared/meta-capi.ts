import { z } from "https://esm.sh/zod@3.25.76";
import { HttpError } from "./errors.ts";

/**
 * API de conversiones de Meta (Sprint 15) — SOLO `Purchase`. El navegador ya envía el evento con el Pixel; este lo reenvía desde el
 * servidor con LOS DATOS REALES DEL PEDIDO (el navegador no puede inventar un valor) y con el mismo `event_id`, así Meta cuenta una compra.
 * Nunca viaja un dato personal sin cifrar salvo lo que Meta exige en claro (IP y navegador); correo y teléfono van con SHA-256.
 * Sin Pixel o sin token (la tienda como nace) no hace nada ni llama a nadie.
 */
export const GRAPH_VERSION_DEFAULT = "v24.0";

export const capiBodySchema = z
  .object({
    order_number: z.string().regex(/^[A-Z]{2,5}-[0-9]{6,}$/),
    event_id: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/),
    fbp: z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,100}$/)
      .optional(),
    fbc: z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,200}$/)
      .optional(),
    source_url: z
      .string()
      .max(300)
      .regex(/^https:\/\/[^\s]+$/)
      .optional(),
  })
  .strict();
export type CapiInput = z.infer<typeof capiBodySchema>;

/** El `event_id` de la compra de un pedido: el mismo que el Pixel del navegador (`purchaseEventId` en el cliente). */
export const purchaseEventId = (orderNumber: string) => `purchase.${orderNumber}`;

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Meta pide el correo en minúsculas y sin espacios, y el teléfono solo con dígitos (con código de país, sin «+»), ANTES de cifrar. */
export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const normalizePhone = (phone: string) => phone.replace(/\D/g, "");

export interface CapiOrder {
  number: string;
  status: string;
  currency: string;
  total: number;
  profileId: string;
  contactEmail: string | null;
  contactPhone: string;
  createdAt: string;
  items: { productId: string }[];
}

export interface CapiEvent {
  event_name: "Purchase";
  event_time: number;
  event_id: string;
  action_source: "website";
  event_source_url?: string;
  user_data: Record<string, unknown>;
  custom_data: Record<string, unknown>;
}

export async function buildPurchaseEvent(
  order: CapiOrder,
  input: CapiInput,
  context: { ip: string; userAgent: string; nowSeconds: number },
): Promise<CapiEvent> {
  const userData: Record<string, unknown> = {
    external_id: [await sha256Hex(order.profileId)],
    ph: [await sha256Hex(normalizePhone(order.contactPhone))],
  };
  if (order.contactEmail) {
    userData.em = [await sha256Hex(normalizeEmail(order.contactEmail))];
  }
  if (input.fbp) userData.fbp = input.fbp;
  if (input.fbc) userData.fbc = input.fbc;
  if (context.ip && context.ip !== "unknown") {
    userData.client_ip_address = context.ip;
  }
  if (context.userAgent) {
    userData.client_user_agent = context.userAgent.slice(0, 500);
  }
  return {
    event_name: "Purchase",
    event_time: context.nowSeconds,
    event_id: input.event_id,
    action_source: "website",
    ...(input.source_url ? { event_source_url: input.source_url } : {}),
    user_data: userData,
    custom_data: {
      currency: order.currency,
      value: order.total,
      order_id: order.number,
      content_type: "product_group",
      content_ids: [...new Set(order.items.map((i) => i.productId))],
      num_items: order.items.length,
    },
  };
}

export interface CapiDeps {
  /** El ID del Pixel de la tienda (`analytics_meta_pixel_id`); vacío = sin Pixel. */
  pixelId: () => Promise<string>;
  /** El pedido de ESA persona (nunca el de otra); `null` si no existe o no es suyo. */
  order: (userId: string, number: string) => Promise<CapiOrder | null>;
  /** Anota que este pedido ya se envió; `false` si ya estaba anotado. */
  claim: (orderNumber: string) => Promise<boolean>;
  fetch: typeof fetch;
  token: string;
  testEventCode?: string;
  graphVersion: string;
  now: () => number;
}

export type CapiResult =
  | { sent: true }
  | {
      sent: false;
      reason:
        | "not_configured"
        | "order_not_found"
        | "order_not_eligible"
        | "already_sent"
        | "meta_rejected"
        | "meta_unreachable";
      status?: number;
    };

const ELIGIBLE = new Set([
  "pending_payment",
  "paid",
  "preparing",
  "shipped",
  "delivered",
  "completed",
]);
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export async function sendPurchase(
  userId: string,
  input: CapiInput,
  context: { ip: string; userAgent: string },
  deps: CapiDeps,
): Promise<CapiResult> {
  // El event_id es el de ESE pedido: nada de ids inventados (rompería la deduplicación y dejaría repetir envíos).
  if (input.event_id !== purchaseEventId(input.order_number)) {
    throw new HttpError(
      400,
      "invalid_event_id",
      "El identificador del evento no corresponde al pedido",
    );
  }
  const pixelId = (await deps.pixelId()).trim();
  if (!pixelId || !deps.token) return { sent: false, reason: "not_configured" };
  const order = await deps.order(userId, input.order_number);
  if (!order) return { sent: false, reason: "order_not_found" };
  if (!ELIGIBLE.has(order.status) || deps.now() - Date.parse(order.createdAt) > MAX_AGE_MS) {
    return { sent: false, reason: "order_not_eligible" };
  }
  if (!(await deps.claim(order.number))) {
    return { sent: false, reason: "already_sent" };
  }

  const event = await buildPurchaseEvent(order, input, {
    ...context,
    nowSeconds: Math.floor(deps.now() / 1000),
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await deps.fetch(
      `https://graph.facebook.com/${deps.graphVersion}/${pixelId}/events`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: [event],
          access_token: deps.token,
          ...(deps.testEventCode ? { test_event_code: deps.testEventCode } : {}),
        }),
        signal: controller.signal,
      },
    );
    await res.body?.cancel();
    return res.ok ? { sent: true } : { sent: false, reason: "meta_rejected", status: res.status };
  } catch {
    return { sent: false, reason: "meta_unreachable" };
  } finally {
    clearTimeout(timer);
  }
}
