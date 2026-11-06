import { describe, expect, it } from "vitest";
import {
  addCities,
  formatKm,
  hasCoverage,
  initialZoneValues,
  MAX_CITIES,
  MAX_CITY_LENGTH,
  normalizeCity,
  parseRadius,
  removeCity,
  sortZones,
  toZoneUpdateInput,
  validateZone,
  zoneArchiveImpact,
  zoneGivesService,
  zoneStatus,
  zoneSummary,
  type ZoneFormValues,
} from "./ZonesLogic";
import type { RateRule, ShippingZone } from "./types";

const zone = (over: Partial<ShippingZone> = {}): ShippingZone => ({
  id: "z1",
  name: "Centro",
  kind: "city",
  cities: ["La Paz"],
  centerLat: null,
  centerLng: null,
  radiusKm: null,
  allowed: true,
  isActive: true,
  archived: false,
  updatedAt: "2026-11-05T10:00:00.123456+00:00",
  ...over,
});
const rate = (over: Partial<RateRule> = {}): RateRule => ({
  id: "r1",
  methodId: "m1",
  zoneId: null,
  name: "Regla",
  kind: "flat",
  params: { kind: "flat", cost: 10 },
  minOrderAmount: null,
  maxOrderAmount: null,
  currency: "BOB",
  priority: 100,
  isActive: true,
  validFrom: null,
  validUntil: null,
  archived: false,
  updatedAt: "2026-11-05T10:00:00+00:00",
  ...over,
});

describe("normalizeCity (igual que _ship_norm del servidor)", () => {
  it.each([
    ["La Paz", "la paz"],
    ["  Cochabámba ", "cochabamba"],
    ["EL   ALTO", "el alto"],
    ["Potosí", "potosi"],
    ["Ñuñoa", "nunoa"],
    ["Santa Cruz\tde la Sierra", "santa cruz de la sierra"],
  ])("%j → %j", (input, expected) => expect(normalizeCity(input)).toBe(expected));
});

describe("addCities", () => {
  it("añade una ciudad conservando como la escribió la persona", () => {
    const r = addCities([], "  la   paz ");
    expect(r.cities).toEqual(["la paz"]);
    expect(r.added).toEqual(["la paz"]);
    expect(r.duplicates).toEqual([]);
  });
  it("acepta varias separadas por coma, punto y coma o salto de línea, e ignora vacías", () => {
    const r = addCities(["Sucre"], "La Paz, El Alto;Oruro\n\n ,Tarija,");
    expect(r.cities).toEqual(["Sucre", "La Paz", "El Alto", "Oruro", "Tarija"]);
    expect(r.added).toEqual(["La Paz", "El Alto", "Oruro", "Tarija"]);
  });
  it("ignora las repetidas sin importar tildes ni mayúsculas, también dentro de lo pegado", () => {
    const r = addCities(["Potosí"], "potosi, POTOSÍ, Sucre, sucre");
    expect(r.cities).toEqual(["Potosí", "Sucre"]);
    expect(r.added).toEqual(["Sucre"]);
    expect(r.duplicates).toEqual(["potosi", "POTOSÍ", "sucre"]);
  });
  it("rechaza una ciudad de más de 80 caracteres (80 sí cabe)", () => {
    const ok = "a".repeat(MAX_CITY_LENGTH);
    const long = "b".repeat(MAX_CITY_LENGTH + 1);
    const r = addCities([], `${ok}, ${long}`);
    expect(r.cities).toEqual([ok]);
    expect(r.tooLong).toEqual([long]);
  });
  it("no pasa de 200 ciudades: la 200 entra, la 201 se informa", () => {
    const current = Array.from({ length: MAX_CITIES - 1 }, (_, i) => `ciudad ${i}`);
    const r = addCities(current, "última, sobrante");
    expect(r.cities).toHaveLength(200);
    expect(r.added).toEqual(["última"]);
    expect(r.overLimit).toEqual(["sobrante"]);
  });
  it("un texto vacío no añade nada y no toca la lista", () => {
    const current = ["La Paz"];
    const r = addCities(current, " , ; ");
    expect(r.cities).toEqual(["La Paz"]);
    expect(r.added).toEqual([]);
    expect(r.cities).not.toBe(current);
  });
});

describe("removeCity", () => {
  it("quita solo la de esa posición", () => {
    expect(removeCity(["a", "b", "c"], 1)).toEqual(["a", "c"]);
    expect(removeCity(["a", "b", "c"], 0)).toEqual(["b", "c"]);
    expect(removeCity(["a"], 0)).toEqual([]);
  });
});

