import { assert, assertEquals } from "jsr:@std/assert@1";
import type { OutboxRow, RowContext, SiteContext } from "./types.ts";
import { buildVariables, sampleVariables, VARIABLE_CATALOG } from "./variables.ts";

const SITE: SiteContext = {
  siteUrl: "https://tienda.test",
  storeName: "Made In Chola",
};
const CTX: RowContext = {
  customerName: null,
  currency: null,
  paymentExpiresAt: null,
};

const alert = (kind: unknown): OutboxRow => ({
  id: 7,
  type: "complaint_new",
  channel: "email",
  recipient: null,
  payload: { complaint_number: "REC-000123", kind },
  attempts: 1,
  template: null,
  order_id: null,
  profile_id: null,
  dedupe_key: "complaint_new:x",
});

Deno.test(
  "la alerta de un reclamo trae su número, el tipo en palabras y el enlace a la bandeja de Reclamos",
  () => {
    const vars = buildVariables(alert("delivery"), SITE, CTX);
    assertEquals(vars.complaint_number, "REC-000123");
    assertEquals(vars.complaint_kind, "entrega");
    assertEquals(vars.admin_url, "https://tienda.test/admin/reclamos");
  },
);

Deno.test(
  "cada tipo de reclamo tiene su palabra y uno desconocido pasa tal cual (nunca queda vacío ni rompe)",
  () => {
    const words = Object.fromEntries(
      ["product", "delivery", "payment", "service", "other"].map((k) => [
        k,
        buildVariables(alert(k), SITE, CTX).complaint_kind,
      ]),
    );
    assertEquals(words, {
      product: "producto",
      delivery: "entrega",
      payment: "cobro o pago",
      service: "atención",
      other: "otro",
    });
    assertEquals(buildVariables(alert("raro"), SITE, CTX).complaint_kind, "raro");
    assertEquals(buildVariables(alert(undefined), SITE, CTX).complaint_kind, "");
  },
);

Deno.test(
  "las variables del reclamo existen en el catálogo del panel y en los ejemplos de la vista previa, solo para administradores",
  () => {
    for (const name of ["complaint_number", "complaint_kind"]) {
      const info = VARIABLE_CATALOG.find((v) => v.name === name);
      assert(info, name);
      assertEquals(info.audience, "admin");
      assert(name in sampleVariables("admin", SITE), `ejemplo de ${name}`);
      assertEquals(name in sampleVariables("customer", SITE), false);
    }
  },
);

Deno.test(
  "la alerta NO lleva datos de quien reclama (el correo, el teléfono y el detalle se ven solo en el panel)",
  () => {
    const vars = buildVariables(alert("product"), SITE, CTX);
    assertEquals(
      Object.keys(vars).filter(
        (k) => /email|phone|detail|name$/.test(k) && vars[k] !== "" && k !== "store_name",
      ),
      [],
    );
  },
);
