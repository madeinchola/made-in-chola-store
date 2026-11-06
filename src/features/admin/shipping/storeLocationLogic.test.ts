import { describe, expect, it } from "vitest";
import {
  archivedLast,
  canBecomeOrigin,
  currentOrigin,
  emptyLocationValues,
  hasOriginCandidate,
  hasUsableOrigin,
  locationStatus,
  locationToValues,
  pickupMethodsUsing,
  validateLocation,
  type LocationFormValues,
} from "./storeLocationLogic";
import type { ShippingMethod, StoreLocation } from "./types";

const values = (over: Partial<LocationFormValues> = {}): LocationFormValues => ({
  name: "Taller Sopocachi",
  addressText: "Av. Sánchez Lima 2345",
  city: "La Paz",
  pickupHours: "Lun–Vie 10:00–18:00",
  lat: "-16.5",
  lng: "-68.15",
  isActive: true,
  ...over,
});

const location = (over: Partial<StoreLocation> = {}): StoreLocation => ({
  id: "l1",
  name: "Casa central",
  addressText: "Calle 1",
  city: "La Paz",
  lat: -16.5,
  lng: -68.15,
  pickupHours: null,
  isPrimary: false,
  isActive: true,
  archived: false,
  updatedAt: "2026-11-01T10:00:00.123456+00:00",
  ...over,
});

const method = (over: Partial<ShippingMethod> = {}): ShippingMethod => ({
  id: "m1",
  code: "recojo",
  name: "Recojo",
  kind: "pickup",
  description: null,
  etaMinDays: null,
  etaMaxDays: null,
  pickupLocationId: "l1",
  isActive: true,
  sortOrder: 0,
  archived: false,
  updatedAt: "2026-11-01T10:00:00+00:00",
  ...over,
});

const errorsOf = (v: LocationFormValues) => {
  const r = validateLocation(v);
  if (r.ok) throw new Error("se esperaba un error de validación");
  return r.errors;
};

describe("validateLocation: lo que se envía", () => {
  it("un formulario válido produce exactamente el LocationInput (texto recortado, números, horario)", () => {
    const r = validateLocation(
      values({
        name: "  Taller  ",
        addressText: " Calle 5 ",
        city: " La Paz ",
        pickupHours: " 9–5 ",
      }),
    );
    expect(r).toEqual({
      ok: true,
      input: {
        name: "Taller",
        addressText: "Calle 5",
        city: "La Paz",
        lat: -16.5,
        lng: -68.15,
        pickupHours: "9–5",
        isActive: true,
      },
    });
  });

  it("el horario vacío o de solo espacios se envía como null", () => {
    for (const hours of ["", "   "]) {
      const r = validateLocation(values({ pickupHours: hours }));
      expect(r.ok && r.input.pickupHours).toBeNull();
    }
  });

  it("la coma decimal se acepta y las coordenadas se redondean a 6 decimales", () => {
    const r = validateLocation(values({ lat: "-16,5", lng: "-68.12345678" }));
    expect(r.ok && [r.input.lat, r.input.lng]).toEqual([-16.5, -68.123457]);
  });

  it("isActive se respeta tal cual", () => {
    const r = validateLocation(values({ isActive: false }));
    expect(r.ok && r.input.isActive).toBe(false);
  });
});