describe("parseRadius", () => {
  it.each([
    ["5", 5],
    ["7,5", 7.5],
    ["7.25", 7.25],
    [" 12 ", 12],
    ["0,01", 0.01],
    ["20000", 20000],
    ["5,50", 5.5],
    ["5,500", 5.5],
    ["0.29", 0.29],
  ])("acepta %j como %d", (text, value) => expect(parseRadius(text)).toEqual({ ok: true, value }));
  it.each([
    ["", "required"],
    ["   ", "required"],
    ["abc", "number"],
    ["5 km", "number"],
    ["1e3", "number"],
    ["0", "not_positive"],
    ["-3", "not_positive"],
    ["20000,01", "too_big"],
    ["20001", "too_big"],
    ["5,555", "decimals"],
    ["0,001", "decimals"],
    ["0.285", "decimals"],
  ])("rechaza %j con el problema %s", (text, problem) =>
    expect(parseRadius(text)).toEqual({ ok: false, problem }),
  );
});

describe("formatKm", () => {
  it("usa coma decimal", () => {
    expect(formatKm(3)).toBe("3");
    expect(formatKm(2.5)).toBe("2,5");
    expect(formatKm(0.25)).toBe("0,25");
  });
});

describe("zoneSummary", () => {
  const base = { radiusKm: null, centerLat: null, centerLng: null };
  it("lista las ciudades con «y» antes de la última", () => {
    expect(zoneSummary({ ...base, kind: "city", cities: ["La Paz"] })).toBe("La Paz");
    expect(zoneSummary({ ...base, kind: "city", cities: ["La Paz", "El Alto", "Achumani"] })).toBe(
      "La Paz, El Alto y Achumani",
    );
  });
  it("usa «e» cuando la última empieza por «i» (ortografía del español)", () => {
    expect(zoneSummary({ ...base, kind: "city", cities: ["La Paz", "Iquique"] })).toBe(
      "La Paz e Iquique",
    );
  });
  it("con más de 5 ciudades resume el resto", () => {
    const cities = ["a", "b", "c", "d", "e", "f", "g", "h"];
    expect(zoneSummary({ ...base, kind: "city", cities })).toBe("a, b, c, d, e y 3 más");
    // Exactamente 5: se listan todas.
    expect(zoneSummary({ ...base, kind: "city", cities: cities.slice(0, 5) })).toBe(
      "a, b, c, d y e",
    );
    // El tope es un parámetro.
    expect(zoneSummary({ ...base, kind: "city", cities }, 2)).toBe("a, b y 6 más");
  });
  it("una zona de ciudades sin ciudades (dato ilegible) no rompe", () => {
    expect(zoneSummary({ ...base, kind: "city", cities: null })).toBe("Sin ciudades");
    expect(zoneSummary({ ...base, kind: "city", cities: [] })).toBe("Sin ciudades");
  });
  it("una zona de radio dice el radio y el centro", () => {
    expect(
      zoneSummary({
        kind: "radius",
        cities: null,
        radiusKm: 5,
        centerLat: -16.5,
        centerLng: -68.15,
      }),
    ).toBe("Radio de 5 km (centro: -16.5, -68.15)");
    expect(
      zoneSummary({
        kind: "radius",
        cities: null,
        radiusKm: 2.5,
        centerLat: -16.5,
        centerLng: -68.15,
      }),
    ).toBe("Radio de 2,5 km (centro: -16.5, -68.15)");
  });
  it("una zona de radio sin radio o sin centro no rompe", () => {
    expect(
      zoneSummary({
        kind: "radius",
        cities: null,
        radiusKm: null,
        centerLat: -16.5,
        centerLng: -68,
      }),
    ).toBe("Sin radio o centro definido");
    expect(
      zoneSummary({ kind: "radius", cities: null, radiusKm: 5, centerLat: null, centerLng: -68 }),
    ).toBe("Sin radio o centro definido");
    expect(
      zoneSummary({ kind: "radius", cities: null, radiusKm: 5, centerLat: -16, centerLng: null }),
    ).toBe("Sin radio o centro definido");
  });
});

