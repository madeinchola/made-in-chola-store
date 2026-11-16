import { describe, expect, it } from "vitest";
import "@/i18n/admin/register";
import { behaviorText, fieldText } from "./settingsText";

describe("behaviorText: las palabras de cada opción de Sí/No", () => {
  it("un ajuste con sus propias palabras las usa (devoluciones)", () => {
    expect(behaviorText("true", "returns_enabled")).toBe("Sí: se aceptan devoluciones");
    expect(behaviorText("false", "returns_enabled")).toBe("No: no se abren devoluciones");
  });

  it("el del carrito sigue diciendo lo de la bolsa (no se contagia de las devoluciones)", () => {
    expect(behaviorText("true", "reserve_on_add_to_cart")).toBe(
      "Sí: se reserva al agregar a la bolsa",
    );
    expect(behaviorText("true")).toBe("Sí: se reserva al agregar a la bolsa");
  });

  it("las opciones del comportamiento sin stock y una desconocida", () => {
    expect(behaviorText("sold_out", "default_out_of_stock_behavior")).toBe("Mostrar como agotado");
    expect(behaviorText("algo-raro", "returns_enabled")).toBe("algo-raro");
  });
});

describe("fieldText de los ajustes de S12", () => {
  it("tienen etiqueta y ayuda (no la clave a la vista)", () => {
    for (const key of ["returns_enabled", "return_window_days", "order_undo_window_minutes"]) {
      expect(fieldText(key).label).not.toBe(key);
      expect(fieldText(key).hint).toBeTruthy();
    }
    expect(fieldText("order_undo_window_minutes").hint).toMatch(/clienta nunca los recibe/);
  });
});
