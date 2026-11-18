import { normalizeEmail, normalizePhone } from "@shared/identity";

/** Las mismas reglas que la función `complaint` y la base: lo que no pasa aquí tampoco pasaría allá (aquí se dice antes y en palabras). */
export const COMPLAINT_KINDS = ["product", "delivery", "payment", "service", "other"] as const;
export type ComplaintKind = (typeof COMPLAINT_KINDS)[number];

export interface ComplaintForm {
  name: string;
  email: string;
  phone: string;
  order: string;
  kind: ComplaintKind | "";
  detail: string;
  /** Campo trampa: debe viajar vacío. */
  website: string;
}

export const EMPTY_FORM: ComplaintForm = {
  name: "",
  email: "",
  phone: "",
  order: "",
  kind: "",
  detail: "",
  website: "",
};

export type ComplaintErrors = Partial<
  Record<"name" | "contact" | "email" | "phone" | "order" | "kind" | "detail", string>
>;

export const DETAIL_MIN = 20;
export const DETAIL_MAX = 2000;
const ORDER_RE = /^[A-Z]{2,5}-[0-9]{6,}$/;

export type FieldKey = keyof ComplaintErrors;
/** El orden en que se recorre el formulario (para llevar el foco al primer campo con error). */
export const FIELD_ORDER: readonly FieldKey[] = [
  "name",
  "contact",
  "email",
  "phone",
  "order",
  "kind",
  "detail",
];

export function validateComplaint(form: ComplaintForm): ComplaintErrors {
  const errors: ComplaintErrors = {};
  if (form.name.trim() === "") errors.name = "nameRequired";
  const hasEmail = form.email.trim() !== "";
  const hasPhone = form.phone.trim() !== "";
  if (!hasEmail && !hasPhone) errors.contact = "contactRequired";
  if (hasEmail && !normalizeEmail(form.email).ok) errors.email = "email";
  if (hasPhone) {
    let ok = false;
    try {
      ok = normalizePhone(form.phone, "BO").ok;
    } catch {
      ok = false;
    }
    if (!ok) errors.phone = "phone";
  }
  const order = form.order.trim().toUpperCase();
  if (order !== "" && !ORDER_RE.test(order)) errors.order = "order";
  if (form.kind === "") errors.kind = "kindRequired";
  const detail = form.detail.trim();
  if (detail.length < DETAIL_MIN) errors.detail = "detailShort";
  else if (detail.length > DETAIL_MAX) errors.detail = "detailLong";
  return errors;
}

export const firstInvalid = (errors: ComplaintErrors): FieldKey | null =>
  FIELD_ORDER.find((key) => errors[key] !== undefined) ?? null;

/** El cuerpo que recibe la función (solo lo que tiene valor; el correo y el teléfono tal como se escribieron: el servidor los normaliza). */
export function toRequestBody(form: ComplaintForm): Record<string, string> {
  const body: Record<string, string> = {
    contact_name: form.name.trim(),
    kind: form.kind,
    detail: form.detail.trim(),
  };
  if (form.email.trim() !== "") body.contact_email = form.email.trim();
  if (form.phone.trim() !== "") body.contact_phone = form.phone.trim();
  if (form.order.trim() !== "") body.order_number = form.order.trim();
  if (form.website !== "") body.website = form.website;
  return body;
}
