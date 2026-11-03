import { describe, expect, it } from "vitest";
import { ADDRESS_COLUMNS, fromRow, toInsertRow, toUpdatePatch, type AddressRow } from "./mapping";
import type { AddressInput } from "./types";

const row: AddressRow = {
  id: "a-1",
  profile_id: "p-1",
  label: "Casa",
  recipient: "Ana Cliente",
  phone_e164: "+59171234567",
  line1: "Calle 21 #123",
  line2: "Piso 2",
  city: "La Paz",
  department: "La Paz",
  country: "BO",
  reference_text: "Puerta verde",
  lat: -16.5,
  lng: -68.15,
  is_default: true,
  for_shipping: true,
  for_billing: false,
  archived_at: null,
  created_at: "2026-11-01T10:00:00+00:00",
  updated_at: "2026-11-02T10:00:00+00:00",
};

const input: AddressInput = {
  label: "Casa",
  recipient: "Ana Cliente",
  phoneE164: "+59171234567",
  line1: "Calle 21 #123",
  line2: null,
  city: "La Paz",
  department: "La Paz",
  country: "BO",
  referenceText: "Puerta verde",
  lat: -16.5,
  lng: -68.15,
  forShipping: true,
  forBilling: false,
  isDefault: false,
};

describe("fromRow", () => {
  it("renombra cada columna a la forma de la aplicación", () => {
    expect(fromRow(row)).toEqual({
      id: "a-1",
      profileId: "p-1",
      label: "Casa",
      recipient: "Ana Cliente",
      phone: "+59171234567",
      line1: "Calle 21 #123",
      line2: "Piso 2",
      city: "La Paz",
      department: "La Paz",
      country: "BO",
      referenceText: "Puerta verde",
      lat: -16.5,
      lng: -68.15,
      isDefault: true,
      forShipping: true,
      forBilling: false,
      archivedAt: null,
      createdAt: "2026-11-01T10:00:00+00:00",
      updatedAt: "2026-11-02T10:00:00+00:00",
    });
  });

  it("conserva los nulos y reconoce una dirección archivada", () => {
    const a = fromRow({
      ...row,
      phone_e164: null,
      line2: null,
      department: null,
      reference_text: null,
      lat: null,
      lng: null,
      archived_at: "2026-11-02T11:00:00+00:00",
      is_default: false,
    });
    expect(a).toMatchObject({
      phone: null,
      line2: null,
      department: null,
      referenceText: null,
      lat: null,
      lng: null,
      archivedAt: "2026-11-02T11:00:00+00:00",
      isDefault: false,
    });
  });

  it("las coordenadas `numeric` que llegan como texto se convierten en número", () => {
    const a = fromRow({
      ...row,
      lat: "-16.500000" as unknown as number,
      lng: "-68.150000" as unknown as number,
    });
    expect(a.lat).toBe(-16.5);
    expect(a.lng).toBe(-68.15);
  });

  it("un pin a medias o ilegible no se muestra (todo o nada)", () => {
    expect(fromRow({ ...row, lat: -16.5, lng: null })).toMatchObject({ lat: null, lng: null });
    expect(fromRow({ ...row, lat: null, lng: -68.15 })).toMatchObject({ lat: null, lng: null });
    expect(fromRow({ ...row, lat: "x" as unknown as number })).toMatchObject({
      lat: null,
      lng: null,
    });
  });

  it("una latitud o longitud 0 es un pin válido (no se confunde con «sin pin»)", () => {
    expect(fromRow({ ...row, lat: 0, lng: 0 })).toMatchObject({ lat: 0, lng: 0 });
  });
});

describe("toInsertRow", () => {
  it("lleva el dueño (profile_id), todas las columnas editables y la marca de predeterminada", () => {
    expect(toInsertRow("p-9", input)).toEqual({
      profile_id: "p-9",
      label: "Casa",
      recipient: "Ana Cliente",
      phone_e164: "+59171234567",
      line1: "Calle 21 #123",
      line2: null,
      city: "La Paz",
      department: "La Paz",
      country: "BO",
      reference_text: "Puerta verde",
      lat: -16.5,
      lng: -68.15,
      for_shipping: true,
      for_billing: false,
      is_default: false,
    });
  });

  it("envía is_default tal cual (true al pedir predeterminada)", () => {
    expect(toInsertRow("p-9", { ...input, isDefault: true }).is_default).toBe(true);
  });
});

describe("toUpdatePatch", () => {
  const EDITABLE = [
    "city",
    "country",
    "department",
    "for_billing",
    "for_shipping",
    "label",
    "lat",
    "line1",
    "line2",
    "lng",
    "phone_e164",
    "recipient",
    "reference_text",
  ];

  it("solo columnas editables: NUNCA profile_id ni archived_at, y sin is_default si no se pide", () => {
    const patch = toUpdatePatch(input);
    expect(Object.keys(patch).sort()).toEqual(EDITABLE);
    expect(patch).toMatchObject({ label: "Casa", phone_e164: "+59171234567", lat: -16.5 });
  });

  it("is_default solo viaja cuando se pide MARCAR (nunca false: dejaría al cliente sin predeterminada)", () => {
    expect(Object.keys(toUpdatePatch({ ...input, isDefault: true })).sort()).toEqual(
      [...EDITABLE, "is_default"].sort(),
    );
    expect(toUpdatePatch({ ...input, isDefault: true }).is_default).toBe(true);
    expect("is_default" in toUpdatePatch({ ...input, isDefault: false })).toBe(false);
  });

  it("quitar el pin envía lat y lng en null (ambos, para no violar «todo o nada»)", () => {
    const patch = toUpdatePatch({ ...input, lat: null, lng: null });
    expect(patch.lat).toBeNull();
    expect(patch.lng).toBeNull();
  });
});

describe("ADDRESS_COLUMNS", () => {
  it("pide exactamente las 19 columnas de la tabla, sin *", () => {
    const columns = ADDRESS_COLUMNS.split(",");
    expect(columns).toHaveLength(19);
    expect(columns).toEqual([
      "id",
      "profile_id",
      "label",
      "recipient",
      "phone_e164",
      "line1",
      "line2",
      "city",
      "department",
      "country",
      "reference_text",
      "lat",
      "lng",
      "is_default",
      "for_shipping",
      "for_billing",
      "archived_at",
      "created_at",
      "updated_at",
    ]);
  });
});
