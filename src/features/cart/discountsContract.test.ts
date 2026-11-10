import { describe, expect, it } from "vitest";
// El SQL y el TypeScript se escriben a mano en dos lugares: esta prueba lee la migración y falla si se desalinean.
import migration from "../../../supabase/migrations/20261107000100_s9_descuentos.sql?raw";
import { COUPON_REASONS } from "./types";

/**
 * Los motivos que el SQL puede devolver: `v_reason := '…'` (motor y carrito), `return '…'` (el chequeo de la clienta) y
 * `'reason', '…'` (reservas).
 */
function sqlReasons(): Set<string> {
  const found = new Set<string>();
  for (const m of migration.matchAll(/v_reason\s*:=\s*'([a-z_]+)'/g)) found.add(m[1]!);
  for (const m of migration.matchAll(/return\s+'([a-z_]+)';/g)) found.add(m[1]!);
  for (const m of migration.matchAll(/'reason',\s*'([a-z_]+)'/g)) found.add(m[1]!);
  return found;
}

/** Motivos que solo salen de `discount_reserve` (el checkout de S10 los mostrará); no los devuelve el carrito. */
const RESERVE_ONLY = ["one_coupon_per_order"];

describe("contrato de descuentos SQL ↔ TypeScript", () => {
  it("la lectura de la migración encuentra los motivos (la prueba no puede pasar «por vacío»)", () => {
    expect(sqlReasons().size).toBeGreaterThanOrEqual(10);
    expect(sqlReasons().has("invalid_code")).toBe(true);
  });

  it("todo motivo que el SQL puede devolver está en COUPON_REASONS (o es solo de las reservas)", () => {
    const missing = [...sqlReasons()].filter(
      (r) => !(COUPON_REASONS as readonly string[]).includes(r) && !RESERVE_ONLY.includes(r),
    );
    expect(missing).toEqual([]);
  });

  it("todo motivo de COUPON_REASONS lo produce el SQL (no hay motivos fantasma que la pantalla espere en vano)", () => {
    const sql = sqlReasons();
    expect(COUPON_REASONS.filter((r) => !sql.has(r))).toEqual([]);
  });

  it("los motivos son únicos", () => {
    expect(new Set(COUPON_REASONS).size).toBe(COUPON_REASONS.length);
  });

  it("las claves del snapshot que lee el cliente existen en la función SQL del carrito", () => {
    for (const key of [
      "'discount_offers'",
      "'final_total'",
      "'discounts'",
      "'free_shipping'",
      "'coupon'",
    ]) {
      expect(migration, key).toContain(key);
    }
  });

  it("los motivos del carrito que se GUARDAN con el cupón son los que el cliente entiende como «guardado»", () => {
    // `cart_set_coupon` guarda el cupón si se aplica o si el motivo es uno de estos: la pantalla los muestra como «guardado».
    const stored =
      /v_reason in \(([^)]*)\)/
        .exec(migration)?.[1]
        ?.match(/'([a-z_]+)'/g)
        ?.map((s) => s.slice(1, -1)) ?? [];
    expect(stored.sort()).toEqual(["min_not_reached", "not_applicable", "not_combinable"]);
  });
});
