import { callFunction, type FunctionResult } from "@/lib/functions";
import { getSupabase } from "@/lib/supabase";
import type { CancelResponse, CheckoutChoices, CreateResponse, PreviewResponse } from "./types";

async function sessionToken(): Promise<string | undefined> {
  try {
    const { data } = await getSupabase().auth.getSession();
    return data.session?.access_token ?? undefined;
  } catch {
    return undefined;
  }
}

/** Las claves sin valor NO se envían: el esquema del servidor es estricto y no acepta `null` donde espera un UUID. */
function compact<T extends Record<string, unknown>>(body: T): T {
  return Object.fromEntries(
    Object.entries(body).filter(([, value]) => value !== undefined && value !== null),
  ) as T;
}

function destination(choices: CheckoutChoices) {
  return {
    shipping_method: choices.shippingMethod,
    address_id: choices.addressId,
    tax_profile_id: choices.taxProfileId,
    slot_id: choices.slotId,
    delivery_date: choices.deliveryDate,
    payment_method: choices.paymentMethod,
  };
}

async function request<T>(body: Record<string, unknown>): Promise<FunctionResult<T>> {
  const token = await sessionToken();
  return callFunction<T>("checkout", compact(body), token ? { token } : {});
}

/** Vista previa: los mismos números que el pedido, sin escribir nada. */
export const previewCheckout = (choices: CheckoutChoices) =>
  request<PreviewResponse>({ action: "preview", ...destination(choices) });

export interface ContactInput {
  name: string;
  email: string | null;
  phone: string;
}

/** Crea el pedido. `expectedTotal` es el total que la persona VIO; `idempotencyKey` evita duplicados por reintento. */
export const createOrder = (
  choices: CheckoutChoices & { paymentMethod: string },
  contact: ContactInput,
  expectedTotal: number,
  idempotencyKey: string,
) =>
  request<CreateResponse>({
    action: "create",
    ...destination(choices),
    contact_name: contact.name,
    contact_email: contact.email ?? undefined,
    contact_phone: contact.phone,
    expected_total: expectedTotal,
    idempotency_key: idempotencyKey,
  });

export const cancelOrder = (orderId: string, reason?: string) =>
  request<CancelResponse>({
    action: "cancel",
    order_id: orderId,
    reason: reason?.trim() || undefined,
  });
