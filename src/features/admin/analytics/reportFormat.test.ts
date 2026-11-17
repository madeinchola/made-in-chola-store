import { describe, expect, it } from "vitest";
import { csvValue, displayValue } from "./reportFormat";

describe("displayValue: lo que se ve en la tabla", () => {
  it("lo desconocido es «—», nunca un cero", () => {
    expect(displayValue("money", null, "BOB")).toBe("—");
    expect(displayValue("percent", null, "BOB")).toBe("—");
    expect(displayValue("text", "", "BOB")).toBe("—");
  });
  it("importes con símbolo y coma decimal; enteros con separador de miles", () => {
    expect(displayValue("money", 1234.5, "BOB")).toBe("Bs 1.234,50");
    expect(displayValue("money", 0, "BOB")).toBe("Bs 0,00");
    expect(displayValue("money", 25, "USD")).toBe("$ 25,00");
    expect(displayValue("int", 14, "BOB")).toBe("14");
    expect(displayValue("percent", 38.46, "BOB")).toBe("38,5 %");
  });
  it("las fechas van en hora de La Paz (UTC−4), no en la del navegador", () => {
    // 2020-03-05 22:00 UTC = 18:00 en La Paz
    expect(displayValue("datetime", "2020-03-05T22:00:00+00:00", "BOB")).toBe("2020-03-05 18:00");
    // 01:00 UTC del 6 = 21:00 del 5
    expect(displayValue("date", "2020-03-06T01:00:00+00:00", "BOB")).toBe("2020-03-05");
  });
  it("los códigos de la base salen en palabras", () => {
    expect(displayValue("saleStatus", "preparing", "BOB")).toBe("Preparando");
    expect(displayValue("paymentStatus", "disputed", "BOB")).toBe("En disputa");
    expect(displayValue("refundStatus", "processed", "BOB")).toBe("Devuelto");
    expect(displayValue("stockLight", "critical", "BOB")).toBe("Crítico");
    expect(displayValue("paymentMethod", "cash_on_delivery", "BOB")).toBe("Contra entrega");
    expect(displayValue("channel", "manual", "BOB")).toBe("Pedido manual");
    expect(displayValue("segment", "new", "BOB")).toBe("Nueva");
    expect(displayValue("returnKind", "return", "BOB")).toBe("Devolución");
    expect(displayValue("yesNo", true, "BOB")).toBe("Sí");
    expect(displayValue("yesNo", false, "BOB")).toBe("No");
  });
  it("un código que no conoce se muestra tal cual (no se inventa un nombre)", () => {
    expect(displayValue("saleStatus", "algo_nuevo", "BOB")).toBe("algo_nuevo");
  });
});

describe("csvValue: lo que va al archivo", () => {
  it("el importe va sin símbolo ni miles, con los decimales de SU moneda y el separador elegido", () => {
    expect(csvValue("money", 1234.5, "BOB", "standard")).toBe("1234.50");
    expect(csvValue("money", 1234.5, "BOB", "excel")).toBe("1234,50");
    expect(csvValue("money", 25, "USD", "excel")).toBe("25,00");
    expect(csvValue("money", 1000, "CLP", "excel")).toBe("1000");
  });
  it("lo desconocido es una celda vacía (no un cero)", () => {
    expect(csvValue("money", null, "BOB", "excel")).toBe("");
    expect(csvValue("percent", null, "BOB", "excel")).toBe("");
    expect(csvValue("datetime", null, "BOB", "excel")).toBe("");
  });
  it("porcentaje con un decimal y enteros sin decimales", () => {
    expect(csvValue("percent", 38.46, "BOB", "excel")).toBe("38,5");
    expect(csvValue("percent", 38.46, "BOB", "standard")).toBe("38.5");
    expect(csvValue("int", 14, "BOB", "excel")).toBe("14");
  });
  it("las fechas van en hora de La Paz y las palabras en español", () => {
    expect(csvValue("datetime", "2020-03-05T22:00:00+00:00", "BOB", "excel")).toBe(
      "2020-03-05 18:00",
    );
    expect(csvValue("saleStatus", "completed", "BOB", "excel")).toBe("Completado");
    expect(csvValue("yesNo", true, "BOB", "excel")).toBe("Sí");
  });
  it("un importe negativo conserva su signo (no es una fórmula: es un número)", () => {
    expect(csvValue("money", -5, "BOB", "standard")).toBe("-5.00");
  });
});
