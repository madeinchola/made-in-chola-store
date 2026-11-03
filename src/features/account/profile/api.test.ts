import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { argsOf, createRecorder, opNames, type RecordedCall, type Reply } from "./testRecorder";

const state = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => state.client }));
const callFunction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/functions", () => ({ callFunction }));

import {
  changeContact,
  contactBody,
  getProfilePreferences,
  listPublicCurrencies,
  updateProfile,
} from "./api";

let calls: RecordedCall[];
let reply: Reply;
beforeEach(() => {
  callFunction.mockReset();
  reply = { data: null, error: null };
  const recorder = createRecorder(() => reply);
  state.client = recorder.client;
  calls = recorder.calls;
});

const COLUMNS = "full_name,preferred_locale,preferred_currency";
const ROW = { full_name: "Ana Cliente", preferred_locale: "es", preferred_currency: "USD" };

describe("getProfilePreferences", () => {
  it("lee SOLO el perfil pedido (filtro por id: el admin ve todos por RLS) y mapea las columnas", async () => {
    reply = { data: ROW, error: null };
    await expect(getProfilePreferences("u-1")).resolves.toEqual({
      fullName: "Ana Cliente",
      locale: "es",
      currency: "USD",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.table).toBe("profiles");
    expect(argsOf(calls[0], "select")).toEqual([COLUMNS]);
    expect(argsOf(calls[0], "eq")).toEqual(["id", "u-1"]);
    expect(opNames(calls[0])).toContain("maybeSingle");
  });

  it("moneda NULL = la de la tienda", async () => {
    reply = { data: { ...ROW, preferred_currency: null }, error: null };
    expect((await getProfilePreferences("u-1")).currency).toBeNull();
  });

  it("sin fila → not_found con mensaje en español", async () => {
    reply = { data: null, error: null };
    const error = await getProfilePreferences("u-1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      code: "not_found",
      message: "No encontramos tu perfil. Vuelve a iniciar sesión.",
    });
  });

  it("un error de la base se traduce (no se muestra el texto interno)", async () => {
    reply = {
      data: null,
      error: { code: "42501", message: "permission denied for table profiles" },
    };
    const error = await getProfilePreferences("u-1").catch((e: unknown) => e);
    expect(error).toMatchObject({
      code: "forbidden",
      message: "No tienes permiso para realizar esta acción.",
    });
  });
});

describe("updateProfile", () => {
  it("solo el nombre: envía únicamente full_name, filtra por id y pide la fila nueva", async () => {
    reply = { data: [{ ...ROW, full_name: "Ana M." }], error: null };
    const result = await updateProfile("u-1", { fullName: "Ana M." });
    expect(result).toEqual({ fullName: "Ana M.", locale: "es", currency: "USD" });
    expect(calls[0]?.table).toBe("profiles");
    expect(argsOf(calls[0], "update")).toEqual([{ full_name: "Ana M." }]);
    expect(argsOf(calls[0], "eq")).toEqual(["id", "u-1"]);
    expect(argsOf(calls[0], "select")).toEqual([COLUMNS]);
  });

  it("preferencias: idioma y moneda (null = la de la tienda) con sus columnas", async () => {
    reply = { data: [{ ...ROW, preferred_currency: null }], error: null };
    await updateProfile("u-1", { locale: "es", currency: null });
    expect(argsOf(calls[0], "update")).toEqual([
      { preferred_locale: "es", preferred_currency: null },
    ]);
  });

  it("solo moneda, solo idioma, y las tres cosas a la vez", async () => {
    reply = { data: [ROW], error: null };
    await updateProfile("u-1", { currency: "EUR" });
    expect(argsOf(calls[0], "update")).toEqual([{ preferred_currency: "EUR" }]);
    await updateProfile("u-1", { locale: "es" });
    expect(argsOf(calls[1], "update")).toEqual([{ preferred_locale: "es" }]);
    await updateProfile("u-1", { fullName: "X", locale: "es", currency: "USD" });
    expect(argsOf(calls[2], "update")).toEqual([
      { full_name: "X", preferred_locale: "es", preferred_currency: "USD" },
    ]);
  });

  it("nunca envía email, teléfono ni rol (la base tampoco lo permite)", async () => {
    reply = { data: [ROW], error: null };
    await updateProfile("u-1", { fullName: "X", locale: "es", currency: "USD" });
    const sent = Object.keys((argsOf(calls[0], "update")?.[0] ?? {}) as object);
    expect(sent.sort()).toEqual(["full_name", "preferred_currency", "preferred_locale"]);
  });

  it("un cambio vacío no escribe nada: solo relee el perfil", async () => {
    reply = { data: ROW, error: null };
    await expect(updateProfile("u-1", {})).resolves.toMatchObject({ fullName: "Ana Cliente" });
    expect(opNames(calls[0])).not.toContain("update");
    expect(argsOf(calls[0], "eq")).toEqual(["id", "u-1"]);
  });

  it("0 filas actualizadas (no existe o no es suya) → not_found", async () => {
    reply = { data: [], error: null };
    await expect(updateProfile("u-1", { fullName: "X" })).rejects.toMatchObject({
      code: "not_found",
      message: "No encontramos tu perfil. Vuelve a iniciar sesión.",
    });
  });

  it("moneda deshabilitada (22023): conserva el mensaje en español de la regla de negocio", async () => {
    reply = {
      data: null,
      error: { code: "22023", message: "La moneda preferida no está habilitada" },
    };
    await expect(updateProfile("u-1", { currency: "JPY" })).rejects.toMatchObject({
      code: "validation",
      message: "La moneda preferida no está habilitada",
    });
  });

  it("error genérico: mensaje neutro, sin el texto de Postgres", async () => {
    reply = { data: null, error: { code: "XX000", message: "relation profiles internal detail" } };
    await expect(updateProfile("u-1", { fullName: "X" })).rejects.toMatchObject({
      message: "No se pudo completar la operación. Inténtalo de nuevo.",
    });
  });
});

