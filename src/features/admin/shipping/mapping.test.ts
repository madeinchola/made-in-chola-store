import { describe, expect, it } from "vitest";
import {
  fromBlockedRow,
  fromLocationRow,
  fromMethodRow,
  fromRateRow,
  fromSlotRow,
  fromZoneRow,
  hhmm,
  paramsFromJson,
  paramsToJson,
  toLocationRow,
  toMethodInsert,
  toMethodUpdate,
  toRateInsert,
  toSlotInsert,
  toZoneInsert,
} from "./mapping";

describe("paramsFromJson / paramsToJson", () => {
  it("una regla plana", () => {
    expect(paramsFromJson("flat", { cost: 80 })).toEqual({ kind: "flat", cost: 80 });
    expect(paramsToJson({ kind: "flat", cost: 80 })).toEqual({ cost: 80 });
  });
  it("una regla por distancia, con y sin opcionales", () => {
    const json = {
      tiers: [
        { up_to_km: 3, cost: 15 },
        { up_to_km: 6, cost: 20 },
      ],
      extra_per_km: 3,
      min_cost: 15,
      max_cost: 60,
    };
    const parsed = paramsFromJson("distance", json);
    expect(parsed).toEqual({
      kind: "distance",
      tiers: [
        { upToKm: 3, cost: 15 },
        { upToKm: 6, cost: 20 },
      ],
      extraPerKm: 3,
      minCost: 15,
      maxCost: 60,
    });
    expect(paramsToJson(parsed!)).toEqual(json);
    const bare = paramsFromJson("distance", { tiers: [{ up_to_km: 1, cost: 5 }] });
    expect(bare).toMatchObject({ extraPerKm: null, minCost: null, maxCost: null });
    // SIN claves vacías: la base rechaza las desconocidas y los null no son números
    expect(paramsToJson(bare!)).toEqual({ tiers: [{ up_to_km: 1, cost: 5 }] });
  });
  it("lo que no tiene la forma de su tipo da null (no se inventa nada)", () => {
    for (const [kind, json] of [
      ["flat", null],
      ["flat", []],
      ["flat", { cost: "80" }],
      ["flat", {}],
      ["distance", { tiers: "x" }],
      ["distance", { tiers: [{ up_to_km: "3", cost: 1 }] }],
      ["distance", { tiers: [null] }],
      ["otro", { cost: 1 }],
    ] as const) {
      expect(paramsFromJson(kind, json), JSON.stringify([kind, json])).toBeNull();
    }
  });
});

describe("hhmm", () => {
  it("recorta los segundos", () => {
    expect(hhmm("10:00:00")).toBe("10:00");
    expect(hhmm("09:30")).toBe("09:30");
  });
});

const meta = { created_at: "2026-11-06T00:00:00Z", updated_at: "2026-11-06T01:00:00.123456+00:00" };

