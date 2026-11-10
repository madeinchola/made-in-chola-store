import { describe, expect, it } from "vitest";
import { discountStatus, sortDiscounts, STATUS_ORDER } from "./status";
import type { Discount, DiscountStatus } from "./types";

const NOW = new Date("2026-12-01T10:00:00.000Z");
type Fields = Pick<Discount, "archived" | "isActive" | "startsAt" | "endsAt" | "usageLimitTotal">;
const base: Fields = {
  archived: false,
  isActive: true,
  startsAt: null,
  endsAt: null,
  usageLimitTotal: null,
};
const status = (over: Partial<Fields>, used: number | null = null, now = NOW) =>
  discountStatus({ ...base, ...over }, used === null ? undefined : { used }, now);

describe("discountStatus: un caso por estado", () => {
  it("sin fechas ni tope: activo", () => {
    expect(status({})).toBe("active");
  });
  it("archivado", () => {
    expect(status({ archived: true })).toBe("archived");
  });
  it("apagado a mano: inactivo", () => {
    expect(status({ isActive: false })).toBe("inactive");
  });
  it("todavía no empieza: programado", () => {
    expect(status({ startsAt: "2026-12-01T10:00:01.000Z" })).toBe("scheduled");
  });
  it("ya terminó: vencido", () => {
    expect(status({ endsAt: "2026-12-01T09:59:59.000Z" })).toBe("expired");
  });
  it("llegó al tope de usos: agotado", () => {
    expect(status({ usageLimitTotal: 100 }, 100)).toBe("exhausted");
  });
});

describe("discountStatus: bordes del tiempo (inicio inclusivo, fin EXCLUSIVO)", () => {
  it("justo en el instante de inicio ya está activo (starts_at <= ahora)", () => {
    expect(status({ startsAt: "2026-12-01T10:00:00.000Z" })).toBe("active");
  });
  it("un milisegundo antes del inicio sigue programado", () => {
    expect(status({ startsAt: "2026-12-01T10:00:00.001Z" })).toBe("scheduled");
  });
  it("justo en el instante de fin ya venció (ahora < ends_at)", () => {
    expect(status({ endsAt: "2026-12-01T10:00:00.000Z" })).toBe("expired");
  });
  it("un milisegundo antes del fin sigue activo", () => {
    expect(status({ endsAt: "2026-12-01T10:00:00.001Z" })).toBe("active");
  });
  it("dentro de la ventana: activo", () => {
    expect(
      status({ startsAt: "2026-12-01T06:00:00.000Z", endsAt: "2026-12-01T12:00:00.000Z" }),
    ).toBe("active");
  });
  it("la hora se compara como instante, sin importar el huso con el que venga escrita", () => {
    // 06:00 en La Paz (UTC−4) = 10:00 UTC: justo ahora
    expect(status({ startsAt: "2026-12-01T06:00:00-04:00" })).toBe("active");
    expect(status({ startsAt: "2026-12-01T06:00:01-04:00" })).toBe("scheduled");
  });
});

describe("discountStatus: bordes del tope de usos", () => {
  it("un uso menos que el tope: activo", () => {
    expect(status({ usageLimitTotal: 100 }, 99)).toBe("active");
  });
  it("exactamente el tope: agotado", () => {
    expect(status({ usageLimitTotal: 100 }, 100)).toBe("exhausted");
  });
  it("más usos que el tope (por una carrera): agotado", () => {
    expect(status({ usageLimitTotal: 100 }, 101)).toBe("exhausted");
  });
  it("tope de 1 uso: con 0 usos activo, con 1 agotado", () => {
    expect(status({ usageLimitTotal: 1 }, 0)).toBe("active");
    expect(status({ usageLimitTotal: 1 }, 1)).toBe("exhausted");
  });
  it("sin fila de usos (nadie lo usó o no se pudo leer) cuenta como 0", () => {
    expect(status({ usageLimitTotal: 5 })).toBe("active");
    expect(discountStatus({ ...base, usageLimitTotal: 5 }, null, NOW)).toBe("active");
  });
  it("sin tope, ningún número de usos lo agota", () => {
    expect(status({ usageLimitTotal: null }, 1_000_000)).toBe("active");
  });
});

describe("discountStatus: precedencia (archivado > inactivo > agotado > programado > vencido)", () => {
  const future = "2027-01-01T00:00:00.000Z";
  const past = "2026-01-01T00:00:00.000Z";
  it("archivado gana a todo", () => {
    expect(
      status({ archived: true, isActive: false, usageLimitTotal: 1, startsAt: future }, 5),
    ).toBe("archived");
  });
  it("inactivo gana a agotado, programado y vencido", () => {
    expect(status({ isActive: false, usageLimitTotal: 1, startsAt: future }, 5)).toBe("inactive");
    expect(status({ isActive: false, endsAt: past })).toBe("inactive");
  });
  it("agotado gana a programado y a vencido", () => {
    expect(status({ usageLimitTotal: 1, startsAt: future }, 1)).toBe("exhausted");
    expect(status({ usageLimitTotal: 1, endsAt: past }, 1)).toBe("exhausted");
  });
  it("programado y vencido no se pisan: cada uno con su fecha", () => {
    expect(status({ startsAt: future, endsAt: "2027-02-01T00:00:00.000Z" })).toBe("scheduled");
    expect(status({ startsAt: past, endsAt: "2026-06-01T00:00:00.000Z" })).toBe("expired");
  });
});

describe("sortDiscounts", () => {
  type Row = { id: string; priority: number; status: DiscountStatus };
  const row = (id: string, status: DiscountStatus, priority = 100): Row => ({
    id,
    status,
    priority,
  });
  const order = (rows: Row[]) => sortDiscounts(rows, (r) => r.status).map((r) => r.id);

  it("la lista de estados cubre los seis, con los activos primero y los archivados al final", () => {
    expect([...STATUS_ORDER].sort()).toEqual(
      ["active", "archived", "exhausted", "expired", "inactive", "scheduled"].sort(),
    );
    expect(STATUS_ORDER[0]).toBe("active");
    expect(STATUS_ORDER[STATUS_ORDER.length - 1]).toBe("archived");
  });

  it("activos, programados, agotados, inactivos, vencidos y al final los archivados", () => {
    expect(
      order([
        row("archivado", "archived", 99999),
        row("vencido", "expired"),
        row("inactivo", "inactive"),
        row("agotado", "exhausted"),
        row("programado", "scheduled"),
        row("activo", "active"),
      ]),
    ).toEqual(["activo", "programado", "agotado", "inactivo", "vencido", "archivado"]);
  });

  it("a igual estado, mayor prioridad primero (aunque llegue después)", () => {
    expect(
      order([row("a", "active", 10), row("b", "active", 300), row("c", "active", 100)]),
    ).toEqual(["b", "c", "a"]);
  });

  it("a igual estado y prioridad conserva el orden recibido (el más nuevo primero)", () => {
    expect(order([row("nuevo", "active"), row("medio", "active"), row("viejo", "active")])).toEqual(
      ["nuevo", "medio", "viejo"],
    );
  });

  it("no modifica el arreglo recibido", () => {
    const input = [row("b", "archived"), row("a", "active")];
    sortDiscounts(input, (r) => r.status);
    expect(input.map((r) => r.id)).toEqual(["b", "a"]);
  });
});