describe("validateLocation: nombre, dirección, ciudad y horario", () => {
  it("nombre, dirección y ciudad son obligatorios (también si solo hay espacios)", () => {
    expect(errorsOf(values({ name: "   ", addressText: "", city: "\t" }))).toEqual({
      name: "Escribe el nombre de la ubicación.",
      addressText: "Escribe la dirección.",
      city: "Escribe la ciudad.",
    });
  });

  it("el nombre admite 80 caracteres y no 81", () => {
    expect(validateLocation(values({ name: "a".repeat(80) })).ok).toBe(true);
    expect(errorsOf(values({ name: "a".repeat(81) })).name).toBe(
      "El nombre admite hasta 80 caracteres.",
    );
  });

  it("la dirección admite 200 caracteres y no 201", () => {
    expect(validateLocation(values({ addressText: "a".repeat(200) })).ok).toBe(true);
    expect(errorsOf(values({ addressText: "a".repeat(201) })).addressText).toBe(
      "La dirección admite hasta 200 caracteres.",
    );
  });

  it("la ciudad admite 80 caracteres y no 81", () => {
    expect(validateLocation(values({ city: "a".repeat(80) })).ok).toBe(true);
    expect(errorsOf(values({ city: "a".repeat(81) })).city).toBe(
      "La ciudad admite hasta 80 caracteres.",
    );
  });

  it("el horario admite 300 caracteres y no 301", () => {
    expect(validateLocation(values({ pickupHours: "a".repeat(300) })).ok).toBe(true);
    expect(errorsOf(values({ pickupHours: "a".repeat(301) })).pickupHours).toBe(
      "El horario admite hasta 300 caracteres.",
    );
  });

  it("se cuentan caracteres, no unidades UTF-16 (como char_length de Postgres): 80 emojis caben", () => {
    expect(validateLocation(values({ name: "😀".repeat(80) })).ok).toBe(true);
    expect(validateLocation(values({ name: "😀".repeat(81) })).ok).toBe(false);
  });

  it("el largo se mide DESPUÉS de recortar: 80 letras con espacios alrededor caben", () => {
    expect(validateLocation(values({ name: ` ${"a".repeat(80)} ` })).ok).toBe(true);
  });
});

describe("validateLocation: el pin es obligatorio", () => {
  it("sin latitud ni longitud: falta cada una, con su mensaje", () => {
    expect(errorsOf(values({ lat: "", lng: "" }))).toEqual({
      lat: "Falta la latitud: elige el punto en el mapa o escríbela.",
      lng: "Falta la longitud: elige el punto en el mapa o escríbela.",
    });
  });

  it("pin a medias: el error va SOLO en el campo que falta", () => {
    expect(errorsOf(values({ lat: "-16.5", lng: "" }))).toEqual({
      lng: "Falta la longitud: elige el punto en el mapa o escríbela.",
    });
    expect(errorsOf(values({ lat: "  ", lng: "-68.1" }))).toEqual({
      lat: "Falta la latitud: elige el punto en el mapa o escríbela.",
    });
  });

  it("un texto que no es número se rechaza con su mensaje", () => {
    expect(errorsOf(values({ lat: "norte", lng: "1e2" }))).toEqual({
      lat: "La latitud debe ser un número, por ejemplo -16.5.",
      lng: "La longitud debe ser un número, por ejemplo -68.15.",
    });
  });

  it("latitud: -90 y 90 valen; 90.000001 y -91 no", () => {
    expect(validateLocation(values({ lat: "90" })).ok).toBe(true);
    expect(validateLocation(values({ lat: "-90" })).ok).toBe(true);
    expect(errorsOf(values({ lat: "90.000001" })).lat).toBe(
      "La latitud debe estar entre -90 y 90.",
    );
    expect(errorsOf(values({ lat: "-91" })).lat).toBe("La latitud debe estar entre -90 y 90.");
  });

  it("longitud: -180 y 180 valen; 180.5 y -181 no", () => {
    expect(validateLocation(values({ lng: "180" })).ok).toBe(true);
    expect(validateLocation(values({ lng: "-180" })).ok).toBe(true);
    expect(errorsOf(values({ lng: "180.5" })).lng).toBe("La longitud debe estar entre -180 y 180.");
    expect(errorsOf(values({ lng: "-181" })).lng).toBe("La longitud debe estar entre -180 y 180.");
  });

  it("latitud y longitud cuentan cada una con su propio límite (la longitud 100 es válida, la latitud 100 no)", () => {
    expect(validateLocation(values({ lat: "10", lng: "100" })).ok).toBe(true);
    expect(errorsOf(values({ lat: "100", lng: "10" })).lat).toBe(
      "La latitud debe estar entre -90 y 90.",
    );
  });

  it("junta TODOS los errores a la vez (no solo el primero)", () => {
    expect(Object.keys(errorsOf(emptyLocationValues())).sort()).toEqual([
      "addressText",
      "city",
      "lat",
      "lng",
      "name",
    ]);
  });
});