describe("estado y cobertura", () => {
  it("zoneStatus: archivada gana a inactiva", () => {
    expect(zoneStatus({ archived: false, isActive: true })).toBe("active");
    expect(zoneStatus({ archived: false, isActive: false })).toBe("inactive");
    expect(zoneStatus({ archived: true, isActive: true })).toBe("archived");
    expect(zoneStatus({ archived: true, isActive: false })).toBe("archived");
  });
  it("solo da servicio una zona permitida, activa y no archivada", () => {
    expect(zoneGivesService(zone())).toBe(true);
    expect(zoneGivesService(zone({ allowed: false }))).toBe(false);
    expect(zoneGivesService(zone({ isActive: false }))).toBe(false);
    expect(zoneGivesService(zone({ archived: true }))).toBe(false);
  });
  it("hasCoverage: una zona sin servicio no cuenta como cobertura", () => {
    expect(hasCoverage([])).toBe(false);
    expect(hasCoverage([zone({ allowed: false })])).toBe(false);
    expect(hasCoverage([zone({ allowed: false }), zone({ id: "z2" })])).toBe(true);
    expect(hasCoverage([zone({ archived: true }), zone({ id: "z2", isActive: false })])).toBe(
      false,
    );
  });
  it("sortZones: las archivadas al final, cada grupo en su orden", () => {
    const list = [
      zone({ id: "a", archived: true }),
      zone({ id: "b" }),
      zone({ id: "c", archived: true }),
      zone({ id: "d", isActive: false }),
    ];
    expect(sortZones(list).map((z) => z.id)).toEqual(["b", "d", "a", "c"]);
  });
});

describe("zoneArchiveImpact", () => {
  const z1 = zone({ id: "z1" });
  const z2 = zone({ id: "z2" });
  it("cuenta solo las tarifas ACTIVAS no archivadas limitadas a esa zona", () => {
    const rates = [
      rate({ id: "1", zoneId: "z1" }),
      rate({ id: "2", zoneId: "z1" }),
      rate({ id: "3", zoneId: "z1", isActive: false }),
      rate({ id: "4", zoneId: "z1", archived: true }),
      rate({ id: "5", zoneId: "z2" }),
      rate({ id: "6", zoneId: null }),
    ];
    expect(zoneArchiveImpact(z1, [z1, z2], rates).rules).toBe(2);
  });
  it("lastCoverage solo si es la única zona con servicio vigente", () => {
    expect(zoneArchiveImpact(z1, [z1], []).lastCoverage).toBe(true);
    expect(zoneArchiveImpact(z1, [z1, z2], []).lastCoverage).toBe(false);
    // Las demás no dan servicio: sigue siendo la última.
    const blocked = zone({ id: "z3", allowed: false });
    const archived = zone({ id: "z4", archived: true });
    expect(zoneArchiveImpact(z1, [z1, blocked, archived], []).lastCoverage).toBe(true);
    // Esta misma no da servicio: archivarla no quita cobertura.
    expect(zoneArchiveImpact(blocked, [z1, blocked], []).lastCoverage).toBe(false);
  });
});

describe("initialZoneValues", () => {
  it("al crear: zona de ciudades, activa, con servicio y sin datos", () => {
    expect(initialZoneValues(null)).toEqual({
      name: "",
      kind: "city",
      cities: [],
      center: { lat: "", lng: "" },
      radius: "",
      noService: false,
      isActive: true,
    });
  });
  it("al editar: copia los datos (la lista de ciudades es una copia)", () => {
    const z = zone({ cities: ["La Paz", "El Alto"], allowed: false, isActive: false });
    const v = initialZoneValues(z);
    expect(v).toMatchObject({
      name: "Centro",
      kind: "city",
      cities: ["La Paz", "El Alto"],
      noService: true,
      isActive: false,
    });
    expect(v.cities).not.toBe(z.cities);
  });
  it("una zona de radio trae centro y radio como texto", () => {
    const v = initialZoneValues(
      zone({ kind: "radius", cities: null, centerLat: -16.5, centerLng: -68.15, radiusKm: 7.5 }),
    );
    expect(v).toMatchObject({
      kind: "radius",
      center: { lat: "-16.5", lng: "-68.15" },
      radius: "7.5",
    });
  });
});

