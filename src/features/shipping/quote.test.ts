import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { resolveMessage } from "@/i18n";
// El SQL y el TypeScript se escriben a mano en dos lugares: esta prueba lee la migración y falla si se desalinean.
import migration from "../../../supabase/migrations/20261106000100_s8_envios.sql?raw";
import { parseQuote, quoteArgs } from "./quote";
import { SHIPPING_ERROR_CODES, SHIPPING_ERROR_FIELDS } from "./types";

const okRaw = (over: Record<string, unknown> = {}) => ({
  ok: true,
  cost: 15,
  currency: "BOB",
  method: {
    code: "delivery",
    name: "Entrega a domicilio",
    kind: "delivery",
    description: null,
    eta_min_days: 1,
    eta_max_days: 3,
  },
  distance_km: 2.89,
  breakdown: {
    rule: { id: "r1", name: "Tramos", kind: "distance", priority: 100 },
    straight_km: 2.22,
    route_km: 2.89,
    route_factor: 1.3,
    tier: 1,
    extra_km: null,
    min_applied: false,
    max_applied: false,
    zones: ["z"],
  },
  slots: [
    {
      slot_id: "s1",
      date: "2026-11-10",
      start: "10:00",
      end: "12:00",
      capacity: 2,
      remaining: 0,
      available: false,
    },
  ],
  selected: null,
  errors: [],
  ...over,
});

