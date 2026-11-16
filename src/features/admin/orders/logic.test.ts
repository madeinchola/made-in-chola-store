import { describe, expect, it } from "vitest";
import {
  advanceLabelKey,
  canCancel,
  canEdit,
  canRefund,
  canReturn,
  canUndo,
  csvCell,
  dayEndExclusiveIso,
  dayStartIso,
  errorText,
  newKey,
  nextStatus,
  normalizePhone,
  ordersToCsv,
  parseOptionalMoney,
  searchFilter,
  statusLabel,
  statusTone,
  validateText,
} from "./logic";
import { resultCode, succeeded } from "./outcomes";
import { ORDER_STATUSES, type OrderRow } from "./types";

const row = (over: Partial<OrderRow> = {}): OrderRow => ({
  id: "o1",
  number: "MIC-000123",
  status: "paid",
  channel: "web",
  contactName: "Ana Pérez",
  contactPhone: "+59171234567",
  total: 255,
  currency: "BOB",
  paymentMethod: "whatsapp",
  paymentProvider: "whatsapp",
  createdAt: "2026-11-14T15:00:00.000Z",
  updatedAt: "2026-11-14T15:00:00.000Z",
  ...over,
});

describe("estados", () => {
  it("todo estado tiene su texto y su tono (ninguno sale como clave cruda)", () => {
    for (const s of ORDER_STATUSES) {
      expect(statusLabel(s)).not.toMatch(/^admin\./);
      expect(["success", "info", "warning", "danger", "neutral"]).toContain(statusTone(s));
    }
  });
  it("el flujo normal avanza de a un paso y termina en «completado»", () => {
    expect(ORDER_STATUSES.map((s) => nextStatus(s))).toEqual([
      "paid",
      "preparing",
      "shipped",
      "delivered",
      "completed",
      null,
      null,
      null,
    ]);
  });
  it("el botón de avanzar existe solo donde hay un paso siguiente", () => {
    expect(ORDER_STATUSES.filter((s) => advanceLabelKey(s) !== null)).toEqual([
      "pending_payment",
      "paid",
      "preparing",
      "shipped",
      "delivered",
    ]);
  });
  it("qué acciones se ofrecen en cada estado (espejo de la matriz del servidor)", () => {
    const by = (f: (s: (typeof ORDER_STATUSES)[number]) => boolean) => ORDER_STATUSES.filter(f);
    expect(by(canCancel)).toEqual(["pending_payment", "paid", "preparing", "shipped"]);
    expect(by(canEdit)).toEqual(["pending_payment", "paid", "preparing"]);
    expect(by(canReturn)).toEqual(["delivered", "completed"]);
    expect(by(canRefund)).toEqual([
      "paid",
      "preparing",
      "shipped",
      "delivered",
      "completed",
      "cancelled",
    ]);
    expect(by(canUndo)).toEqual(["preparing", "shipped", "delivered", "completed"]);
  });
});

