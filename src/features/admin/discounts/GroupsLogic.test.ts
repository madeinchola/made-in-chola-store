import { describe, expect, it } from "vitest";
import {
  archiveImpactText,
  discountsUsingGroup,
  groupFieldErrors,
  groupFormFrom,
  memberCountText,
  memberName,
  sortGroups,
  summarizeNames,
  validateGroupForm,
} from "./GroupsLogic";
import type { CustomerGroup, Discount } from "./types";

const group = (over: Partial<CustomerGroup> = {}): CustomerGroup => ({
  id: "g1",
  name: "Mayoristas",
  description: null,
  archived: false,
  updatedAt: "2026-11-05T10:00:00+00:00",
  ...over,
});

const discount = (over: Partial<Discount> = {}): Discount => ({
  id: "d1",
  name: "Mayoristas 20",
  kind: "group_price",
  params: { kind: "group_price", percent: 20, maxAmount: null },
  scope: "order",
  currency: "BOB",
  minOrderAmount: null,
  customerGroupId: "g1",
  requiresCoupon: false,
  stackableWithAutomatic: false,
  excludeSaleItems: false,
  usageLimitTotal: null,
  usageLimitPerCustomer: null,
  priority: 100,
  startsAt: null,
  endsAt: null,
  isActive: true,
  archived: false,
  updatedAt: "2026-11-05T10:00:00+00:00",
  ...over,
});

const validate = (
  name: string,
  description = "",
  existing: CustomerGroup[] = [],
  editingId = null as string | null,
) => validateGroupForm({ name, description }, { existing, editingId });

describe("sortGroups", () => {
  it("los archivados al final; el resto conserva su orden", () => {
    const list = [
      group({ id: "a", archived: true }),
      group({ id: "b" }),
      group({ id: "c", archived: true }),
      group({ id: "d" }),
    ];
    expect(sortGroups(list).map((g) => g.id)).toEqual(["b", "d", "a", "c"]);
  });
});

describe("validateGroupForm", () => {
  it("recorta el nombre y la descripción; descripción vacía → null", () => {
    expect(validate("  Mayoristas  ", "  Compran por docena  ")).toEqual({
      ok: true,
      value: { name: "Mayoristas", description: "Compran por docena" },
    });
    expect(validate("Mayoristas", "   ")).toEqual({
      ok: true,
      value: { name: "Mayoristas", description: null },
    });
  });
  it("el nombre es obligatorio", () => {
    expect(validate("")).toEqual({ ok: false, errors: { name: "required" } });
    expect(validate("   ")).toEqual({ ok: false, errors: { name: "required" } });
  });
  it("80 caracteres sí, 81 no; se cuentan caracteres, no unidades UTF-16", () => {
    expect(validate("a".repeat(80)).ok).toBe(true);
    expect(validate("a".repeat(81))).toEqual({ ok: false, errors: { name: "tooLong" } });
    expect(validate("😀".repeat(80)).ok).toBe(true);
    expect(validate("😀".repeat(81)).ok).toBe(false);
  });
  it("la descripción admite 300 caracteres, no 301", () => {
    expect(validate("Ok", "d".repeat(300)).ok).toBe(true);
    expect(validate("Ok", "d".repeat(301))).toEqual({
      ok: false,
      errors: { description: "tooLong" },
    });
  });
  it("un nombre repetido (sin importar mayúsculas ni espacios de los extremos) avisa", () => {
    const existing = [group({ name: "Mayoristas" })];
    expect(validate("mayoristas", "", existing)).toEqual({
      ok: false,
      errors: { name: "duplicate" },
    });
    expect(validate("  MAYORISTAS ", "", existing).ok).toBe(false);
    expect(validate("Mayoristas 2", "", existing).ok).toBe(true);
  });
  it("un grupo ARCHIVADO no reserva su nombre (el índice único solo mira los vigentes)", () => {
    expect(validate("Mayoristas", "", [group({ archived: true })]).ok).toBe(true);
  });
  it("al editar, el propio grupo no cuenta como duplicado, pero otro sí", () => {
    const existing = [group({ id: "g1", name: "Mayoristas" }), group({ id: "g2", name: "VIP" })];
    expect(validate("Mayoristas", "nueva descripción", existing, "g1").ok).toBe(true);
    expect(validate("vip", "", existing, "g1")).toEqual({
      ok: false,
      errors: { name: "duplicate" },
    });
  });
  it("junta los problemas de nombre y descripción", () => {
    expect(validate("", "d".repeat(301))).toEqual({
      ok: false,
      errors: { name: "required", description: "tooLong" },
    });
  });
  it("groupFormFrom: vacío para un grupo nuevo, con los datos para uno existente", () => {
    expect(groupFormFrom(null)).toEqual({ name: "", description: "" });
    expect(groupFormFrom(group({ description: "Compran por docena" }))).toEqual({
      name: "Mayoristas",
      description: "Compran por docena",
    });
  });
  it("groupFieldErrors traduce cada problema", () => {
    expect(groupFieldErrors({ name: "required" }).name).toBe("Escribe un nombre para el grupo.");
    expect(groupFieldErrors({ name: "tooLong" }).name).toBe(
      "El nombre admite hasta 80 caracteres.",
    );
    expect(groupFieldErrors({ name: "duplicate" }).name).toBe("Ya hay un grupo con ese nombre.");
    expect(groupFieldErrors({ description: "tooLong" }).description).toBe(
      "La descripción admite hasta 300 caracteres.",
    );
    expect(groupFieldErrors({})).toEqual({});
  });
});

describe("descuentos que dependen de un grupo", () => {
  const list = [
    discount({ id: "1", name: "Mayoristas 20" }),
    discount({ id: "2", name: "Archivado", archived: true }),
    discount({ id: "3", name: "Otro grupo", customerGroupId: "g2" }),
    discount({ id: "4", name: "Sin grupo", customerGroupId: null }),
    discount({ id: "5", name: "Mayoristas 30" }),
  ];
  it("solo los vigentes de ese grupo", () => {
    expect(discountsUsingGroup("g1", list).map((d) => d.id)).toEqual(["1", "5"]);
    expect(discountsUsingGroup("zz", list)).toEqual([]);
  });
  it("summarizeNames: hasta 3 completos; más, «y N más»", () => {
    expect(summarizeNames(["A"])).toBe("A");
    expect(summarizeNames(["A", "B", "C"])).toBe("A, B, C");
    expect(summarizeNames(["A", "B", "C", "D", "E"])).toBe("A, B, C y 2 más");
  });
  it("archiveImpactText: vacío sin descuentos, singular y plural", () => {
    expect(archiveImpactText("zz", list)).toBe("");
    expect(archiveImpactText("g2", list)).toBe(
      "1 descuento usa este grupo y dejará de aplicarse a sus miembros: Otro grupo.",
    );
    expect(archiveImpactText("g1", list)).toBe(
      "2 descuentos usan este grupo y dejarán de aplicarse a sus miembros: Mayoristas 20, Mayoristas 30.",
    );
  });
});

describe("textos de miembros", () => {
  it("memberCountText", () => {
    expect(memberCountText(0)).toBe("Sin miembros");
    expect(memberCountText(1)).toBe("1 miembro");
    expect(memberCountText(2)).toBe("2 miembros");
    expect(memberCountText(120)).toBe("120 miembros");
  });
  it("memberName", () => {
    expect(memberName("Ana")).toBe("Ana");
    expect(memberName(null)).toBe("Sin nombre");
    expect(memberName("  ")).toBe("Sin nombre");
  });
});
