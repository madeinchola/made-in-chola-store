import { describe, expect, it } from "vitest";
import {
  isEmptyPlan,
  planVariants,
  type PlanColor,
  type PlanSize,
  type PlanVariant,
} from "./variantPlan";

const color = (id: string, archived = false): PlanColor => ({ id, archived });
const size = (id: string, archived = false): PlanSize => ({ id, archived });
let n = 0;
const variant = (
  colorId: string,
  sizeId: string | null,
  o: Partial<PlanVariant> = {},
): PlanVariant => ({
  id: o.id ?? `v${++n}`,
  colorId,
  sizeId,
  archived: false,
  stockOnHand: 0,
  ...o,
});

describe("planVariants", () => {
  it("producto nuevo: 2 colores × 3 tallas = 6 variantes a crear, en orden color → talla", () => {
    const plan = planVariants([color("R"), color("A")], [size("S"), size("M"), size("L")], []);
    expect(plan.create).toEqual([
      { colorId: "R", sizeId: "S" },
      { colorId: "R", sizeId: "M" },
      { colorId: "R", sizeId: "L" },
      { colorId: "A", sizeId: "S" },
      { colorId: "A", sizeId: "M" },
      { colorId: "A", sizeId: "L" },
    ]);
    expect(plan.restore).toEqual([]);
    expect(plan.archive).toEqual([]);
    expect(plan.blocked).toEqual([]);
  });

  it("sin tallas: una variante por color, con talla null", () => {
    const plan = planVariants([color("R"), color("A"), color("V")], [], []);
    expect(plan.create).toEqual([
      { colorId: "R", sizeId: null },
      { colorId: "A", sizeId: null },
      { colorId: "V", sizeId: null },
    ]);
  });

  it("agregar una talla a una matriz 2×2 completa crea SOLO las 2 combinaciones nuevas y no toca el stock", () => {
    const existing = [
      variant("R", "S", { stockOnHand: 7 }),
      variant("R", "M", { stockOnHand: 3 }),
      variant("A", "S", { stockOnHand: 9 }),
      variant("A", "M", { stockOnHand: 1 }),
    ];
    const plan = planVariants(
      [color("R"), color("A")],
      [size("S"), size("M"), size("L")],
      existing,
    );
    expect(plan.create).toEqual([
      { colorId: "R", sizeId: "L" },
      { colorId: "A", sizeId: "L" },
    ]);
    expect(plan.archive).toEqual([]);
    expect(plan.blocked).toEqual([]);
  });

  it("agregar un color a una matriz completa crea una variante por cada talla activa", () => {
    const existing = [variant("R", "S"), variant("R", "M")];
    const plan = planVariants([color("R"), color("A")], [size("S"), size("M")], existing);
    expect(plan.create).toEqual([
      { colorId: "A", sizeId: "S" },
      { colorId: "A", sizeId: "M" },
    ]);
  });

  it("una combinación con variante archivada se RESTAURA, no se crea otra", () => {
    const old = variant("R", "S", { id: "viejo", archived: true, stockOnHand: 4 });
    const plan = planVariants([color("R")], [size("S")], [old]);
    expect(plan.restore).toEqual(["viejo"]);
    expect(plan.create).toEqual([]);
  });

  it("con varias archivadas de la misma combinación restaura exactamente una (la de id menor)", () => {
    const plan = planVariants(
      [color("R")],
      [size("S")],
      [
        variant("R", "S", { id: "b", archived: true }),
        variant("R", "S", { id: "a", archived: true }),
      ],
    );
    expect(plan.restore).toEqual(["a"]);
  });

  it("si hay una activa Y una archivada de la misma combinación, no se hace nada", () => {
    const plan = planVariants(
      [color("R")],
      [size("S")],
      [variant("R", "S"), variant("R", "S", { archived: true })],
    );
    expect(isEmptyPlan(plan)).toBe(true);
  });

  it("un color archivado no genera combinaciones, y su variante activa sin stock se archiva", () => {
    const plan = planVariants(
      [color("R"), color("V", true)],
      [size("S")],
      [variant("R", "S"), variant("V", "S", { id: "huérfana" })],
    );
    expect(plan.create).toEqual([]);
    expect(plan.archive).toEqual(["huérfana"]);
  });

  it("una variante huérfana CON stock queda bloqueada: nunca se archiva perdiendo stock", () => {
    const plan = planVariants(
      [color("R"), color("V", true)],
      [size("S")],
      [variant("R", "S"), variant("V", "S", { id: "conStock", stockOnHand: 5 })],
    );
    expect(plan.archive).toEqual([]);
    expect(plan.blocked).toEqual([{ variantId: "conStock", stockOnHand: 5 }]);
  });

  it("agregar tallas a un producto que tenía variantes sin talla: crea las nuevas, archiva la sin stock y bloquea la que tiene stock", () => {
    const plan = planVariants(
      [color("R"), color("A")],
      [size("S")],
      [
        variant("R", null, { id: "sinTallaVacia", stockOnHand: 0 }),
        variant("A", null, { id: "sinTallaConStock", stockOnHand: 6 }),
      ],
    );
    expect(plan.create).toEqual([
      { colorId: "R", sizeId: "S" },
      { colorId: "A", sizeId: "S" },
    ]);
    expect(plan.archive).toEqual(["sinTallaVacia"]);
    expect(plan.blocked).toEqual([{ variantId: "sinTallaConStock", stockOnHand: 6 }]);
  });

  it("quitar todas las tallas: se piden variantes sin talla y las de las tallas archivadas se archivan (o bloquean)", () => {
    const plan = planVariants(
      [color("R")],
      [size("S", true), size("M", true)],
      [variant("R", "S", { id: "s0" }), variant("R", "M", { id: "m4", stockOnHand: 4 })],
    );
    expect(plan.create).toEqual([{ colorId: "R", sizeId: null }]);
    expect(plan.archive).toEqual(["s0"]);
    expect(plan.blocked).toEqual([{ variantId: "m4", stockOnHand: 4 }]);
  });

  it("es idempotente: sobre una matriz completa el plan está vacío", () => {
    const complete = [variant("R", "S"), variant("R", "M"), variant("A", "S"), variant("A", "M")];
    const plan = planVariants([color("R"), color("A")], [size("S"), size("M")], complete);
    expect(isEmptyPlan(plan)).toBe(true);
  });

  it("sin colores activos no hay nada que crear (y todo lo activo sin stock se archiva)", () => {
    const plan = planVariants([color("R", true)], [size("S")], [variant("R", "S", { id: "x" })]);
    expect(plan.create).toEqual([]);
    expect(plan.archive).toEqual(["x"]);
  });

  it("120 variantes (12 colores × 10 tallas) se planifican completas y sin duplicados", () => {
    const colors = Array.from({ length: 12 }, (_, i) => color(`c${i}`));
    const sizes = Array.from({ length: 10 }, (_, i) => size(`s${i}`));
    const plan = planVariants(colors, sizes, []);
    expect(plan.create).toHaveLength(120);
    expect(new Set(plan.create.map((c) => `${c.colorId}|${c.sizeId}`)).size).toBe(120);
  });
});
