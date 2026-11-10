import { SHIPPING_ERROR_CODES, type ShippingError } from "@/features/shipping/types";
import { t, type MessageKey } from "@/i18n";
import { normalizeEmail, normalizePhone } from "@shared/identity";
import type { CheckoutChoices, CheckoutError, CheckoutPreview, PaymentMethodOption } from "./types";

/** Lo que se escribe en «Contacto». Todo texto: la validación decide qué se manda al servidor. */
export interface ContactForm {
  name: string;
  email: string;
  phone: string;
}

export type ContactField = keyof ContactForm;
export type ContactErrors = Partial<Record<ContactField, string>>;

export interface ValidContact {
  name: string;
  email: string | null;
  phone: string;
}

/**
 * Valida el contacto. El servidor vuelve a validar todo; esto solo evita un viaje inútil y explica el problema junto al
 * campo. El teléfono se normaliza a E.164 (Bolivia por omisión), el mismo criterio que el resto de la tienda.
 */
export function validateContact(
  form: ContactForm,
): { ok: true; value: ValidContact } | { ok: false; errors: ContactErrors } {
  const errors: ContactErrors = {};
  const name = form.name.trim().replace(/\s+/g, " ");
  if (name === "") errors.name = t("checkout.contact.errors.nameRequired");
  else if (name.length > 120) errors.name = t("checkout.contact.errors.nameRequired");

  let email: string | null = null;
  if (form.email.trim() !== "") {
    const result = normalizeEmail(form.email);
    if (result.ok) email = result.email;
    else errors.email = t("checkout.contact.errors.emailInvalid");
  }

  let phone = "";
  if (form.phone.trim() === "") errors.phone = t("checkout.contact.errors.phoneRequired");
  else {
    const result = normalizePhone(form.phone);
    if (result.ok) phone = result.e164;
    else errors.phone = t("checkout.contact.errors.phoneInvalid");
  }

  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : { ok: true, value: { name, email, phone } };
}

/** El primer campo con error, en el orden en que aparecen en pantalla (para llevarle el foco). */
export function firstInvalidField(errors: ContactErrors): ContactField | null {
  return (["name", "email", "phone"] as const).find((field) => errors[field] !== undefined) ?? null;
}

const SHIPPING_CODES: ReadonlySet<string> = new Set(SHIPPING_ERROR_CODES);

/** Qué parte del formulario corrige cada error del servidor (para mostrarlo junto a ella y moverle el foco). */
export type ErrorSection = "delivery" | "schedule" | "tax" | "payment" | "contact" | "general";

const SECTION_BY_CODE: Record<string, ErrorSection> = {
  address_required: "delivery",
  address_invalid: "delivery",
  method_not_found: "delivery",
  method_inactive: "delivery",
  no_origin: "delivery",
  location_required: "delivery",
  invalid_coordinates: "delivery",
  blocked_zone: "delivery",
  coverage_not_configured: "delivery",
  out_of_coverage: "delivery",
  no_rate: "delivery",
  date_required: "schedule",
  slot_required: "schedule",
  slot_not_found: "schedule",
  slot_mismatch: "schedule",
  slot_full: "schedule",
  slot_invalid: "schedule",
  date_past: "schedule",
  date_blocked: "schedule",
  date_too_far: "schedule",
  date_too_soon: "schedule",
  tax_profile_invalid: "tax",
  tax_profile_required: "tax",
  payment_method_required: "payment",
  payment_unavailable: "payment",
};

export interface ErrorLine {
  code: string;
  section: ErrorSection;
  message: string;
}

const OWN_MESSAGES = new Set([
  "cart_empty",
  "address_required",
  "address_invalid",
  "tax_profile_invalid",
  "tax_profile_required",
  "payment_method_required",
  "payment_unavailable",
  "account_inactive",
  "slot_invalid",
  "too_many_open_orders",
  "idempotency_conflict",
  "stale_prices",
]);

/** El texto de un error del servidor. Un código que esta versión no conoce no rompe nada: mensaje genérico. */
export function errorMessage(error: Pick<CheckoutError, "code" | "reason">): string {
  if (error.code === "payment_unavailable" && error.reason === "over_max_amount") {
    return t("checkout.payment.unavailableOverAmount");
  }
  if (OWN_MESSAGES.has(error.code)) return t(`checkout.errors.${error.code}` as MessageKey);
  if (SHIPPING_CODES.has(error.code))
    return t(`shipping.errors.${error.code as ShippingError["code"]}` as MessageKey);
  return t("checkout.errors.generic");
}

export function toErrorLines(errors: readonly CheckoutError[]): ErrorLine[] {
  const seen = new Set<string>();
  const lines: ErrorLine[] = [];
  for (const error of errors) {
    const key = `${error.code}:${error.reason ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push({
      code: error.code,
      section: SECTION_BY_CODE[error.code] ?? "general",
      message: errorMessage(error),
    });
  }
  return lines;
}

/** El método de pago preferido al abrir: el primero disponible (el servidor ya los entrega ordenados). */
export function defaultPaymentMethod(
  methods: readonly PaymentMethodOption[],
  current: string | undefined,
): string | undefined {
  const keep = methods.find((m) => m.code === current && m.available);
  return (keep ?? methods.find((m) => m.available))?.code;
}

/** Texto del botón principal: WhatsApp dice exactamente eso (BR-CHK-02); el resto, «Confirmar pedido». */
export function submitLabelKey(provider: string | undefined): MessageKey {
  return provider === "whatsapp" ? "checkout.submit.whatsapp" : "checkout.submit.generic";
}

/** Lo que cambia el cálculo del servidor, para la clave de la consulta y para detectar «lo que vio» (BR-CHK-04). */
export function choicesKey(choices: CheckoutChoices): string {
  return [
    choices.shippingMethod,
    choices.addressId ?? "",
    choices.taxProfileId ?? "",
    choices.slotId ?? "",
    choices.deliveryDate ?? "",
    choices.paymentMethod ?? "",
  ].join("|");
}

/** El total que la persona está viendo (null mientras falte el envío: no hay total honesto sin él). */
export const shownTotal = (preview: CheckoutPreview | undefined): number | null =>
  preview?.totals.total ?? null;

/** Puede enviarse el pedido: hay vista previa sin errores, total conocido y la bolsa se puede pagar. */
export function canSubmit(preview: CheckoutPreview | undefined): boolean {
  return Boolean(preview && preview.ok && preview.can_checkout && preview.totals.total !== null);
}
