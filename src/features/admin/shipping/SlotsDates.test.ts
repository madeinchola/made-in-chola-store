import { afterEach, describe, expect, it } from "vitest";
import {
  compareIsoDates,
  formatLongDate,
  formatShortDate,
  isoDateToNoonUtc,
  isoWeekday,
  parseIsoDate,
  todayInLaPaz,
} from "./SlotsDates";

const originalTz = process.env.TZ;
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

/** La versión INGENUA que NO se debe usar: interpreta «2026-11-09» como medianoche UTC y la formatea en la zona local. */
const naiveShort = (value: string) =>
  new Intl.DateTimeFormat("es-BO", { weekday: "short", day: "numeric", month: "short" })
    .format(new Date(value))
    .replace(",", "");

describe("parseIsoDate", () => {
  it("acepta fechas reales, también el 29 de febrero de un año bisiesto", () => {
    expect(parseIsoDate("2026-11-09")).toEqual({ year: 2026, month: 11, day: 9 });
    expect(parseIsoDate("2028-02-29")).toEqual({ year: 2028, month: 2, day: 29 });
  });
  it("rechaza lo que no es una fecha real del calendario", () => {
    for (const bad of [
      "2026-02-29", // 2026 no es bisiesto
      "2026-02-31",
      "2026-04-31",
      "2026-13-01",
      "2026-00-10",
      "2026-11-00",
      "2026-1-5",
      "26-11-09",
      "2026/11/09",
      "2026-11-09T00:00",
      " 2026-11-09",
      "",
      "mañana",
    ]) {
      expect(parseIsoDate(bad), bad).toBeNull();
    }
  });
});

describe("isoWeekday (ISO: 1 = lunes … 7 = domingo)", () => {
  it("calcula el día de la semana de fechas conocidas", () => {
    expect(isoWeekday("2026-11-09")).toBe(1); // lunes
    expect(isoWeekday("2026-11-10")).toBe(2);
    expect(isoWeekday("2026-11-14")).toBe(6); // sábado
    expect(isoWeekday("2026-11-15")).toBe(7); // domingo (getUTCDay() devuelve 0)
    expect(isoWeekday("2026-12-25")).toBe(5); // viernes
  });
  it("no depende de la zona horaria del navegador", () => {
    for (const tz of ["America/La_Paz", "Pacific/Kiritimati", "Pacific/Pago_Pago", "UTC"]) {
      process.env.TZ = tz;
      expect(isoWeekday("2026-11-09"), tz).toBe(1);
      expect(isoWeekday("2026-11-15"), tz).toBe(7);
    }
  });
  it("una fecha irreal no tiene día de la semana", () => {
    expect(isoWeekday("2026-02-30")).toBeNull();
  });
});

describe("formatShortDate", () => {
  it("«lun 9 nov»: día de la semana, día y mes abreviados, sin coma", () => {
    expect(formatShortDate("2026-11-09")).toBe("lun 9 nov");
    expect(formatShortDate("2026-12-25")).toBe("vie 25 dic");
    expect(formatShortDate("2027-01-01")).toBe("vie 1 ene");
  });
  it("con año para listas que cruzan de año", () => {
    expect(formatShortDate("2026-12-25", { year: true })).toBe("vie 25 dic 2026");
  });
  it("una fecha irreal se devuelve tal cual (la pantalla no se rompe)", () => {
    expect(formatShortDate("2026-02-30")).toBe("2026-02-30");
    expect(formatShortDate("")).toBe("");
  });

  it("REGRESIÓN: en una zona con UTC negativo la versión ingenua cae un día antes; esta no", () => {
    process.env.TZ = "America/La_Paz";
    // Comprobación de que el entorno de la prueba SÍ reproduce el defecto (si esto falla, la prueba no probaría nada):
    expect(new Date("2026-11-09").getDate()).toBe(8);
    expect(naiveShort("2026-11-09")).toBe("dom 8 nov"); // la trampa
    expect(formatShortDate("2026-11-09")).toBe("lun 9 nov"); // lo correcto
  });

  it("da el mismo resultado en zonas con UTC negativo, cero y positivo", () => {
    const results = new Set<string>();
    for (const tz of [
      "America/La_Paz",
      "America/Los_Angeles",
      "Pacific/Pago_Pago", // UTC−11
      "UTC",
      "Europe/Madrid",
      "Pacific/Kiritimati", // UTC+14
    ]) {
      process.env.TZ = tz;
      results.add(formatShortDate("2026-11-09"));
      results.add(formatShortDate("2026-01-01"));
    }
    expect([...results].sort()).toEqual(["jue 1 ene", "lun 9 nov"]);
  });
});

describe("formatLongDate", () => {
  it("escribe el día completo", () => {
    expect(formatLongDate("2026-11-09")).toBe("lunes, 9 de noviembre de 2026");
  });
  it("REGRESIÓN de zona horaria", () => {
    process.env.TZ = "America/La_Paz";
    expect(formatLongDate("2026-11-09")).toContain("9 de noviembre");
  });
  it("una fecha irreal se devuelve tal cual", () => {
    expect(formatLongDate("nada")).toBe("nada");
  });
});

describe("isoDateToNoonUtc", () => {
  it("es el mediodía UTC de ese día (a salvo de cualquier desfase)", () => {
    expect(isoDateToNoonUtc("2026-11-09")?.toISOString()).toBe("2026-11-09T12:00:00.000Z");
    expect(isoDateToNoonUtc("2026-11-31")).toBeNull();
  });
});

describe("todayInLaPaz", () => {
  it("usa el día de La Paz (UTC−4), no el de UTC", () => {
    // 02:00 UTC del 10 = 22:00 del 9 en La Paz.
    expect(todayInLaPaz(new Date("2026-11-10T02:00:00Z"))).toBe("2026-11-09");
    expect(todayInLaPaz(new Date("2026-11-10T03:59:59Z"))).toBe("2026-11-09");
  });
  it("cambia de día justo a las 04:00 UTC (medianoche en La Paz)", () => {
    expect(todayInLaPaz(new Date("2026-11-10T04:00:00Z"))).toBe("2026-11-10");
    expect(todayInLaPaz(new Date("2026-11-10T15:30:00Z"))).toBe("2026-11-10");
  });
  it("no depende de la zona del navegador", () => {
    process.env.TZ = "Pacific/Kiritimati";
    expect(todayInLaPaz(new Date("2026-11-10T02:00:00Z"))).toBe("2026-11-09");
  });
});

describe("compareIsoDates", () => {
  it("ordena cronológicamente, también al cruzar de mes y de año", () => {
    const dates = ["2027-01-02", "2026-12-31", "2026-11-09", "2026-11-10", "2026-11-09"];
    expect([...dates].sort(compareIsoDates)).toEqual([
      "2026-11-09",
      "2026-11-09",
      "2026-11-10",
      "2026-12-31",
      "2027-01-02",
    ]);
    expect(compareIsoDates("2026-11-09", "2026-11-09")).toBe(0);
    expect(compareIsoDates("2026-11-09", "2026-11-10")).toBe(-1);
    expect(compareIsoDates("2026-11-10", "2026-11-09")).toBe(1);
  });
});
