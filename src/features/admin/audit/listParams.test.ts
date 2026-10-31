import { describe, expect, it } from "vitest";
import {
  AUDIT_PAGE_SIZE,
  DEFAULT_AUDIT_PARAMS,
  applyAuditPatch,
  dayRangeIso,
  hasAuditFilters,
  isValidDay,
  parseAuditParams,
  toAuditSearchParams,
} from "./listParams";

const A1 = "11111111-1111-4111-8111-111111111111";
const parse = (qs: string) => parseAuditParams(new URLSearchParams(qs));

describe("isValidDay", () => {
  it("acepta fechas reales, incluido el 29 de febrero bisiesto", () => {
    expect(isValidDay("2026-10-30")).toBe(true);
    expect(isValidDay("2028-02-29")).toBe(true);
  });
  it.each([
    "2026-02-30",
    "2027-02-29",
    "2026-13-01",
    "2026-00-10",
    "2026-10-32",
    "2026-1-5",
    "26-10-30",
    "",
    "hoy",
    "2026-10-30T00:00",
  ])("«%s» no es una fecha válida", (v) => {
    expect(isValidDay(v)).toBe(false);
  });
});

describe("parseAuditParams", () => {
  it("sin parámetros: página 1 de 25, sin filtros", () => {
    expect(parse("")).toEqual({ page: 1, pageSize: AUDIT_PAGE_SIZE });
    expect(AUDIT_PAGE_SIZE).toBe(25);
  });
  it("entiende cada parámetro", () => {
    expect(
      parse(`tabla=products&accion=editado&actor=${A1}&desde=2026-10-01&hasta=2026-10-30&pagina=4`),
    ).toEqual({
      table: "products",
      action: "UPDATE",
      actorId: A1,
      from: "2026-10-01",
      to: "2026-10-30",
      page: 4,
      pageSize: 25,
    });
  });
  it.each([
    ["creado", "INSERT"],
    ["editado", "UPDATE"],
    ["eliminado", "DELETE"],
  ])("accion=%s → %s", (url, action) => {
    expect(parse(`accion=${url}`).action).toBe(action);
  });
  it("valores inválidos caen al valor por defecto, sin romper", () => {
    expect(
      parse("tabla=users;drop&accion=INSERT&actor=no-uuid&desde=2026-02-30&hasta=ayer&pagina=abc"),
    ).toEqual(DEFAULT_AUDIT_PARAMS);
  });
  it("la tabla debe ser una de las auditadas (no se acepta texto libre)", () => {
    expect(parse("tabla=audit_log").table).toBeUndefined();
    expect(parse("tabla=store_settings").table).toBe("store_settings");
  });
  it("un rango invertido descarta el 'hasta' y conserva el 'desde'", () => {
    const p = parse("desde=2026-10-20&hasta=2026-10-10");
    expect(p.from).toBe("2026-10-20");
    expect(p.to).toBeUndefined();
  });
  it("desde y hasta iguales (un solo día) son válidos", () => {
    const p = parse("desde=2026-10-20&hasta=2026-10-20");
    expect([p.from, p.to]).toEqual(["2026-10-20", "2026-10-20"]);
  });
  it.each(["0", "-1", "3.5", "abc", "", "1e3", "999999"])("pagina=%s inválida → 1", (v) => {
    expect(parse(`pagina=${v}`).page).toBe(1);
  });
});

describe("toAuditSearchParams / ida y vuelta", () => {
  it("los valores por defecto no ensucian la URL", () => {
    expect(toAuditSearchParams(DEFAULT_AUDIT_PARAMS).toString()).toBe("");
  });
  it("lo que se escribe en la URL se lee igual", () => {
    const original = {
      table: "news_banners" as const,
      action: "DELETE" as const,
      actorId: A1,
      from: "2026-01-02",
      to: "2026-03-04",
      page: 7,
      pageSize: 25,
    };
    expect(parseAuditParams(toAuditSearchParams(original))).toEqual(original);
  });
  it("hasAuditFilters: la página no cuenta como filtro", () => {
    expect(hasAuditFilters({ ...DEFAULT_AUDIT_PARAMS, page: 9 })).toBe(false);
    expect(hasAuditFilters({ ...DEFAULT_AUDIT_PARAMS, from: "2026-10-01" })).toBe(true);
    expect(hasAuditFilters({ ...DEFAULT_AUDIT_PARAMS, actorId: A1 })).toBe(true);
  });
});

describe("applyAuditPatch", () => {
  const base = {
    ...DEFAULT_AUDIT_PARAMS,
    table: "products" as const,
    action: "UPDATE" as const,
    page: 5,
  };
  it("cambiar un filtro vuelve a la página 1 y conserva los demás", () => {
    expect(applyAuditPatch(base, { actorId: A1 })).toEqual({
      ...DEFAULT_AUDIT_PARAMS,
      table: "products",
      action: "UPDATE",
      actorId: A1,
      page: 1,
    });
  });
  it("undefined quita el filtro", () => {
    const next = applyAuditPatch(base, { table: undefined });
    expect("table" in next).toBe(false);
    expect(next.action).toBe("UPDATE");
  });
  it("cambiar de página conserva la pedida", () => {
    expect(applyAuditPatch(base, { page: 6 }).page).toBe(6);
  });
  it("no modifica el objeto recibido", () => {
    const copy = { ...base };
    applyAuditPatch(base, { table: undefined, page: 2 });
    expect(base).toEqual(copy);
  });
});

describe("dayRangeIso (días en hora de La Paz, UTC−4)", () => {
  it("el día 'desde' empieza a las 00:00 de La Paz = 04:00 UTC", () => {
    expect(dayRangeIso("2026-10-30")).toEqual({ gte: "2026-10-30T04:00:00.000Z" });
  });
  it("el día 'hasta' entra COMPLETO: el límite es el inicio del día siguiente (exclusivo)", () => {
    expect(dayRangeIso(undefined, "2026-10-30")).toEqual({ lt: "2026-10-31T04:00:00.000Z" });
  });
  it("un solo día: [00:00 de ese día, 00:00 del siguiente) = exactamente 24 horas", () => {
    const r = dayRangeIso("2026-10-30", "2026-10-30");
    expect(r).toEqual({ gte: "2026-10-30T04:00:00.000Z", lt: "2026-10-31T04:00:00.000Z" });
    expect(new Date(r.lt as string).getTime() - new Date(r.gte as string).getTime()).toBe(
      86_400_000,
    );
  });
  it("cruza fin de mes y de año", () => {
    expect(dayRangeIso(undefined, "2026-12-31").lt).toBe("2027-01-01T04:00:00.000Z");
    expect(dayRangeIso(undefined, "2026-02-28").lt).toBe("2026-03-01T04:00:00.000Z");
  });
  it("sin fechas, o con fechas inválidas, no hay rango", () => {
    expect(dayRangeIso()).toEqual({});
    expect(dayRangeIso("2026-02-30", "basura")).toEqual({});
  });
  it("un evento a las 23:30 de La Paz (03:30 UTC del día siguiente) cae dentro del día de La Paz", () => {
    const r = dayRangeIso("2026-10-30", "2026-10-30");
    const event = new Date("2026-10-31T03:30:00Z").getTime();
    expect(
      event >= new Date(r.gte as string).getTime() && event < new Date(r.lt as string).getTime(),
    ).toBe(true);
    const nextDay = new Date("2026-10-31T04:00:00Z").getTime(); // 00:00 La Paz del 31: fuera
    expect(nextDay < new Date(r.lt as string).getTime()).toBe(false);
  });
});
