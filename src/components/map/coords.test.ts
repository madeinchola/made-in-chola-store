import { describe, expect, it } from "vitest";
import {
  EMPTY_PIN,
  formatCoordinate,
  normalizeLatLng,
  parseCoordinate,
  parsePin,
  roundCoordinate,
  toPinText,
} from "./coords";

describe("parseCoordinate", () => {
  it.each([
    ["-16.5", 90, -16.5],
    ["-16,5", 90, -16.5], // coma decimal
    ["16.5", 90, 16.5],
    ["+16.5", 90, 16.5],
    ["  -68.15  ", 180, -68.15], // se recorta
    ["−16.5", 90, -16.5], // signo menos tipográfico
    [".5", 90, 0.5],
    ["5.", 90, 5],
    ["5,", 90, 5],
    ["0", 90, 0],
    ["-68.1234567", 180, -68.123457], // 7.º decimal 7 → redondea hacia arriba al 6.º
    ["-68.1234564", 180, -68.123456], // 7.º decimal 4 → hacia abajo
  ])("acepta %j (límite %i) → %f", (text, limit, expected) => {
    expect(parseCoordinate(text, limit)).toEqual({ ok: true, value: expected });
  });

  it("«-0» y similares dan 0 (nunca -0)", () => {
    const result = parseCoordinate("-0", 90);
    expect(result.ok && Object.is(result.value, 0)).toBe(true);
    const tiny = parseCoordinate("-0.0000001", 90); // redondea a 0 con 6 decimales
    expect(tiny.ok && Object.is(tiny.value, 0)).toBe(true);
  });

  it.each([
    "",
    "   ",
    "abc",
    "1e3",
    "0x10",
    "NaN",
    "Infinity",
    "--1",
    "1.2.3",
    "1,2,3",
    "1,234.5", // mezcla de separadores
    "16.5°",
    "- 16",
    "16 .5",
    "+",
    "-",
    ".",
    ",",
  ])("rechaza el formato de %j", (text) => {
    expect(parseCoordinate(text, 90)).toEqual({ ok: false, problem: "format" });
  });

  it("los límites son inclusivos y se comprueban tras redondear a 6 decimales (como numeric(9,6))", () => {
    expect(parseCoordinate("90", 90)).toEqual({ ok: true, value: 90 });
    expect(parseCoordinate("-90", 90)).toEqual({ ok: true, value: -90 });
    expect(parseCoordinate("90.0000004", 90)).toEqual({ ok: true, value: 90 }); // redondea a 90.000000
    expect(parseCoordinate("90.000001", 90)).toEqual({ ok: false, problem: "range" });
    expect(parseCoordinate("-90.000001", 90)).toEqual({ ok: false, problem: "range" });
    expect(parseCoordinate("180", 180)).toEqual({ ok: true, value: 180 });
    expect(parseCoordinate("-180", 180)).toEqual({ ok: true, value: -180 });
    expect(parseCoordinate("180.5", 180)).toEqual({ ok: false, problem: "range" });
    expect(parseCoordinate("999999999999", 180)).toEqual({ ok: false, problem: "range" });
  });
});

describe("roundCoordinate y formatCoordinate", () => {
  it("redondea a 6 decimales", () => {
    expect(roundCoordinate(-16.5)).toBe(-16.5);
    expect(roundCoordinate(1.23456789)).toBe(1.234568);
    expect(roundCoordinate(-1.23456749)).toBe(-1.234567);
  });

  it("el texto es canónico: punto decimal y sin ceros de sobra", () => {
    expect(formatCoordinate(-16.5)).toBe("-16.5");
    expect(formatCoordinate(-68.123457)).toBe("-68.123457");
    expect(formatCoordinate(1)).toBe("1");
    expect(formatCoordinate(0.1 + 0.2)).toBe("0.3");
    expect(formatCoordinate(-0)).toBe("0");
    expect(formatCoordinate(12.3456789)).toBe("12.345679");
  });
});

describe("parsePin", () => {
  it("ambos vacíos (o solo espacios) = sin pin", () => {
    expect(parsePin(EMPTY_PIN)).toEqual({ kind: "none" });
    expect(parsePin({ lat: "  ", lng: " " })).toEqual({ kind: "none" });
  });

  it("par válido (con punto o coma) = pin", () => {
    expect(parsePin({ lat: "-16.5", lng: "-68.15" })).toEqual({
      kind: "pin",
      lat: -16.5,
      lng: -68.15,
    });
    expect(parsePin({ lat: "-16,5", lng: "-68,15" })).toEqual({
      kind: "pin",
      lat: -16.5,
      lng: -68.15,
    });
  });

  it("pin a medias: el campo vacío es «missing»", () => {
    expect(parsePin({ lat: "-16.5", lng: "" })).toEqual({ kind: "invalid", lng: "missing" });
    expect(parsePin({ lat: "", lng: "-68.15" })).toEqual({ kind: "invalid", lat: "missing" });
  });

  it("informa el problema de cada campo por separado", () => {
    expect(parsePin({ lat: "abc", lng: "-68.15" })).toEqual({ kind: "invalid", lat: "format" });
    expect(parsePin({ lat: "-16.5", lng: "181" })).toEqual({ kind: "invalid", lng: "range" });
    expect(parsePin({ lat: "91", lng: "x" })).toEqual({
      kind: "invalid",
      lat: "range",
      lng: "format",
    });
    // Uno vacío y el otro inválido: se ven los dos problemas.
    expect(parsePin({ lat: "abc", lng: "" })).toEqual({
      kind: "invalid",
      lat: "format",
      lng: "missing",
    });
  });
});

describe("toPinText", () => {
  it("de pin a texto y de «sin pin» a vacío", () => {
    expect(toPinText({ lat: -16.5, lng: -68.15 })).toEqual({ lat: "-16.5", lng: "-68.15" });
    expect(toPinText(null)).toEqual({ lat: "", lng: "" });
  });
});

describe("normalizeLatLng", () => {
  it("deja intacto un punto válido", () => {
    expect(normalizeLatLng({ lat: -16.5, lng: -68.15 })).toEqual({ lat: -16.5, lng: -68.15 });
  });

  it("acota la latitud a ±90", () => {
    expect(normalizeLatLng({ lat: 95, lng: 0 }).lat).toBe(90);
    expect(normalizeLatLng({ lat: -95, lng: 0 }).lat).toBe(-90);
  });

  it("envuelve la longitud (Leaflet permite arrastrar más allá de ±180°)", () => {
    expect(normalizeLatLng({ lat: 0, lng: 190 }).lng).toBe(-170); // 190 − 360
    expect(normalizeLatLng({ lat: 0, lng: -190 }).lng).toBe(170); // −190 + 360
    expect(normalizeLatLng({ lat: 0, lng: 360 }).lng).toBe(0);
    expect(normalizeLatLng({ lat: 0, lng: 540 }).lng).toBe(180); // 540 = 180 + 360, positivo se queda en +180
    expect(normalizeLatLng({ lat: 0, lng: 180 }).lng).toBe(180);
    expect(normalizeLatLng({ lat: 0, lng: -180 }).lng).toBe(-180);
    expect(normalizeLatLng({ lat: 0, lng: -68.15 }).lng).toBe(-68.15);
  });

  it("redondea a 6 decimales", () => {
    expect(normalizeLatLng({ lat: -16.5123456789, lng: -68.1234567 })).toEqual({
      lat: -16.512346,
      lng: -68.123457,
    });
  });
});
