import { describe, expect, it } from "vitest";
import {
  DETAIL_MAX,
  EMPTY_FORM,
  firstInvalid,
  toRequestBody,
  validateComplaint,
  type ComplaintForm,
} from "./complaintForm";

const OK: ComplaintForm = {
  ...EMPTY_FORM,
  name: "Ana Pérez",
  email: "ana@example.com",
  kind: "product",
  detail: "La prenda llegó con una costura abierta y no es lo que pedí.",
};

describe("validateComplaint", () => {
  it("un reclamo completo no tiene errores", () => {
    expect(validateComplaint(OK)).toEqual({});
  });

  it("el formulario vacío pide nombre, un medio de contacto, el tipo y el detalle", () => {
    expect(validateComplaint(EMPTY_FORM)).toEqual({
      name: "nameRequired",
      contact: "contactRequired",
      kind: "kindRequired",
      detail: "detailShort",
    });
  });

  it("basta el correo o basta el teléfono (no hace falta llenar los dos)", () => {
    expect(validateComplaint({ ...OK, email: "", phone: "7123 4567" })).toEqual({});
    expect(validateComplaint({ ...OK, email: "", phone: "" })).toEqual({
      contact: "contactRequired",
    });
    expect(validateComplaint({ ...OK, email: "  ", phone: "  " })).toEqual({
      contact: "contactRequired",
    });
  });

  it("un correo o un teléfono mal escritos se señalan en SU campo", () => {
    expect(validateComplaint({ ...OK, email: "no-es-correo" })).toEqual({ email: "email" });
    expect(validateComplaint({ ...OK, email: "", phone: "abc" })).toEqual({ phone: "phone" });
    expect(validateComplaint({ ...OK, email: "", phone: "123" })).toEqual({ phone: "phone" });
    expect(validateComplaint({ ...OK, phone: "7123 4567" })).toEqual({});
  });

  it("el pedido es opcional, pero si se escribe debe tener forma de número de pedido (en cualquier mayúscula)", () => {
    expect(validateComplaint({ ...OK, order: "" })).toEqual({});
    expect(validateComplaint({ ...OK, order: " mic-000123 " })).toEqual({});
    expect(validateComplaint({ ...OK, order: "pedido uno" })).toEqual({ order: "order" });
    expect(validateComplaint({ ...OK, order: "MIC-12" })).toEqual({ order: "order" });
  });

  it("el detalle: 20 como mínimo (sin contar espacios de los extremos) y 2000 como máximo", () => {
    expect(validateComplaint({ ...OK, detail: "x".repeat(19) })).toEqual({ detail: "detailShort" });
    expect(validateComplaint({ ...OK, detail: `   ${"x".repeat(19)}   ` })).toEqual({
      detail: "detailShort",
    });
    expect(validateComplaint({ ...OK, detail: "x".repeat(20) })).toEqual({});
    expect(validateComplaint({ ...OK, detail: "x".repeat(DETAIL_MAX) })).toEqual({});
    expect(validateComplaint({ ...OK, detail: "x".repeat(DETAIL_MAX + 1) })).toEqual({
      detail: "detailLong",
    });
  });

  it("el nombre en blanco no vale", () => {
    expect(validateComplaint({ ...OK, name: "   " })).toEqual({ name: "nameRequired" });
  });
});

describe("firstInvalid", () => {
  it("lleva el foco al primer campo con error, en el orden del formulario", () => {
    expect(firstInvalid({ detail: "detailShort", name: "nameRequired" })).toBe("name");
    expect(firstInvalid({ detail: "detailShort", kind: "kindRequired" })).toBe("kind");
    expect(firstInvalid({ contact: "contactRequired", email: "email" })).toBe("contact");
    expect(firstInvalid({})).toBeNull();
  });
});

describe("toRequestBody", () => {
  it("manda solo lo que tiene valor, recortado, y NUNCA el campo trampa si está vacío", () => {
    expect(
      toRequestBody({
        ...OK,
        name: "  Ana Pérez ",
        email: " ana@example.com ",
        phone: "",
        order: "",
      }),
    ).toEqual({
      contact_name: "Ana Pérez",
      contact_email: "ana@example.com",
      kind: "product",
      detail: OK.detail,
    });
  });

  it("incluye teléfono y pedido cuando se escribieron, y el campo trampa solo si algo lo llenó", () => {
    const body = toRequestBody({
      ...OK,
      email: "",
      phone: "7123 4567",
      order: "mic-000123",
      website: "http://spam",
    });
    expect(body).toMatchObject({
      contact_phone: "7123 4567",
      order_number: "mic-000123",
      website: "http://spam",
    });
    expect(body).not.toHaveProperty("contact_email");
  });
});
