import { describe, expect, it } from "vitest";
import type { Address } from "@/features/account/addresses/types";
import {
  addressHasPin,
  checkPinForm,
  destinationFromAddress,
  reconcileDestination,
  sameDestination,
  sameSchedule,
  shippingAddresses,
  type Destination,
} from "./destination";

const address = (id: string, extra: Partial<Address> = {}): Address => ({
  id,
  profileId: "user-1",
  label: `Dirección ${id}`,
  recipient: "Ana",
  phone: "+59171234567",
  line1: "Av. Arce 123",
  line2: null,
  city: "La Paz",
  department: "La Paz",
  country: "BO",
  referenceText: null,
  lat: -16.5,
  lng: -68.15,
  isDefault: false,
  forShipping: true,
  forBilling: false,
  archivedAt: null,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
  ...extra,
});

describe("destinationFromAddress", () => {
  it("una dirección con pin es un destino (con su nombre y su id)", () => {
    expect(destinationFromAddress(address("a", { label: "Casa", city: "  El Alto " }))).toEqual({
      lat: -16.5,
      lng: -68.15,
      city: "El Alto",
      label: "Casa",
      addressId: "a",
    });
  });
  it("sin pin NO es un destino (hay que ubicarla en el mapa)", () => {
    expect(destinationFromAddress(address("a", { lat: null, lng: null }))).toBeNull();
    expect(destinationFromAddress(address("a", { lat: -16.5, lng: null }))).toBeNull();
    expect(destinationFromAddress(address("a", { lat: null, lng: -68.1 }))).toBeNull();
  });
  it("un pin en 0,0 SÍ es un pin (cero no es «vacío»)", () => {
    expect(destinationFromAddress(address("a", { lat: 0, lng: 0 }))).toMatchObject({
      lat: 0,
      lng: 0,
    });
  });
});

describe("addressHasPin / shippingAddresses", () => {
  it("el pin es todo o nada", () => {
    expect(addressHasPin({ lat: 1, lng: 2 })).toBe(true);
    expect(addressHasPin({ lat: 0, lng: 0 })).toBe(true);
    expect(addressHasPin({ lat: null, lng: null })).toBe(false);
    expect(addressHasPin({ lat: 1, lng: null })).toBe(false);
  });
  it("solo sirven las direcciones de envío (una solo de facturación no es un destino)", () => {
    const list = [
      address("a"),
      address("b", { forShipping: false, forBilling: true }),
      address("c"),
    ];
    expect(shippingAddresses(list).map((a) => a.id)).toEqual(["a", "c"]);
  });
});

describe("sameDestination / sameSchedule", () => {
  const d: Destination = { lat: 1, lng: 2, city: "X", label: null, addressId: null };
  it("compara por valor, campo a campo", () => {
    expect(sameDestination(d, { ...d })).toBe(true);
    expect(sameDestination(null, null)).toBe(true);
    expect(sameDestination(d, null)).toBe(false);
    expect(sameDestination(null, d)).toBe(false);
    for (const change of [
      { lat: 9 },
      { lng: 9 },
      { city: "Y" },
      { label: "Casa" },
      { addressId: "a" },
    ]) {
      expect(sameDestination(d, { ...d, ...change })).toBe(false);
    }
  });
  it("la franja: misma fecha Y mismo id", () => {
    const s = { date: "2026-11-09", slotId: "a" };
    expect(sameSchedule(s, { ...s })).toBe(true);
    expect(sameSchedule(null, null)).toBe(true);
    expect(sameSchedule(s, null)).toBe(false);
    expect(sameSchedule(s, { ...s, date: "2026-11-10" })).toBe(false);
    expect(sameSchedule(s, { ...s, slotId: "b" })).toBe(false);
  });
});

describe("reconcileDestination · la libreta manda", () => {
  const saved: Destination = {
    lat: -16.5,
    lng: -68.15,
    city: "La Paz",
    label: "Dirección a",
    addressId: "a",
  };

  it("sin destino, o con uno marcado a mano, no se toca (mismo objeto)", () => {
    const manual: Destination = { ...saved, addressId: null, label: null };
    expect(reconcileDestination(null, [address("a")])).toBeNull();
    expect(reconcileDestination(manual, [])).toBe(manual);
  });

  it("sin cambios devuelve el MISMO objeto (para no repintar en bucle)", () => {
    expect(reconcileDestination(saved, [address("a")])).toBe(saved);
  });

  it("la dirección ya no existe (la archivó en otra pestaña) → se descarta", () => {
    expect(reconcileDestination(saved, [address("b")])).toBeNull();
    expect(reconcileDestination(saved, [])).toBeNull();
  });

  it("la dirección ya no es de envío → se descarta", () => {
    expect(reconcileDestination(saved, [address("a", { forShipping: false })])).toBeNull();
  });

  it("cambió de lugar o de ciudad → se toma lo nuevo", () => {
    expect(reconcileDestination(saved, [address("a", { lat: -17.4, lng: -66.1 })])).toEqual({
      ...saved,
      lat: -17.4,
      lng: -66.1,
    });
    expect(reconcileDestination(saved, [address("a", { city: "Cochabamba" })])).toEqual({
      ...saved,
      city: "Cochabamba",
    });
  });

  it("una dirección SIN pin conserva el punto marcado a mano, con el nombre y la ciudad al día", () => {
    const located: Destination = { ...saved, lat: -16.6, lng: -68.2 };
    expect(reconcileDestination(located, [address("a", { lat: null, lng: null })])).toBe(located);
    expect(
      reconcileDestination(located, [
        address("a", { lat: null, lng: null, label: "Oficina", city: "El Alto" }),
      ]),
    ).toEqual({ ...located, label: "Oficina", city: "El Alto" });
  });
});

describe("checkPinForm · el formulario del mapa", () => {
  it("pin completo y ciudad: válido (coma decimal incluida; la ciudad sin espacios sobrantes)", () => {
    expect(checkPinForm({ pin: { lat: "-16,5", lng: " -68.15 " }, city: "  La Paz " })).toEqual({
      ok: true,
      lat: -16.5,
      lng: -68.15,
      city: "La Paz",
    });
  });

  it("sin pin: lo dice (y sin ciudad, también)", () => {
    expect(checkPinForm({ pin: { lat: "", lng: "" }, city: "" })).toEqual({
      ok: false,
      pin: "none",
      lat: null,
      lng: null,
      city: true,
    });
  });

  it("pin bueno pero sin ciudad: solo falla la ciudad (un espacio no cuenta)", () => {
    expect(checkPinForm({ pin: { lat: "-16.5", lng: "-68.15" }, city: "   " })).toEqual({
      ok: false,
      pin: null,
      lat: null,
      lng: null,
      city: true,
    });
  });

  it("pin a medias o mal escrito: dice qué eje y por qué", () => {
    expect(checkPinForm({ pin: { lat: "-16.5", lng: "" }, city: "La Paz" })).toEqual({
      ok: false,
      pin: "invalid",
      lat: null,
      lng: "missing",
      city: false,
    });
    expect(checkPinForm({ pin: { lat: "abc", lng: "200" }, city: "La Paz" })).toMatchObject({
      ok: false,
      pin: "invalid",
      lat: "format",
      lng: "range",
    });
  });
});