describe("búsqueda", () => {
  it("busca por número, nombre y teléfono", () => {
    expect(searchFilter("MIC-000123")).toBe(
      "number.ilike.%MIC-000123%,contact_name.ilike.%MIC-000123%,contact_phone.ilike.%MIC-000123%",
    );
  });
  it("vacío o solo espacios no filtra", () => {
    expect(searchFilter("")).toBeNull();
    expect(searchFilter("   ")).toBeNull();
  });
  it("lo que PostgREST lee como sintaxis no puede abrir otro filtro (inyección)", () => {
    const out = searchFilter("x),status.eq.paid,(y");
    expect(out).toBe(
      "number.ilike.%x status.eq.paid y%,contact_name.ilike.%x status.eq.paid y%,contact_phone.ilike.%x status.eq.paid y%",
    );
    // Exactamente 3 condiciones, ninguna sintaxis suelta.
    expect(out?.split(",")).toHaveLength(3);
    expect(out).not.toMatch(/[()"*\\]/);
  });
  it("recorta a 60 caracteres", () => {
    expect(searchFilter("a".repeat(100))).toContain(`%${"a".repeat(60)}%`);
    expect(searchFilter("a".repeat(100))).not.toContain("a".repeat(61));
  });
});

describe("fechas (Bolivia es UTC−4 todo el año)", () => {
  it("inicio del día en La Paz", () => {
    expect(dayStartIso("2026-11-14")).toBe("2026-11-14T00:00:00-04:00");
  });
  it("el fin es EXCLUSIVO: el día siguiente a las 00:00 de La Paz (04:00 UTC)", () => {
    expect(dayEndExclusiveIso("2026-11-14")).toBe("2026-11-15T04:00:00.000Z");
    expect(dayEndExclusiveIso("2026-12-31")).toBe("2027-01-01T04:00:00.000Z");
  });
  it("fechas inválidas no filtran", () => {
    for (const bad of ["", "14/11/2026", "2026-13-45", "abc"]) {
      expect(dayStartIso(bad)).toBeNull();
      expect(dayEndExclusiveIso(bad)).toBeNull();
    }
  });
});

describe("CSV", () => {
  it("escapa comillas, separadores y saltos de línea", () => {
    expect(csvCell('dijo "hola"')).toBe('"dijo ""hola"""');
    expect(csvCell("a;b")).toBe('"a;b"');
    expect(csvCell("a\nb")).toBe('"a\nb"');
    expect(csvCell("simple")).toBe("simple");
    expect(csvCell(12.5)).toBe("12.5");
    expect(csvCell(null)).toBe("");
  });
  it("neutraliza las fórmulas de Excel (= + - @)", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+59171234567")).toBe("'+59171234567");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
  });
  it("arma el archivo con BOM, separador «;» y una fila por pedido", () => {
    const csv = ordersToCsv([
      row(),
      row({ number: "MIC-000124", contactName: "=Evil", total: 80.5, status: "cancelled" }),
    ]);
    const lines = csv.split("\r\n");
    expect(csv.startsWith("﻿")).toBe(true);
    expect(lines).toHaveLength(4); // encabezado + 2 filas + línea final vacía
    expect(lines[0]).toBe(
      "﻿Número;Fecha;Estado;Cliente;Teléfono;Método de pago;Canal;Total;Moneda",
    );
    expect(lines[1]).toBe(
      "MIC-000123;2026-11-14T15:00:00.000Z;Pagado;Ana Pérez;'+59171234567;whatsapp;Tienda;255.00;BOB",
    );
    expect(lines[2]).toBe(
      "MIC-000124;2026-11-14T15:00:00.000Z;Cancelado;'=Evil;'+59171234567;whatsapp;Tienda;80.50;BOB",
    );
  });
});

describe("formularios", () => {
  it("texto obligatorio con tope", () => {
    expect(validateText("  hola   mundo ", 20)).toEqual({ ok: true, value: "hola mundo" });
    expect(validateText("   ", 20)).toEqual({ ok: false, problem: "required" });
    expect(validateText("x".repeat(21), 20)).toEqual({ ok: false, problem: "too_long" });
    expect(validateText("x".repeat(20), 20).ok).toBe(true);
  });
  it("importes opcionales estrictos como la base (2 decimales, sin redondear en silencio)", () => {
    expect(parseOptionalMoney("")).toEqual({ ok: true, value: null });
    expect(parseOptionalMoney("25")).toEqual({ ok: true, value: 25 });
    expect(parseOptionalMoney("25,50")).toEqual({ ok: true, value: 25.5 });
    expect(parseOptionalMoney("0")).toEqual({ ok: false, problem: "not_positive" });
    expect(parseOptionalMoney("0", true)).toEqual({ ok: true, value: 0 });
    expect(parseOptionalMoney("1,005")).toEqual({ ok: false, problem: "decimals" });
    expect(parseOptionalMoney("abc")).toEqual({ ok: false, problem: "format" });
    expect(parseOptionalMoney("-3")).toEqual({ ok: false, problem: "format" });
    expect(parseOptionalMoney("9999999999")).toEqual({ ok: false, problem: "too_large" });
  });
  it("teléfonos a E.164 (con o sin +, espacios y guiones)", () => {
    expect(normalizePhone("71234567")).toBe("+59171234567");
    expect(normalizePhone("612-34567")).toBe("+59161234567");
    expect(normalizePhone("+591 7123 4567")).toBe("+59171234567");
    expect(normalizePhone("+5491155551234")).toBe("+5491155551234");
    expect(normalizePhone("5491155551234")).toBe("+5491155551234");
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("+0123456789")).toBeNull();
  });
  it("la llave de idempotencia es única por intento y cumple el formato de la base", () => {
    const a = newKey("rf");
    const b = newKey("rf");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^rf-[0-9a-f]{24}$/);
    // la base pide 8 a 200 caracteres de [A-Za-z0-9_:.-]
    expect(a).toMatch(/^[A-Za-z0-9_:.-]{8,200}$/);
  });
});

describe("errores de la base → texto", () => {
  it("un código conocido tiene su texto", () => {
    expect(errorText("stale")).toMatch(/otro administrador/i);
    expect(errorText("exceeds_paid")).toMatch(/más de lo pagado/);
  });
  it("un código desconocido o ausente cae en el mensaje general (nunca el código crudo)", () => {
    for (const code of ["codigo_que_no_existe", undefined, ""]) {
      expect(errorText(code)).toBe(errorText("unknown"));
      expect(errorText(code)).not.toMatch(/codigo_que_no_existe/);
    }
  });
});

describe("respuestas de las funciones de administración", () => {
  it("el código sale del outcome o, si no hay, del primer error", () => {
    expect(resultCode({ outcome: "stale" })).toBe("stale");
    expect(resultCode({ errors: [{ code: "reason_required" }] })).toBe("reason_required");
    // un rechazo explica su motivo concreto (si no, todas las pantallas dirían «no pudimos completar la acción»)
    expect(resultCode({ outcome: "rejected", errors: [{ code: "exceeds_paid" }] })).toBe(
      "exceeds_paid",
    );
    expect(resultCode({ outcome: "rejected" })).toBe("rejected");
    expect(resultCode({ outcome: "stale", errors: [{ code: "otro" }] })).toBe("stale");
    expect(resultCode({})).toBe("unknown");
    expect(resultCode(null)).toBe("unknown");
  });
  it("éxito: ok=true o un outcome de la lista de esa acción", () => {
    expect(succeeded({ ok: true }, [])).toBe(true);
    expect(succeeded({ outcome: "edited" }, ["edited"])).toBe(true);
    expect(succeeded({ outcome: "stale" }, ["edited"])).toBe(false);
    expect(succeeded({ ok: false, outcome: "invalid_transition" }, ["transitioned"])).toBe(false);
    expect(succeeded(null, ["edited"])).toBe(false);
  });
});
