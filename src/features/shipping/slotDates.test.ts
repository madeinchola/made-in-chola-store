import { afterEach, describe, expect, it } from "vitest";
import { formatSlotDate, formatSlotRange, groupSlotsByDate, isoDateToUtcNoon } from "./slotDates";
import type { QuoteSlot } from "./types";

const slot = (date: string, start: string, end: string, extra: Partial<QuoteSlot> = {}) => ({
  slotId: `s-${date}-${start}`,
  date,
  start,
  end,
  capacity: 3,
  remaining: 3,
  available: true,
  ...extra,
});

const originalTz = process.env.TZ;
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe("formatSlotDate · «lun 9 nov»", () => {
  // Los días de la semana están comprobados a mano contra el calendario de 2026 (1 de enero = jueves).
  it.each([
    ["2026-11-09", "lun 9 nov"],
    ["2026-11-10", "mar 10 nov"],
    ["2026-11-11", "mié 11 nov"],
    ["2026-11-01", "dom 1 nov"],
    ["2026-02-28", "sáb 28 feb"],
    ["2026-12-31", "jue 31 dic"],
    ["2027-01-01", "vie 1 ene"],
  ])("%s → %s", (iso, expected) => {
    expect(formatSlotDate(iso)).toBe(expected);
  });

  it("sin punto en las abreviaturas ni coma entre las partes", () => {
    for (let day = 1; day <= 28; day++) {
      const text = formatSlotDate(`2026-03-${String(day).padStart(2, "0")}`);
      expect(text).toMatch(/^\p{L}{3} \d{1,2} \p{L}{3,4}$/u);
    }
  });

  // Si alguien volviera a `new Date("AAAA-MM-DD")` (medianoche UTC, formateada en la zona del dispositivo), en una zona con
  // UTC negativo el lunes se vería «dom». Estas pruebas cambian la zona del proceso: con la forma ingenua FALLAN.
  it("la zona horaria del dispositivo no cambia el día (Bolivia es UTC−4)", () => {
    process.env.TZ = "America/La_Paz";
    // la premisa de la prueba: aquí la forma ingenua SÍ se equivoca de día
    expect(new Date("2026-11-09").getDate()).toBe(8);
    expect(formatSlotDate("2026-11-09")).toBe("lun 9 nov");
    expect(formatSlotDate("2026-12-01")).toBe("mar 1 dic");
  });

  it.each([
    "Pacific/Pago_Pago", // UTC−11
    "America/Los_Angeles", // UTC−8
    "America/La_Paz", // UTC−4
    "UTC",
    "Europe/Madrid", // UTC+1
    "Pacific/Kiritimati", // UTC+14
  ])("el resultado es el mismo en %s", (zone) => {
    process.env.TZ = zone;
    expect(formatSlotDate("2026-11-09")).toBe("lun 9 nov");
    expect(formatSlotDate("2027-01-01")).toBe("vie 1 ene");
  });

  it("una fecha que no existe o que no es AAAA-MM-DD se devuelve tal cual (no se inventa un día)", () => {
    expect(formatSlotDate("2026-02-31")).toBe("2026-02-31");
    expect(formatSlotDate("2026-13-01")).toBe("2026-13-01");
    expect(formatSlotDate("2026-11-9")).toBe("2026-11-9");
    expect(formatSlotDate("mañana")).toBe("mañana");
    expect(formatSlotDate("")).toBe("");
  });

  it("29 de febrero: solo en año bisiesto", () => {
    expect(formatSlotDate("2028-02-29")).toBe("mar 29 feb");
    expect(formatSlotDate("2026-02-29")).toBe("2026-02-29");
  });
});

describe("isoDateToUtcNoon", () => {
  it("construye las 12:00 UTC del día (no la medianoche)", () => {
    const date = isoDateToUtcNoon("2026-11-09");
    expect(date?.toISOString()).toBe("2026-11-09T12:00:00.000Z");
  });
  it("null si la fecha no existe", () => {
    expect(isoDateToUtcNoon("2026-04-31")).toBeNull();
    expect(isoDateToUtcNoon("2026-00-10")).toBeNull();
    expect(isoDateToUtcNoon("26-11-09")).toBeNull();
  });
});

describe("formatSlotRange", () => {
  it("«10:00 a 12:00»", () => {
    expect(formatSlotRange("10:00", "12:00")).toBe("10:00 a 12:00");
  });
});

describe("groupSlotsByDate", () => {
  it("agrupa por día, en orden cronológico, y las franjas de cada día por hora de inicio", () => {
    const days = groupSlotsByDate([
      slot("2026-11-10", "15:00", "17:00"),
      slot("2026-11-09", "14:00", "16:00"),
      slot("2026-11-10", "09:00", "11:00"),
      slot("2026-11-09", "09:00", "11:00"),
    ]);
    expect(days.map((d) => d.date)).toEqual(["2026-11-09", "2026-11-10"]);
    expect(days.map((d) => d.label)).toEqual(["lun 9 nov", "mar 10 nov"]);
    expect(days[0]!.slots.map((s) => s.start)).toEqual(["09:00", "14:00"]);
    expect(days[1]!.slots.map((s) => s.start)).toEqual(["09:00", "15:00"]);
  });

  it("no filtra nada: las franjas llenas siguen en su día", () => {
    const full = slot("2026-11-09", "09:00", "11:00", { remaining: 0, available: false });
    const days = groupSlotsByDate([full, slot("2026-11-09", "14:00", "16:00")]);
    expect(days).toHaveLength(1);
    expect(days[0]!.slots).toHaveLength(2);
    expect(days[0]!.slots[0]).toBe(full);
  });

  it("sin franjas no hay días; y no modifica la lista recibida", () => {
    expect(groupSlotsByDate([])).toEqual([]);
    const input = [slot("2026-11-10", "10:00", "12:00"), slot("2026-11-09", "10:00", "12:00")];
    const copy = [...input];
    groupSlotsByDate(input);
    expect(input).toEqual(copy);
  });

  it("dos franjas a la misma hora de un día conservan un orden estable (por id)", () => {
    const a = slot("2026-11-09", "10:00", "12:00", { slotId: "b" });
    const b = slot("2026-11-09", "10:00", "12:00", { slotId: "a" });
    expect(groupSlotsByDate([a, b])[0]!.slots.map((s) => s.slotId)).toEqual(["a", "b"]);
  });
});
