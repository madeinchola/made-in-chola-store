import { beforeEach, describe, expect, it, vi } from "vitest";
import { toDecimalString } from "@/lib/money";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({ rpc }) }));

import { getPublicPrice, toMoney } from "./priceService";

describe("toMoney", () => {
  it("convierte un numeric de la BD a Money exacto", () => {
    expect(toDecimalString(toMoney(560, "BOB")!)).toBe("560.00");
    expect(toDecimalString(toMoney(450.5, "BOB")!)).toBe("450.50");
    expect(toMoney(450.5, "BOB")?.amount).toBe(45050); // centavos enteros, no 45049.999…
  });

  it("no pierde precisión con decimales típicos de coma flotante (0.1 + 0.2 no existe aquí)", () => {
    expect(toMoney(0.3, "BOB")?.amount).toBe(30);
    expect(toMoney(1.15, "BOB")?.amount).toBe(115); // 1.15 * 100 = 114.99999999999999 en float
    expect(toMoney(80.46, "USD")?.amount).toBe(8046);
  });

  it("acepta strings decimales", () => {
    expect(toMoney("81.20", "USD")?.amount).toBe(8120);
  });

  it("null/undefined → null (sin precio)", () => {
    expect(toMoney(null)).toBeNull();
    expect(toMoney(undefined)).toBeNull();
  });

  it("usa BOB por defecto y conserva la moneda", () => {
    expect(toMoney(10)?.currency).toBe("BOB");
    expect(toMoney(10, "USD")?.currency).toBe("USD");
  });

  it("una moneda no soportada falla en voz alta (no devuelve un precio equivocado)", () => {
    expect(() => toMoney(10, "XXX")).toThrow();
  });
});

describe("getPublicPrice", () => {
  beforeEach(() => rpc.mockReset());

  it("pide el precio BOB por defecto y lo devuelve como Money", async () => {
    rpc.mockResolvedValue({ data: 560, error: null });
    const price = await getPublicPrice("p1");
    expect(rpc).toHaveBeenCalledWith("public_price_for", { p_product_id: "p1", p_currency: "BOB" });
    expect(price).toEqual({ amount: 56000, currency: "BOB" });
  });

  it("envía moneda y país cuando se piden", async () => {
    rpc.mockResolvedValue({ data: 90, error: null });
    const price = await getPublicPrice("p1", { currency: "USD", country: "AR" });
    expect(rpc).toHaveBeenCalledWith("public_price_for", {
      p_product_id: "p1",
      p_currency: "USD",
      p_country: "AR",
    });
    expect(price).toEqual({ amount: 9000, currency: "USD" });
  });

  it("producto no público o sin precio → null", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await getPublicPrice("p1")).toBeNull();
  });

  it("un error de la BD se convierte en AppError", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "denied" } });
    await expect(getPublicPrice("p1")).rejects.toMatchObject({
      name: "AppError",
      code: "forbidden",
    });
  });
});
