import { describe, expect, it } from "vitest";
import {
  REDEMPTIONS_LIMIT,
  customerName,
  filterByStatus,
  formatAmount,
  ownerText,
  redemptionTotals,
  redemptionsCsv,
  shortId,
  sortByDate,
} from "./RedemptionsLogic";
import type { Redemption } from "./types";

const BOM = "﻿";

const red = (over: Partial<Redemption> = {}): Redemption => ({
  id: "r1",
  discountId: "d1",
  discountName: "Verano",
  couponId: null,
  couponCode: null,
  profileId: "p1",
  customerName: "Ana",
  customerEmail: "ana@correo.com",
  ownerType: "order",
  ownerId: "3f2a91bc-1111-2222-3333-444455556666",
  amount: 10,
  currency: "BOB",
  status: "applied",
  createdAt: "2026-11-05T12:00:00+00:00",
  ...over,
});

describe("filtros y orden", () => {
  const rows = [
    red({ id: "a", status: "reserved" }),
    red({ id: "b", status: "applied" }),
    red({ id: "c", status: "reverted" }),
    red({ id: "d", status: "applied" }),
  ];
  it("«todos» devuelve todo; un estado, solo ese", () => {
    expect(filterByStatus(rows, "all").map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
    expect(filterByStatus(rows, "applied").map((r) => r.id)).toEqual(["b", "d"]);
    expect(filterByStatus(rows, "reverted").map((r) => r.id)).toEqual(["c"]);
    expect(filterByStatus(rows, "reserved").map((r) => r.id)).toEqual(["a"]);
  });
  it("no modifica la lista original", () => {
    const copy = [...rows];
    filterByStatus(rows, "applied");
    sortByDate(rows);
    expect(rows).toEqual(copy);
  });

  const dated = [
    red({ id: "viejo", createdAt: "2026-11-01T10:00:00+00:00" }),
    red({ id: "nuevo", createdAt: "2026-11-05T10:00:00+00:00" }),
    red({ id: "medio", createdAt: "2026-11-03T10:00:00+00:00" }),
  ];
  it("por fecha descendente por defecto (lo más nuevo arriba) y ascendente si se pide", () => {
    expect(sortByDate(dated).map((r) => r.id)).toEqual(["nuevo", "medio", "viejo"]);
    expect(sortByDate(dated, "desc").map((r) => r.id)).toEqual(["nuevo", "medio", "viejo"]);
    expect(sortByDate(dated, "asc").map((r) => r.id)).toEqual(["viejo", "medio", "nuevo"]);
  });
  it("compara instantes, no texto: 09:00-04:00 (13:00 UTC) es DESPUÉS de 12:00+00:00", () => {
    const rowsWithOffsets = [
      red({ id: "utc", createdAt: "2026-11-05T12:00:00+00:00" }),
      red({ id: "lapaz", createdAt: "2026-11-05T09:00:00-04:00" }),
    ];
    expect(sortByDate(rowsWithOffsets, "desc").map((r) => r.id)).toEqual(["lapaz", "utc"]);
    expect(sortByDate(rowsWithOffsets, "asc").map((r) => r.id)).toEqual(["utc", "lapaz"]);
  });
  it("a igual fecha desempata por id (orden estable en ambos sentidos)", () => {
    const same = [red({ id: "b" }), red({ id: "a" }), red({ id: "c" })];
    expect(sortByDate(same, "desc").map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(sortByDate(same, "asc").map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});

describe("redemptionTotals: sumas exactas, sin contar los devueltos", () => {
  it("registros = todas las filas; usos vigentes = reservados + aplicados; suma sin devueltos", () => {
    const totals = redemptionTotals([
      red({ id: "1", amount: 10, status: "applied" }),
      red({ id: "2", amount: 0.1, status: "reserved" }),
      red({ id: "3", amount: 0.2, status: "applied" }),
      red({ id: "4", amount: 5, status: "reverted" }),
      red({ id: "5", amount: 3.5, currency: "USD", status: "applied" }),
    ]);
    expect(totals.records).toBe(5);
    expect(totals.active).toBe(4);
    // BOB: 10 + 0,1 + 0,2 = 10,30 (el devuelto de 5 no suma). USD: 3,50. Ordenadas por código de moneda.
    expect(totals.amounts.map((a) => [a.currency, a.text])).toEqual([
      ["BOB", "Bs 10,30"],
      ["USD", "$ 3,50"],
    ]);
  });
  it("0,1 + 0,2 es exactamente 0,30 (sin error de coma flotante)", () => {
    const totals = redemptionTotals([red({ id: "1", amount: 0.1 }), red({ id: "2", amount: 0.2 })]);
    expect(totals.amounts[0]?.units).toBe(3000n);
    expect(totals.amounts[0]?.text).toBe("Bs 0,30");
  });
  it("una moneda con todo devuelto aparece con 0, y no cuenta como uso vigente", () => {
    const totals = redemptionTotals([red({ amount: 7, currency: "USD", status: "reverted" })]);
    expect(totals.records).toBe(1);
    expect(totals.active).toBe(0);
    expect(totals.amounts.map((a) => a.text)).toEqual(["$ 0,00"]);
  });
  it("sin filas: todo en cero y sin montos", () => {
    expect(redemptionTotals([])).toEqual({ records: 0, active: 0, amounts: [] });
  });
  it("suma montos de 4 decimales y redondea al final: 1,2345 + 1,2345 = 2,4690 → Bs 2,47", () => {
    const totals = redemptionTotals([
      red({ id: "1", amount: 1.2345 }),
      red({ id: "2", amount: 1.2345 }),
    ]);
    expect(totals.amounts[0]?.units).toBe(24690n);
    expect(totals.amounts[0]?.text).toBe("Bs 2,47");
  });
  it("separador de miles", () => {
    expect(redemptionTotals([red({ amount: 1234567.5 })]).amounts[0]?.text).toBe("Bs 1.234.567,50");
  });
  it("una moneda desconocida no rompe: se muestra su código y el número", () => {
    expect(redemptionTotals([red({ amount: 15.5, currency: "XYZ" })]).amounts[0]?.text).toBe(
      "XYZ 15.5",
    );
  });
});

describe("textos", () => {
  it("formatAmount", () => {
    expect(formatAmount(15, "BOB")).toBe("Bs 15,00");
    expect(formatAmount(0, "BOB")).toBe("Bs 0,00");
    expect(formatAmount(1200, "USD")).toBe("$ 1.200,00");
    expect(formatAmount(15.5, "XYZ")).toBe("XYZ 15.5");
    expect(formatAmount(15, "XYZ")).toBe("XYZ 15");
  });
  it("ownerText: tipo y los 8 primeros caracteres del id", () => {
    expect(shortId("3f2a91bc-1111")).toBe("3f2a91bc");
    expect(ownerText({ ownerType: "order", ownerId: "3f2a91bc-1111" })).toBe("Pedido 3f2a91bc");
    expect(ownerText({ ownerType: "cart", ownerId: "abcdef01-2222" })).toBe("Bolsa abcdef01");
    expect(ownerText({ ownerType: "manual", ownerId: "99999999-3333" })).toBe("Manual 99999999");
  });
  it("customerName: el nombre, o «Sin nombre» si tiene cuenta, o «Sin cuenta (invitada)»", () => {
    expect(customerName({ customerName: "Ana", profileId: "p1" })).toBe("Ana");
    expect(customerName({ customerName: null, profileId: "p1" })).toBe("Sin nombre");
    expect(customerName({ customerName: "   ", profileId: "p1" })).toBe("Sin nombre");
    expect(customerName({ customerName: null, profileId: null })).toBe("Sin cuenta (invitada)");
  });
  it("el tope de la consulta es 1000", () => {
    expect(REDEMPTIONS_LIMIT).toBe(1000);
  });
});

describe("redemptionsCsv", () => {
  it("contenido exacto: fecha de La Paz, comas y comillas escapadas, fórmulas neutralizadas, monto con punto", () => {
    const csv = redemptionsCsv([
      red({
        id: "1",
        createdAt: "2026-11-05T18:30:00Z",
        discountName: "Verano, 2026",
        couponId: "c1",
        couponCode: "VERANO-10",
        customerName: 'María "Chola"',
        customerEmail: "maria@correo.com",
        ownerType: "order",
        ownerId: "o-1",
        amount: 15.5,
        currency: "BOB",
        status: "applied",
      }),
      red({
        id: "2",
        createdAt: "2026-11-05T18:31:00Z",
        discountName: null,
        couponCode: null,
        customerName: "=cmd",
        customerEmail: null,
        ownerType: "cart",
        ownerId: "c-9",
        amount: 7,
        currency: "USD",
        status: "reverted",
      }),
    ]);
    expect(csv).toBe(
      `${BOM}Fecha (hora de La Paz),Descuento,Código usado,Clienta,Correo,Origen,Referencia,Monto descontado,Moneda,Estado\r\n` +
        `2026-11-05 14:30,"Verano, 2026",VERANO-10,"María ""Chola""",maria@correo.com,Pedido,o-1,15.50,BOB,Aplicado\r\n` +
        `2026-11-05 14:31,,,'=cmd,,Bolsa,c-9,7.00,USD,Devuelto\r\n`,
    );
  });
  it("sin filas, solo el encabezado; respeta el orden recibido", () => {
    expect(redemptionsCsv([])).toBe(
      `${BOM}Fecha (hora de La Paz),Descuento,Código usado,Clienta,Correo,Origen,Referencia,Monto descontado,Moneda,Estado\r\n`,
    );
    const csv = redemptionsCsv([
      red({ id: "z", ownerId: "ZZZ" }),
      red({ id: "a", ownerId: "AAA" }),
    ]);
    expect(csv.indexOf("ZZZ")).toBeLessThan(csv.indexOf("AAA"));
  });
  it("los tres estados salen en español", () => {
    const csv = redemptionsCsv([
      red({ status: "reserved" }),
      red({ status: "applied" }),
      red({ status: "reverted" }),
    ]);
    expect(csv).toContain(",Reservado\r\n");
    expect(csv).toContain(",Aplicado\r\n");
    expect(csv).toContain(",Devuelto\r\n");
  });
  it("un monto con decimales de más se redondea a los de la moneda; una moneda desconocida sale tal cual", () => {
    expect(redemptionsCsv([red({ amount: 2.469 })])).toContain(",2.47,BOB,");
    expect(redemptionsCsv([red({ amount: 15.5, currency: "XYZ" })])).toContain(",15.5,XYZ,");
  });
  it("un nombre o correo con intención de fórmula sale como texto", () => {
    const csv = redemptionsCsv([red({ customerName: "@SUM(1)", customerEmail: "-1+1@x.com" })]);
    expect(csv).toContain(",'@SUM(1),'-1+1@x.com,");
  });
});