describe("filas ↔ dominio", () => {
  it("ubicación: nombres, archivado y recorte de textos al escribir", () => {
    const loc = fromLocationRow({
      id: "l1",
      name: "Taller",
      address_text: "Calle 1",
      city: "La Paz",
      lat: -16.5,
      lng: -68.15,
      pickup_hours: null,
      is_primary: true,
      is_active: true,
      archived_at: null,
      ...meta,
    });
    expect(loc).toMatchObject({
      id: "l1",
      addressText: "Calle 1",
      isPrimary: true,
      archived: false,
      updatedAt: meta.updated_at,
    });
    expect(
      fromLocationRow({
        ...{
          id: "l1",
          name: "T",
          address_text: "C",
          city: "L",
          lat: 0,
          lng: 0,
          pickup_hours: null,
          is_primary: false,
          is_active: true,
        },
        archived_at: "2026-11-01T00:00:00Z",
        ...meta,
      }).archived,
    ).toBe(true);
    expect(
      toLocationRow({
        name: "  Taller ",
        addressText: " Calle 1 ",
        city: " La Paz ",
        lat: -16.5,
        lng: -68.15,
        pickupHours: "   ",
        isActive: true,
      }),
    ).toEqual({
      name: "Taller",
      address_text: "Calle 1",
      city: "La Paz",
      lat: -16.5,
      lng: -68.15,
      pickup_hours: null,
      is_active: true,
    });
    expect(
      Object.keys(
        toLocationRow({
          name: "a",
          addressText: "b",
          city: "c",
          lat: 0,
          lng: 0,
          pickupHours: null,
          isActive: true,
        }),
      ),
    ).not.toContain("is_primary");
  });
  it("método: un tipo desconocido cae en «delivery»; crear lleva código y tipo, editar no", () => {
    const row = {
      id: "m1",
      code: "delivery",
      name: "Domicilio",
      kind: "raro",
      description: null,
      eta_min_days: 1,
      eta_max_days: 3,
      pickup_location_id: null,
      is_active: true,
      sort_order: 2,
      archived_at: null,
      ...meta,
    };
    expect(fromMethodRow(row)).toMatchObject({ kind: "delivery", etaMinDays: 1, sortOrder: 2 });
    expect(fromMethodRow({ ...row, kind: "pickup" }).kind).toBe("pickup");
    const input = {
      name: " Recojo ",
      description: "  ",
      etaMinDays: 0,
      etaMaxDays: 1,
      pickupLocationId: "l1",
      isActive: true,
      sortOrder: 0,
    };
    expect(toMethodUpdate(input)).toEqual({
      name: "Recojo",
      description: null,
      eta_min_days: 0,
      eta_max_days: 1,
      pickup_location_id: "l1",
      is_active: true,
      sort_order: 0,
    });
    expect(toMethodInsert({ ...input, code: " recojo ", kind: "pickup" })).toMatchObject({
      code: "recojo",
      kind: "pickup",
    });
    expect(Object.keys(toMethodUpdate(input))).not.toContain("code");
  });
  it("zona: ciudades o radio; el tipo solo va al crear", () => {
    const row = {
      id: "z1",
      name: "Otras",
      kind: "city",
      cities: ["Cochabamba"],
      center_lat: null,
      center_lng: null,
      radius_km: null,
      allowed: true,
      is_active: true,
      archived_at: null,
      ...meta,
    };
    expect(fromZoneRow(row)).toMatchObject({ kind: "city", cities: ["Cochabamba"], allowed: true });
    expect(
      fromZoneRow({
        ...row,
        kind: "radius",
        cities: null,
        center_lat: -16.5,
        center_lng: -68.15,
        radius_km: 25,
      }),
    ).toMatchObject({ kind: "radius", radiusKm: 25, centerLat: -16.5 });
    expect(
      toZoneInsert({
        name: " A ",
        kind: "radius",
        cities: null,
        centerLat: -16.5,
        centerLng: -68.15,
        radiusKm: 25,
        allowed: false,
        isActive: true,
      }),
    ).toEqual({
      name: "A",
      kind: "radius",
      cities: null,
      center_lat: -16.5,
      center_lng: -68.15,
      radius_km: 25,
      allowed: false,
      is_active: true,
    });
  });
  it("regla: lee sus parámetros y al crear manda el tipo que dicen los parámetros", () => {
    const row = {
      id: "r1",
      method_id: "m1",
      zone_id: null,
      name: "Plana",
      kind: "flat",
      params: { cost: 80 },
      min_order_amount: null,
      max_order_amount: 500,
      currency: "BOB",
      priority: 50,
      is_active: true,
      valid_from: null,
      valid_until: null,
      archived_at: null,
      ...meta,
    };
    expect(fromRateRow(row)).toMatchObject({
      kind: "flat",
      params: { kind: "flat", cost: 80 },
      maxOrderAmount: 500,
      priority: 50,
    });
    expect(fromRateRow({ ...row, params: { raro: true } }).params).toBeNull();
    const insert = toRateInsert({
      methodId: "m1",
      zoneId: "z1",
      name: " Plana ",
      params: { kind: "flat", cost: 80 },
      minOrderAmount: null,
      maxOrderAmount: null,
      currency: "BOB",
      priority: 50,
      isActive: true,
      validFrom: null,
      validUntil: null,
    });
    expect(insert).toMatchObject({
      method_id: "m1",
      kind: "flat",
      currency: "BOB",
      params: { cost: 80 },
      name: "Plana",
    });
  });
  it("franja y fecha bloqueada", () => {
    const slot = fromSlotRow({
      id: "s1",
      method_id: "m1",
      weekday: 2,
      start_time: "10:00:00",
      end_time: "12:30:00",
      capacity: 3,
      is_active: true,
      archived_at: null,
      ...meta,
    });
    expect(slot).toMatchObject({ weekday: 2, startTime: "10:00", endTime: "12:30", capacity: 3 });
    expect(
      toSlotInsert({
        methodId: "m1",
        weekday: 2,
        startTime: "10:00",
        endTime: "12:30",
        capacity: 3,
        isActive: true,
      }),
    ).toEqual({
      method_id: "m1",
      weekday: 2,
      start_time: "10:00",
      end_time: "12:30",
      capacity: 3,
      is_active: true,
    });
    expect(
      fromBlockedRow({
        id: "b1",
        blocked_on: "2026-12-25",
        reason: "Navidad",
        archived_at: null,
        ...meta,
      }),
    ).toEqual({
      id: "b1",
      blockedOn: "2026-12-25",
      reason: "Navidad",
      archived: false,
      updatedAt: meta.updated_at,
    });
  });
});