describe("locationToValues / emptyLocationValues", () => {
  it("una ubicación nueva empieza vacía y activa", () => {
    expect(locationToValues(null)).toEqual({
      name: "",
      addressText: "",
      city: "",
      pickupHours: "",
      lat: "",
      lng: "",
      isActive: true,
    });
  });

  it("al editar trae los datos (horario null = vacío, coordenadas como texto)", () => {
    expect(
      locationToValues(
        location({ name: "Taller", pickupHours: null, lat: -16.5, lng: -68.123457 }),
      ),
    ).toEqual({
      name: "Taller",
      addressText: "Calle 1",
      city: "La Paz",
      pickupHours: "",
      lat: "-16.5",
      lng: "-68.123457",
      isActive: true,
    });
  });

  it("abrir y guardar sin tocar nada produce el mismo dato (ida y vuelta)", () => {
    const l = location({ pickupHours: "Lun–Vie", isActive: false });
    const r = validateLocation(locationToValues(l));
    expect(r).toEqual({
      ok: true,
      input: {
        name: "Casa central",
        addressText: "Calle 1",
        city: "La Paz",
        lat: -16.5,
        lng: -68.15,
        pickupHours: "Lun–Vie",
        isActive: false,
      },
    });
  });
});

describe("estado y origen", () => {
  it("locationStatus: archivada gana sobre inactiva", () => {
    expect(locationStatus({ archived: true, isActive: false })).toBe("archived");
    expect(locationStatus({ archived: true, isActive: true })).toBe("archived");
    expect(locationStatus({ archived: false, isActive: false })).toBe("inactive");
    expect(locationStatus({ archived: false, isActive: true })).toBe("active");
  });

  it("hasUsableOrigin: solo una principal ACTIVA y sin archivar sirve", () => {
    expect(hasUsableOrigin([])).toBe(false);
    expect(hasUsableOrigin([location()])).toBe(false);
    expect(hasUsableOrigin([location({ isPrimary: true })])).toBe(true);
    expect(hasUsableOrigin([location({ isPrimary: true, isActive: false })])).toBe(false);
    expect(hasUsableOrigin([location({ isPrimary: true, archived: true })])).toBe(false);
  });

  it("canBecomeOrigin: activa, sin archivar y que todavía no es el origen", () => {
    expect(canBecomeOrigin(location())).toBe(true);
    expect(canBecomeOrigin(location({ isPrimary: true }))).toBe(false);
    expect(canBecomeOrigin(location({ isActive: false }))).toBe(false);
    expect(canBecomeOrigin(location({ archived: true }))).toBe(false);
  });

  it("hasOriginCandidate: hay al menos una que podría serlo", () => {
    expect(hasOriginCandidate([])).toBe(false);
    expect(hasOriginCandidate([location({ isActive: false }), location({ archived: true })])).toBe(
      false,
    );
    expect(hasOriginCandidate([location({ isActive: false }), location({ id: "l2" })])).toBe(true);
    expect(hasOriginCandidate([location({ isPrimary: true })])).toBe(false);
  });

  it("currentOrigin devuelve la principal o null", () => {
    expect(currentOrigin([location(), location({ id: "l2" })])).toBeNull();
    expect(currentOrigin([location(), location({ id: "l2", isPrimary: true })])?.id).toBe("l2");
  });
});

describe("pickupMethodsUsing", () => {
  it("devuelve los métodos de recojo SIN archivar que apuntan a esa ubicación", () => {
    const methods = [
      method({ id: "a" }),
      method({ id: "b", pickupLocationId: "otra" }),
      method({ id: "c", archived: true }),
      method({ id: "d", kind: "delivery", pickupLocationId: null }),
      method({ id: "e", isActive: false }),
    ];
    expect(pickupMethodsUsing("l1", methods).map((m) => m.id)).toEqual(["a", "e"]);
  });
});

describe("archivedLast", () => {
  it("manda las archivadas al final y respeta el orden del resto", () => {
    const rows = [
      { id: "1", archived: true },
      { id: "2", archived: false },
      { id: "3", archived: true },
      { id: "4", archived: false },
    ];
    expect(archivedLast(rows).map((r) => r.id)).toEqual(["2", "4", "1", "3"]);
  });
  it("no modifica la lista original", () => {
    const rows = [
      { id: "1", archived: true },
      { id: "2", archived: false },
    ];
    archivedLast(rows);
    expect(rows.map((r) => r.id)).toEqual(["1", "2"]);
  });
});
