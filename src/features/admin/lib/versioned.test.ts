import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { StaleVersionError, isStaleVersion, updateVersioned } from "./versioned";

interface Step {
  /** Resultado de `update(...).eq(...).eq(...).select(...)`. */
  update: {
    data: { updated_at: string }[] | null;
    error: { code?: string; message: string } | null;
  };
  /** Resultado de la lectura de comprobación (solo si update devolvió 0 filas). */
  current?: {
    data: { updated_at: string } | null;
    error: { code?: string; message: string } | null;
  };
}

const calls: { patch?: object; eq: [string, string][]; read?: [string, string] }[] = [];
let step: Step;

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({
    from: () => {
      const call: (typeof calls)[number] = { eq: [] };
      calls.push(call);
      const updateBuilder = {
        eq(column: string, value: string) {
          call.eq.push([column, value]);
          return updateBuilder;
        },
        select: () => Promise.resolve(step.update),
      };
      return {
        update(patch: object) {
          call.patch = patch;
          return updateBuilder;
        },
        select: () => ({
          eq: (column: string, value: string) => {
            call.read = [column, value];
            return {
              maybeSingle: () => Promise.resolve(step.current ?? { data: null, error: null }),
            };
          },
        }),
      };
    },
  }),
}));

beforeEach(() => {
  calls.length = 0;
});

const MICRO = "2026-10-29T22:17:32.123456+00:00";

describe("updateVersioned", () => {
  it("actualiza y devuelve el NUEVO updated_at", async () => {
    step = { update: { data: [{ updated_at: "2026-10-29T22:18:00.000001+00:00" }], error: null } };
    const next = await updateVersioned("products", "p1", MICRO, { name: "Nuevo" });
    expect(next).toBe("2026-10-29T22:18:00.000001+00:00");
  });

  it("filtra por id Y por la versión esperada, enviando el updated_at EXACTO (con microsegundos)", async () => {
    step = { update: { data: [{ updated_at: "x" }], error: null } };
    await updateVersioned("products", "p1", MICRO, { name: "Nuevo" });
    expect(calls[0]?.patch).toEqual({ name: "Nuevo" });
    expect(calls[0]?.eq).toEqual([
      ["id", "p1"],
      ["updated_at", MICRO],
    ]);
  });

  it("usa otra columna de identidad cuando se indica (store_settings → key)", async () => {
    step = { update: { data: [{ updated_at: "x" }], error: null } };
    await updateVersioned("store_settings", "stock_low_threshold", MICRO, { value: 8 }, "key");
    expect(calls[0]?.eq[0]).toEqual(["key", "stock_low_threshold"]);
  });

  it("0 filas pero la fila existe → StaleVersionError (alguien guardó antes): no se pisa en silencio", async () => {
    step = {
      update: { data: [], error: null },
      current: { data: { updated_at: "2026-10-29T22:20:00+00:00" }, error: null },
    };
    const promise = updateVersioned("products", "p1", MICRO, { name: "Mío" });
    await expect(promise).rejects.toBeInstanceOf(StaleVersionError);
    await expect(promise).rejects.toMatchObject({ code: "conflict" });
    expect(calls[1]?.read).toEqual(["id", "p1"]);
  });

  it("0 filas y la fila ya no existe → not_found (no un falso conflicto)", async () => {
    step = { update: { data: [], error: null }, current: { data: null, error: null } };
    const error = await updateVersioned("products", "p1", MICRO, {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).not.toBeInstanceOf(StaleVersionError);
    expect((error as AppError).code).toBe("not_found");
  });

  it("un error de la base (código duplicado) se traduce a un mensaje claro", async () => {
    step = {
      update: {
        data: null,
        error: {
          code: "23505",
          message: 'duplicate key value violates unique constraint "products_code_key"',
        },
      },
    };
    const error = (await updateVersioned("products", "p1", MICRO, {}).catch(
      (e: unknown) => e,
    )) as AppError;
    expect(error.code).toBe("conflict");
    expect(error.message).toBe("Ya existe un producto con ese código.");
    expect(isStaleVersion(error)).toBe(false);
  });

  it("un error al leer la fila de comprobación también se traduce (no se oculta como conflicto)", async () => {
    step = {
      update: { data: [], error: null },
      current: { data: null, error: { code: "42501", message: "permission denied" } },
    };
    const error = (await updateVersioned("products", "p1", MICRO, {}).catch(
      (e: unknown) => e,
    )) as AppError;
    expect(error.code).toBe("forbidden");
  });

  it("isStaleVersion distingue el conflicto de edición de otros conflictos", () => {
    expect(isStaleVersion(new StaleVersionError())).toBe(true);
    expect(isStaleVersion(new AppError("conflict", "otro"))).toBe(false);
    expect(isStaleVersion(new Error("x"))).toBe(false);
  });
});