describe("contrato SQL ↔ TypeScript", () => {
  const sqlCodes = new Set([
    ...[...migration.matchAll(/jsonb_build_object\('code', '([a-z_]+)'/g)].map((m) => m[1]!),
    ...[...migration.matchAll(/return '([a-z_]+)';/g)].map((m) => m[1]!).filter((c) => c !== "ok"),
    ...[...migration.matchAll(/v_chk := '([a-z_]+)';/g)].map((m) => m[1]!),
  ]);
  it("todo código de error que emite el SQL lo conoce el cliente", () => {
    const missing = [...sqlCodes].filter(
      (c) => !(SHIPPING_ERROR_CODES as readonly string[]).includes(c),
    );
    expect(missing).toEqual([]);
  });
  it("todo código que declara el cliente lo emite el SQL (no hay códigos fantasma)", () => {
    const ghosts = SHIPPING_ERROR_CODES.filter((c) => !sqlCodes.has(c));
    expect(ghosts).toEqual([]);
  });
  it("todo código tiene su mensaje en español, y además `unknown` y `unexpected`", () => {
    for (const code of [...SHIPPING_ERROR_CODES, "unknown", "unexpected"]) {
      expect(resolveMessage(`shipping.errors.${code}`), code).toMatch(/\S/);
    }
  });
  it("los campos de error del SQL son los del cliente", () => {
    const sqlFields = new Set([...migration.matchAll(/'field', '([a-z_]+)'/g)].map((m) => m[1]!));
    for (const f of sqlFields) expect(SHIPPING_ERROR_FIELDS as readonly string[], f).toContain(f);
  });
});

describe("parseQuote", () => {
  it("lee una cotización buena y convierte los nombres a camelCase", () => {
    const q = parseQuote(okRaw());
    expect(q.ok).toBe(true);
    expect(q.cost).toBe(15);
    expect(q.distanceKm).toBe(2.89);
    expect(q.method).toEqual({
      code: "delivery",
      name: "Entrega a domicilio",
      kind: "delivery",
      description: null,
      etaMinDays: 1,
      etaMaxDays: 3,
    });
    expect(q.breakdown).toMatchObject({
      rule: { name: "Tramos", kind: "distance" },
      straightKm: 2.22,
      routeKm: 2.89,
      routeFactor: 1.3,
      tier: 1,
      minApplied: false,
    });
    expect(q.slots).toEqual([
      {
        slotId: "s1",
        date: "2026-11-10",
        start: "10:00",
        end: "12:00",
        capacity: 2,
        remaining: 0,
        available: false,
      },
    ]);
  });
  it("un error del servidor llega tipado; un código nuevo que no conoce pasa a «unknown»", () => {
    const q = parseQuote({
      ok: false,
      cost: null,
      errors: [
        { code: "out_of_coverage", field: "location" },
        { code: "codigo_futuro", field: "raro" },
      ],
    });
    expect(q.ok).toBe(false);
    expect(q.cost).toBeNull();
    expect(q.errors).toEqual([
      { code: "out_of_coverage", field: "location" },
      { code: "unknown", field: "system" },
    ]);
  });
  it("SIN ok nunca hay costo, aunque el servidor lo mandara por error", () => {
    expect(
      parseQuote({ ok: false, cost: 99, errors: [{ code: "no_rate", field: "location" }] }).cost,
    ).toBeNull();
  });
  it("rechaza (no adivina) una respuesta que contradice el contrato", () => {
    const bad: unknown[] = [
      null,
      "texto",
      [],
      {},
      { ok: "sí", errors: [] },
      { ok: true, cost: 15 }, // falta errors
      { ok: true, cost: 15, errors: [{ code: "no_rate", field: "location" }] }, // ok pero con errores
      { ok: false, cost: null, errors: [] }, // no ok y sin errores
      { ok: true, cost: null, errors: [] }, // ok sin costo
      { ok: true, cost: -1, errors: [] }, // costo negativo
      { ok: true, cost: "15", errors: [] }, // costo como texto
      { ok: true, cost: Number.NaN, errors: [] },
      okRaw({ method: { code: "x", name: "y", kind: "otro" } }),
      okRaw({
        slots: [
          {
            slot_id: "s",
            date: "10/11/2026",
            start: "10:00",
            end: "12:00",
            capacity: 1,
            remaining: 1,
            available: true,
          },
        ],
      }),
      okRaw({
        slots: [
          {
            slot_id: "s",
            date: "2026-11-10",
            start: "10:00",
            end: "12:00",
            capacity: 1,
            remaining: 1,
            available: "sí",
          },
        ],
      }),
      okRaw({ slots: "no" }),
      okRaw({ errors: [null] }),
    ];
    for (const raw of bad) expect(() => parseQuote(raw), JSON.stringify(raw)).toThrow(AppError);
  });
  it("el recojo trae su ubicación y el desglose «pickup»", () => {
    const q = parseQuote({
      ok: true,
      cost: 0,
      currency: "BOB",
      method: {
        code: "recojo",
        name: "Recojo",
        kind: "pickup",
        description: null,
        eta_min_days: 0,
        eta_max_days: 1,
      },
      pickup: {
        name: "Taller",
        address: "Calle 1",
        city: "La Paz",
        lat: -16.5,
        lng: -68.15,
        hours: null,
      },
      breakdown: { kind: "pickup" },
      slots: [],
      errors: [],
    });
    expect(q.cost).toBe(0);
    expect(q.pickup).toEqual({
      name: "Taller",
      address: "Calle 1",
      city: "La Paz",
      lat: -16.5,
      lng: -68.15,
      hours: null,
    });
    expect(q.breakdown.pickup).toBe(true);
  });
  it("una respuesta mínima de error (método inexistente) también se lee", () => {
    const q = parseQuote({
      ok: false,
      cost: null,
      errors: [{ code: "method_not_found", field: "method" }],
    });
    expect(q.method).toBeNull();
    expect(q.slots).toEqual([]);
    expect(q.breakdown.rule).toBeNull();
  });
});

describe("quoteArgs", () => {
  it("manda solo lo que se pasó (con los nombres del RPC) y deja el resto al valor por defecto del servidor", () => {
    expect(quoteArgs({})).toEqual({});
    expect(
      quoteArgs({ lat: -16.5, lng: -68.15, city: "La Paz", orderAmount: 120, listDays: 7 }),
    ).toEqual({
      p_lat: -16.5,
      p_lng: -68.15,
      p_city: "La Paz",
      p_order_amount: 120,
      p_list_days: 7,
    });
  });
  it("conserva un null explícito (por ejemplo «sin fecha») y el 0", () => {
    expect(quoteArgs({ deliveryDate: null, orderAmount: 0 })).toEqual({
      p_delivery_date: null,
      p_order_amount: 0,
    });
  });
});