describe("listPublicCurrencies", () => {
  it("lee la vista pública (solo habilitadas) ordenada por código y mapea", async () => {
    reply = {
      data: [
        { code: "BOB", name: "Boliviano", symbol: "Bs", decimals: 2 },
        { code: "CLP", name: "Peso chileno", symbol: "CLP$", decimals: 0 },
      ],
      error: null,
    };
    await expect(listPublicCurrencies()).resolves.toEqual([
      { code: "BOB", name: "Boliviano", symbol: "Bs", decimals: 2 },
      { code: "CLP", name: "Peso chileno", symbol: "CLP$", decimals: 0 },
    ]);
    expect(calls[0]?.table).toBe("public_currencies");
    expect(argsOf(calls[0], "select")).toEqual(["code,name,symbol,decimals"]);
    expect(argsOf(calls[0], "order")).toEqual(["code"]);
  });

  it("descarta filas incompletas y asume 2 decimales si falta el dato", async () => {
    reply = {
      data: [
        { code: null, name: "X", symbol: "x", decimals: 2 },
        { code: "AAA", name: null, symbol: "x", decimals: 2 },
        { code: "BBB", name: "B", symbol: null, decimals: 2 },
        { code: "", name: "Vacío", symbol: "v", decimals: 2 },
        { code: "USD", name: "Dólar", symbol: "$", decimals: null },
      ],
      error: null,
    };
    await expect(listPublicCurrencies()).resolves.toEqual([
      { code: "USD", name: "Dólar", symbol: "$", decimals: 2 },
    ]);
  });

  it("sin datos → lista vacía; con error → lanza", async () => {
    reply = { data: null, error: null };
    await expect(listPublicCurrencies()).resolves.toEqual([]);
    reply = { data: null, error: { code: "42501", message: "x" } };
    await expect(listPublicCurrencies()).rejects.toBeInstanceOf(AppError);
  });
});

describe("contactBody · cuerpo de update-contact (undefined = no tocar · null = quitar)", () => {
  it.each([
    [
      { password: "p", email: "a@b.co" },
      { password: "p", email: "a@b.co" },
    ],
    [
      { password: "p", email: null },
      { password: "p", email: null },
    ],
    [
      { password: "p", phone: "+59171234567", phoneCountry: "BO" },
      { password: "p", phone: "+59171234567", phone_country: "BO" },
    ],
    [
      { password: "p", phone: null, phoneCountry: "BO" },
      { password: "p", phone: null },
    ], // quitar: sin país
    [
      { password: "p", phone: "+59171234567" },
      { password: "p", phone: "+59171234567" },
    ],
    [{ password: "p" }, { password: "p" }],
    [
      { password: "p", email: "a@b.co", phone: "+59171234567", phoneCountry: "BO" },
      { password: "p", email: "a@b.co", phone: "+59171234567", phone_country: "BO" },
    ],
    [{ password: "p", phoneCountry: "AR" }, { password: "p" }], // país sin teléfono: no viaja
  ])("%j → %j", (input, expected) => {
    expect(contactBody(input)).toStrictEqual(expected);
  });
});

describe("changeContact", () => {
  it("llama a la Edge Function `update-contact` con el cuerpo y el token de la sesión", async () => {
    callFunction.mockResolvedValue({ ok: true, data: { ok: true, changed: true } });
    const result = await changeContact({ password: "clave", email: "n@x.co" }, "tok-9");
    expect(callFunction).toHaveBeenCalledWith(
      "update-contact",
      { password: "clave", email: "n@x.co" },
      { token: "tok-9" },
    );
    expect(result).toEqual({ ok: true, data: { ok: true, changed: true } });
  });

  it("devuelve el fallo tal cual (sin lanzar) para que el diálogo decida", async () => {
    const failure = { ok: false, status: 401, code: "invalid_credentials", message: "x" };
    callFunction.mockResolvedValue(failure);
    await expect(changeContact({ password: "mala", email: "n@x.co" }, undefined)).resolves.toBe(
      failure,
    );
    expect(callFunction).toHaveBeenCalledWith(
      "update-contact",
      { password: "mala", email: "n@x.co" },
      { token: undefined },
    );
  });
});
