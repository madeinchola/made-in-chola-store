import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  checkoutRequestSchema,
  isRealDate,
  LIMITS,
  MAX_BODY_BYTES,
  planRpc,
  userLimit,
} from "./checkout.ts";
import { HttpError } from "./errors.ts";
import { parseBodyLimited } from "./validate.ts";

const USER = "11111111-1111-4111-8111-111111111111";
const ADDRESS = "22222222-2222-4222-8222-222222222222";
const TAX = "33333333-3333-4333-8333-333333333333";
const SLOT = "44444444-4444-4444-8444-444444444444";
const ORDER = "55555555-5555-4555-8555-555555555555";

const CREATE = {
  action: "create",
  address_id: ADDRESS,
  tax_profile_id: TAX,
  shipping_method: "delivery",
  slot_id: SLOT,
  delivery_date: "2026-12-05",
  payment_method: "whatsapp",
  contact_name: "Ana Pérez",
  contact_email: "ana@example.com",
  contact_phone: "+59171234567",
  expected_total: 255,
  idempotency_key: "key-0123456789",
} as const;

const ok = (value: unknown) => checkoutRequestSchema.safeParse(value).success;

Deno.test("una petición de creación completa es válida", () => {
  assert(ok(CREATE));
});

Deno.test("la vista previa admite pedir sin método de pago ni dirección todavía", () => {
  assert(ok({ action: "preview", shipping_method: "recojo" }));
  assert(
    ok({
      action: "preview",
      shipping_method: "delivery",
      address_id: ADDRESS,
      payment_method: "whatsapp",
    }),
  );
});

Deno.test("crear exige método de pago, contacto, total esperado y llave", () => {
  for (const key of [
    "payment_method",
    "contact_name",
    "contact_phone",
    "expected_total",
    "idempotency_key",
    "shipping_method",
  ]) {
    const copy: Record<string, unknown> = { ...CREATE };
    delete copy[key];
    assertEquals(ok(copy), false, `sin ${key} debería fallar`);
  }
});

Deno.test("el correo y los datos fiscales y la franja son opcionales al crear", () => {
  const copy: Record<string, unknown> = { ...CREATE };
  delete copy.contact_email;
  delete copy.tax_profile_id;
  delete copy.slot_id;
  delete copy.delivery_date;
  delete copy.address_id;
  assert(ok(copy));
});

Deno.test(
  "el esquema es estricto: ningún campo de más (ni precios, ni descuentos, ni la identidad)",
  () => {
    for (const extra of [
      { total: 1 },
      { discount: 10 },
      { profile_id: USER },
      { lines: [] },
      { coupon: "X" },
      { unit_price: 1 },
    ]) {
      assertEquals(ok({ ...CREATE, ...extra }), false, JSON.stringify(extra));
    }
    assertEquals(ok({ action: "preview", shipping_method: "delivery", p_profile_id: USER }), false);
  },
);

Deno.test("una acción desconocida se rechaza", () => {
  assertEquals(ok({ action: "delete", order_id: ORDER }), false);
  assertEquals(ok({ shipping_method: "delivery" }), false);
});

Deno.test("los identificadores deben ser UUID y los códigos, minúsculas con guion bajo", () => {
  assertEquals(ok({ ...CREATE, address_id: "no-es-uuid" }), false);
  assertEquals(ok({ ...CREATE, slot_id: "123" }), false);
  assertEquals(ok({ ...CREATE, shipping_method: "Domicilio" }), false);
  assertEquals(ok({ ...CREATE, payment_method: "WhatsApp" }), false);
  assertEquals(ok({ ...CREATE, payment_method: "'; drop table orders;--" }), false);
});

Deno.test("el teléfono va en E.164", () => {
  assert(ok({ ...CREATE, contact_phone: "+5491122334455" }));
  for (const bad of ["71234567", "+0123456789", "+591 7123 4567", "+5", "", "+59171234567890123"]) {
    assertEquals(ok({ ...CREATE, contact_phone: bad }), false, bad);
  }
});

Deno.test("el total esperado es un número entre 0 y mil millones", () => {
  assert(ok({ ...CREATE, expected_total: 0 }));
  assert(ok({ ...CREATE, expected_total: 1_000_000_000 }));
  for (const bad of [-1, 1_000_000_001, "255", null, Number.NaN, Number.POSITIVE_INFINITY]) {
    assertEquals(ok({ ...CREATE, expected_total: bad }), false, String(bad));
  }
});

Deno.test("la llave de idempotencia tiene 8 a 64 caracteres seguros", () => {
  assert(ok({ ...CREATE, idempotency_key: "abcdefgh" }));
  assert(ok({ ...CREATE, idempotency_key: "a".repeat(64) }));
  for (const bad of ["abcdefg", "a".repeat(65), "con espacio 1", "ñandú-12345", "a/b/c/d/e/f"]) {
    assertEquals(ok({ ...CREATE, idempotency_key: bad }), false, bad);
  }
});

Deno.test("el nombre se recorta y no puede quedar vacío ni pasar de 120", () => {
  const parsed = checkoutRequestSchema.parse({ ...CREATE, contact_name: "  Ana  " });
  assertEquals((parsed as { contact_name: string }).contact_name, "Ana");
  assertEquals(ok({ ...CREATE, contact_name: "   " }), false);
  assertEquals(ok({ ...CREATE, contact_name: "a".repeat(121) }), false);
  assert(ok({ ...CREATE, contact_name: "a".repeat(120) }));
});

