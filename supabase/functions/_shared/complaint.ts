import { z } from "https://esm.sh/zod@3.25.76";
import { HttpError } from "./errors.ts";
import { normalizeEmail, normalizePhone } from "./identity.ts";

/**
 * Canal de reclamos (Sprint 15): lo que llega del formulario público se valida, se normaliza y se acota ANTES de tocar la base; un robot
 * que llena el campo trampa (`website`) recibe un «recibido» sin que se guarde nada. La base vuelve a validar todo (restricciones de la
 * tabla) y tiene su propio cortafuegos.
 */
export const COMPLAINT_KINDS = ["product", "delivery", "payment", "service", "other"] as const;

export const complaintSchema = z
  .object({
    contact_name: z.string().trim().min(1).max(120),
    contact_email: z.string().max(254).optional(),
    contact_phone: z.string().max(40).optional(),
    phone_country: z.string().length(2).optional(),
    order_number: z.string().trim().max(30).optional(),
    kind: z.enum(COMPLAINT_KINDS),
    detail: z.string().trim().min(20).max(2000),
    /** Campo trampa: las personas no lo ven ni lo llenan. */
    website: z.string().max(200).optional(),
  })
  .strict();
export type ComplaintInput = z.infer<typeof complaintSchema>;

/** Lo que se manda a `submit_complaint`: contacto normalizado (correo en minúsculas, teléfono E.164) y el pedido en mayúsculas. */
export function prepareComplaint(input: ComplaintInput): Record<string, unknown> {
  const hasEmail = Boolean(input.contact_email?.trim());
  const hasPhone = Boolean(input.contact_phone?.trim());
  if (!hasEmail && !hasPhone) {
    throw new HttpError(
      400,
      "contact_required",
      "Déjanos un correo o un teléfono para responderte",
    );
  }
  let email: string | null = null;
  if (hasEmail) {
    const result = normalizeEmail(input.contact_email!);
    if (!result.ok) {
      throw new HttpError(400, "invalid_email", "El correo no es válido");
    }
    email = result.email;
  }
  let phone: string | null = null;
  if (hasPhone) {
    let result;
    try {
      result = normalizePhone(input.contact_phone!, input.phone_country ?? "BO");
    } catch {
      throw new HttpError(400, "invalid_phone", "El teléfono no es válido");
    }
    if (!result.ok) {
      throw new HttpError(400, "invalid_phone", "El teléfono no es válido");
    }
    phone = result.e164;
  }
  const order = input.order_number?.trim().toUpperCase() ?? "";
  if (order !== "" && !/^[A-Z]{2,5}-[0-9]{6,}$/.test(order)) {
    throw new HttpError(400, "invalid_order_number", "El número de pedido no es válido");
  }
  return {
    contact_name: input.contact_name,
    contact_email: email,
    contact_phone: phone,
    order_number: order === "" ? null : order,
    kind: input.kind,
    detail: input.detail,
  };
}

export interface ComplaintDeps {
  /** El id de la cuenta si quien reclama tiene sesión válida; `null` si es anónima (o la sesión no vale). */
  userId: () => Promise<string | null>;
  /** Huella de la red (nunca la IP). */
  fingerprint: () => Promise<string>;
  /** Límites de frecuencia: lanzan 429 si se pasan. */
  limit: (key: string, max: number, windowSeconds: number) => Promise<void>;
  ip: string;
  submit: (
    data: Record<string, unknown>,
    profileId: string | null,
    ipHash: string,
  ) => Promise<{ number: string; due_at: string }>;
}

export type ComplaintResult = { number: string | null; due_at: string | null };

export async function receiveComplaint(
  input: ComplaintInput,
  deps: ComplaintDeps,
): Promise<ComplaintResult> {
  // Primero los límites (también para los robots): inundar el canal cuesta lo mismo que usarlo.
  await deps.limit(`complaint:ip:${deps.ip}`, 5, 60 * 60);
  await deps.limit("complaint:global", 300, 24 * 60 * 60);
  // El campo trampa: un «recibido» igual al verdadero, sin guardar nada.
  if (input.website && input.website.trim() !== "") {
    return { number: null, due_at: null };
  }
  const data = prepareComplaint(input);
  const userId = await deps.userId();
  if (userId) await deps.limit(`complaint:user:${userId}`, 10, 24 * 60 * 60);
  const saved = await deps.submit(data, userId, await deps.fingerprint());
  return { number: saved.number, due_at: saved.due_at };
}