describe("validateZone", () => {
  const values = (over: Partial<ZoneFormValues> = {}): ZoneFormValues => ({
    name: "Centro",
    kind: "city",
    cities: ["La Paz", "El Alto"],
    center: { lat: "", lng: "" },
    radius: "",
    noService: false,
    isActive: true,
    ...over,
  });
  const radius = (over: Partial<ZoneFormValues> = {}) =>
    values({
      kind: "radius",
      cities: [],
      center: { lat: "-16,5", lng: "-68.15" },
      radius: "7,5",
      ...over,
    });

  it("zona de ciudades: la forma exacta de ZoneCreateInput (sin centro ni radio)", () => {
    expect(validateZone(values({ name: "  Centro  " }))).toEqual({
      ok: true,
      payload: {
        name: "Centro",
        kind: "city",
        cities: ["La Paz", "El Alto"],
        centerLat: null,
        centerLng: null,
        radiusKm: null,
        allowed: true,
        isActive: true,
      },
    });
  });
  it("zona de radio: coma decimal en el radio y en el centro, sin ciudades; «sin servicio» guarda allowed=false", () => {
    expect(validateZone(radius({ noService: true, isActive: false }))).toEqual({
      ok: true,
      payload: {
        name: "Centro",
        kind: "radius",
        cities: null,
        centerLat: -16.5,
        centerLng: -68.15,
        radiusKm: 7.5,
        allowed: false,
        isActive: false,
      },
    });
  });
  it("las ciudades escritas en una zona de radio no se envían (y al revés)", () => {
    const r = validateZone(radius({ cities: ["La Paz"] }));
    expect(r.ok && r.payload.cities).toBeNull();
    const c = validateZone(values({ center: { lat: "-16", lng: "-68" }, radius: "5" }));
    expect(c.ok && [c.payload.centerLat, c.payload.centerLng, c.payload.radiusKm]).toEqual([
      null,
      null,
      null,
    ]);
  });
  it("nombre: obligatorio y hasta 80 caracteres (80 sí)", () => {
    expect(validateZone(values({ name: "   " }))).toEqual({
      ok: false,
      errors: { name: "required" },
    });
    expect(validateZone(values({ name: "a".repeat(81) }))).toEqual({
      ok: false,
      errors: { name: "too_long" },
    });
    expect(validateZone(values({ name: "a".repeat(80) })).ok).toBe(true);
  });
  it("ciudades: al menos una y hasta 200", () => {
    expect(validateZone(values({ cities: [] }))).toEqual({ ok: false, errors: { cities: "none" } });
    const many = Array.from({ length: 201 }, (_, i) => `c${i}`);
    expect(validateZone(values({ cities: many }))).toEqual({
      ok: false,
      errors: { cities: "too_many" },
    });
    expect(validateZone(values({ cities: many.slice(0, 200) })).ok).toBe(true);
  });
  it("radio: cada problema y sus bordes (20000 sí, 20000,01 no; 0 no)", () => {
    expect(validateZone(radius({ radius: "" }))).toEqual({
      ok: false,
      errors: { radius: "required" },
    });
    expect(validateZone(radius({ radius: "0" }))).toEqual({
      ok: false,
      errors: { radius: "not_positive" },
    });
    expect(validateZone(radius({ radius: "20000,01" }))).toEqual({
      ok: false,
      errors: { radius: "too_big" },
    });
    expect(validateZone(radius({ radius: "20000" })).ok).toBe(true);
    expect(validateZone(radius({ radius: "1,234" }))).toEqual({
      ok: false,
      errors: { radius: "decimals" },
    });
  });
  it("centro: sin centro, a medias, mal escrito o fuera de rango", () => {
    expect(validateZone(radius({ center: { lat: "", lng: "" } }))).toEqual({
      ok: false,
      errors: { center: "required" },
    });
    expect(validateZone(radius({ center: { lat: "-16", lng: "" } }))).toEqual({
      ok: false,
      errors: { lng: "missing" },
    });
    expect(validateZone(radius({ center: { lat: "abc", lng: "-68" } }))).toEqual({
      ok: false,
      errors: { lat: "format" },
    });
    expect(validateZone(radius({ center: { lat: "91", lng: "181" } }))).toEqual({
      ok: false,
      errors: { lat: "range", lng: "range" },
    });
    expect(validateZone(radius({ center: { lat: "90", lng: "-180" } })).ok).toBe(true);
  });
  it("junta todos los problemas a la vez", () => {
    expect(validateZone(radius({ name: "", radius: "x", center: { lat: "", lng: "" } }))).toEqual({
      ok: false,
      errors: { name: "required", radius: "number", center: "required" },
    });
  });
});

describe("toZoneUpdateInput", () => {
  it("quita el tipo: no se cambia después de crear la zona", () => {
    const created = validateZone({
      name: "Sur",
      kind: "radius",
      cities: [],
      center: { lat: "-16.5", lng: "-68.1" },
      radius: "3",
      noService: false,
      isActive: true,
    });
    if (!created.ok) throw new Error("debía ser válido");
    const update = toZoneUpdateInput(created.payload);
    expect(update).toEqual({
      name: "Sur",
      cities: null,
      centerLat: -16.5,
      centerLng: -68.1,
      radiusKm: 3,
      allowed: true,
      isActive: true,
    });
    expect("kind" in update).toBe(false);
  });
});
