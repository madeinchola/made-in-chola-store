import { describe, expect, it } from "vitest";
import { t } from "@/i18n";
import {
  amountProblemText,
  distanceListText,
  nameProblemText,
  numberProblemText,
  priorityProblemText,
  tierUpToText,
  validUntilText,
} from "./RatesMessages";
import {
  latitudeProblemText,
  longitudeProblemText,
  radiusProblemText,
  zoneCitiesText,
  zoneNameText,
} from "./ZonesMessages";

describe("mensajes de problema de números y tramos", () => {
  it("cada código tiene su propio texto, distinto de los demás", () => {
    expect(numberProblemText("required", "cost")).toBe("Escribe un valor.");
    expect(numberProblemText("number", "cost")).toBe("Escribe un número (por ejemplo 15 o 2,5).");
    expect(numberProblemText("negative", "cost")).toBe("No puede ser negativo.");
    expect(numberProblemText("zero", "km")).toBe("Debe ser mayor que 0.");
  });
  it("«demasiado grande» depende del tope: km o costo", () => {
    expect(numberProblemText("too_big", "km")).toBe("No puede pasar de 20.000 km.");
    expect(numberProblemText("too_big", "cost")).toBe("Debe ser menor que 1.000.000.");
  });
  it("el campo «hasta» de un tramo suma «orden» y usa el tope de km", () => {
    expect(tierUpToText("order")).toBe("Debe ser mayor que el «hasta» del tramo anterior.");
    expect(tierUpToText("too_big")).toBe("No puede pasar de 20.000 km.");
    expect(tierUpToText("zero")).toBe("Debe ser mayor que 0.");
  });
  it("problemas de la lista de tramos", () => {
    expect(distanceListText("no_tiers")).toBe("Añade al menos un tramo.");
    expect(distanceListText("too_many")).toBe("Máximo 20 tramos.");
  });
  it("monto del pedido", () => {
    expect(amountProblemText("number")).toBe("Escribe un número (por ejemplo 15 o 2,5).");
    expect(amountProblemText("negative")).toBe("No puede ser negativo.");
    expect(amountProblemText("too_big")).toBe("Debe ser menor que 10.000.000.000.");
  });
  it("prioridad", () => {
    expect(priorityProblemText("required")).toBe("Escribe la prioridad.");
    expect(priorityProblemText("number")).toBe("La prioridad debe ser un número entero.");
    expect(priorityProblemText("integer")).toBe(
      "La prioridad debe ser un número entero, sin decimales.",
    );
    expect(priorityProblemText("range")).toBe("La prioridad debe estar entre 0 y 100.000.");
  });
  it("nombre y fin de vigencia", () => {
    expect(nameProblemText("required")).toBe("Escribe un nombre para la tarifa.");
    expect(nameProblemText("too_long")).toBe("El nombre admite hasta 80 caracteres.");
    expect(validUntilText("invalid")).toBe("Escribe una fecha y hora válidas.");
    expect(validUntilText("before_from")).toBe("Debe ser posterior al inicio de la vigencia.");
  });
});

describe("mensajes de problema de las zonas", () => {
  it("nombre y ciudades", () => {
    expect(zoneNameText("required")).toBe("Escribe un nombre para la zona.");
    expect(zoneNameText("too_long")).toBe("El nombre admite hasta 80 caracteres.");
    expect(zoneCitiesText("none")).toBe("Añade al menos una ciudad.");
    expect(zoneCitiesText("too_many")).toBe("Una zona admite como máximo 200 ciudades.");
  });
  it("radio", () => {
    expect(radiusProblemText("required")).toBe("Escribe el radio en kilómetros.");
    expect(radiusProblemText("number")).toBe("El radio debe ser un número (por ejemplo 5 o 7,5).");
    expect(radiusProblemText("not_positive")).toBe("El radio debe ser mayor que 0.");
    expect(radiusProblemText("too_big")).toBe("El radio no puede pasar de 20.000 km.");
    expect(radiusProblemText("decimals")).toBe("Usa como máximo 2 decimales.");
  });
  it("latitud y longitud dicen cuál es el campo y su rango", () => {
    expect(latitudeProblemText("missing")).toBe("Escribe también la latitud.");
    expect(latitudeProblemText("format")).toBe(
      "La latitud debe ser un número (por ejemplo -16,5).",
    );
    expect(latitudeProblemText("range")).toBe("La latitud debe estar entre -90 y 90.");
    expect(longitudeProblemText("missing")).toBe("Escribe también la longitud.");
    expect(longitudeProblemText("format")).toBe(
      "La longitud debe ser un número (por ejemplo -68,15).",
    );
    expect(longitudeProblemText("range")).toBe("La longitud debe estar entre -180 y 180.");
  });
});

describe("textos de Zonas y Tarifas", () => {
  it("existen las claves que usa la pantalla (una clave faltante se vería como la clave misma)", () => {
    for (const key of [
      "admin.shipping.rates.zones.title",
      "admin.shipping.rates.rules.title",
      "admin.shipping.rates.tiers.legend",
    ] as const) {
      expect(t(key)).not.toBe(key);
    }
  });
});