Deno.test("el correo opcional debe ser un correo", () => {
  assertEquals(ok({ ...CREATE, contact_email: "sin-arroba" }), false);
  assertEquals(ok({ ...CREATE, contact_email: "a@b" }), false);
});

Deno.test("isRealDate acepta solo días que existen", () => {
  assert(isRealDate("2026-12-05"));
  assert(isRealDate("2028-02-29")); // bisiesto
  for (const bad of [
    "2026-02-30",
    "2027-02-29",
    "2026-13-01",
    "2026-00-10",
    "2026-12-32",
    "26-12-05",
    "2026/12/05",
    "",
    "2026-12-05T10:00",
  ]) {
    assertEquals(isRealDate(bad), false, bad);
  }
  assertEquals(ok({ ...CREATE, delivery_date: "2026-02-31" }), false);
});

Deno.test("cancelar pide el pedido y un motivo opcional corto", () => {
  assert(ok({ action: "cancel", order_id: ORDER }));
  assert(ok({ action: "cancel", order_id: ORDER, reason: "Me equivoqué" }));
  assertEquals(ok({ action: "cancel" }), false);
  assertEquals(ok({ action: "cancel", order_id: "x" }), false);
  assertEquals(ok({ action: "cancel", order_id: ORDER, reason: "a".repeat(301) }), false);
});

Deno.test("planRpc de la vista previa usa la identidad del JWT y pone null a lo que falta", () => {
  const plan = planRpc(
    checkoutRequestSchema.parse({ action: "preview", shipping_method: "delivery" }),
    USER,
  );
  assertEquals(plan, {
    fn: "checkout_preview",
    args: {
      p_profile_id: USER,
      p_address_id: null,
      p_tax_profile_id: null,
      p_shipping_method: "delivery",
      p_slot_id: null,
      p_delivery_date: null,
      p_payment_method: null,
    },
  });
});

Deno.test("planRpc de crear mapea cada campo a su parámetro", () => {
  const plan = planRpc(checkoutRequestSchema.parse(CREATE), USER);
  assertEquals(plan.fn, "create_order");
  assertEquals(plan.args, {
    p_profile_id: USER,
    p_address_id: ADDRESS,
    p_tax_profile_id: TAX,
    p_shipping_method: "delivery",
    p_slot_id: SLOT,
    p_delivery_date: "2026-12-05",
    p_payment_method: "whatsapp",
    p_contact_name: "Ana Pérez",
    p_contact_email: "ana@example.com",
    p_contact_phone: "+59171234567",
    p_expected_total: 255,
    p_idempotency_key: "key-0123456789",
  });
});

Deno.test("planRpc de cancelar usa la clienta del JWT: nunca una que venga en el cuerpo", () => {
  const plan = planRpc(
    checkoutRequestSchema.parse({ action: "cancel", order_id: ORDER, reason: "x" }),
    USER,
  );
  assertEquals(plan, {
    fn: "cancel_order_by_customer",
    args: { p_profile_id: USER, p_order_id: ORDER, p_reason: "x" },
  });
  assertEquals(
    planRpc(checkoutRequestSchema.parse({ action: "cancel", order_id: ORDER }), USER).args.p_reason,
    null,
  );
});

Deno.test("los topes: crear es el más estricto y cada acción tiene el suyo", () => {
  assertEquals(userLimit("create"), { name: "create", ...LIMITS.createPerUser });
  assertEquals(userLimit("preview"), { name: "preview", ...LIMITS.previewPerUser });
  assertEquals(userLimit("cancel"), { name: "cancel", ...LIMITS.cancelPerUser });
  assert(LIMITS.createPerUser.max < LIMITS.previewPerUser.max);
  assert(LIMITS.createPerUser.max <= 10);
});

Deno.test("un cuerpo de más de 2 kB se corta con 413 sin leerlo entero", async () => {
  const big = JSON.stringify({ ...CREATE, contact_name: "x".repeat(MAX_BODY_BYTES) });
  const req = new Request("http://x", { method: "POST", body: big });
  const error = await assertRejects(
    () => parseBodyLimited(req, checkoutRequestSchema, MAX_BODY_BYTES),
    HttpError,
  );
  assertEquals((error as HttpError).status, 413);
});

Deno.test("una petición de creación típica cabe con holgura en el tope de cuerpo", () => {
  assert(new TextEncoder().encode(JSON.stringify(CREATE)).length < MAX_BODY_BYTES / 2);
});

Deno.test("un JSON roto y un cuerpo válido pero inválido para el esquema dan 400", async () => {
  const broken = new Request("http://x", { method: "POST", body: "{" });
  const e1 = await assertRejects(
    () => parseBodyLimited(broken, checkoutRequestSchema, MAX_BODY_BYTES),
    HttpError,
  );
  assertEquals((e1 as HttpError).status, 400);
  const invalid = new Request("http://x", {
    method: "POST",
    body: JSON.stringify({ action: "create" }),
  });
  const e2 = await assertRejects(
    () => parseBodyLimited(invalid, checkoutRequestSchema, MAX_BODY_BYTES),
    HttpError,
  );
  assertEquals((e2 as HttpError).status, 400);
});
