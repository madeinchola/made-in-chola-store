import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { complaintErrorKey, isDirty, mailtoLink, telLink, whatsappLink } from "./logic";
import type { ComplaintRow } from "./types";

const ROW: ComplaintRow = {
  id: "1",
  number: "REC-000123",
  createdAt: "2026-11-17T12:00:00Z",
  kind: "product",
  status: "new",
  contactName: "Ana",
  contactEmail: "ana@example.com",
  contactPhone: "+59171234567",
  orderNumber: null,
  detail: "x".repeat(30),
  response: null,
  dueAt: "2026-11-27T12:00:00Z",
  answeredAt: null,
  overdue: false,
  hasAccount: false,
};

describe("enlaces de contacto", () => {
  it("WhatsApp usa solo los dígitos del teléfono (wa.me no admite «+») y nada si no hay teléfono o es absurdo", () => {
    expect(whatsappLink("+59171234567")).toBe("https://wa.me/59171234567");
    expect(whatsappLink(null)).toBeNull();
    expect(whatsappLink("")).toBeNull();
    expect(whatsappLink("123")).toBeNull();
    expect(whatsappLink("+1234567890123456789")).toBeNull();
  });

  it("el teléfono se llama solo si es E.164 válido", () => {
    expect(telLink("+59171234567")).toBe("tel:+59171234567");
    expect(telLink("71234567")).toBeNull();
    expect(telLink("+59171234567; rm")).toBeNull();
    expect(telLink(null)).toBeNull();
  });

  it("el correo lleva el número del reclamo en el asunto y se codifica (nada de lo escrito rompe el enlace)", () => {
    expect(mailtoLink("ana@example.com", "REC-000123")).toBe(
      "mailto:ana@example.com?subject=Tu%20reclamo%20REC-000123",
    );
    expect(mailtoLink("a+b@example.com", "REC-000123")).toContain("mailto:a%2Bb@example.com");
    expect(mailtoLink("ana@example.com?cc=otro@x.com", "REC-000123")).toBeNull();
    expect(mailtoLink("no es correo", "REC-000123")).toBeNull();
    expect(mailtoLink(null, "REC-000123")).toBeNull();
  });
});

describe("complaintErrorKey", () => {
  it("traduce los códigos de la base y esconde cualquier otro mensaje", () => {
    expect(complaintErrorKey(new AppError("validation", "response_required"))).toBe(
      "admin.complaints.errors.response_required",
    );
    expect(complaintErrorKey(new AppError("conflict", "not_found"))).toBe(
      "admin.complaints.errors.not_found",
    );
    expect(complaintErrorKey(new AppError("unknown", "select * from complaints"))).toBe(
      "admin.complaints.errors.unknown",
    );
    expect(complaintErrorKey("raro")).toBe("admin.complaints.errors.unknown");
  });
});

describe("isDirty", () => {
  it("hay algo que guardar si cambió el estado o la respuesta (sin contar espacios de los extremos)", () => {
    expect(isDirty(ROW, "new", "")).toBe(false);
    expect(isDirty(ROW, "in_review", "")).toBe(true);
    expect(isDirty(ROW, "new", "Ya lo vimos")).toBe(true);
    expect(isDirty({ ...ROW, response: "Hecho" }, "new", "  Hecho  ")).toBe(false);
  });
});
