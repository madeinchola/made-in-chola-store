import { describe, expect, it } from "vitest";
import type { SettingRow } from "../config/types";
import {
  findSlotConflicts,
  groupSlotsByWeekday,
  settingInt,
  slotRangeText,
  timeToMinutes,
  validateSlotForm,
  WEEKDAYS,
  type SlotFormValues,
} from "./SlotsLogic";
import type { DeliverySlot } from "./types";

let seq = 0;
const slot = (over: Partial<DeliverySlot> = {}): DeliverySlot => ({
  id: `s${++seq}`,
  methodId: "m1",
  weekday: 1,
  startTime: "09:00",
  endTime: "12:00",
  capacity: 5,
  isActive: true,
  archived: false,
  updatedAt: "2026-11-01T10:00:00+00:00",
  ...over,
});

describe("timeToMinutes", () => {
  it("convierte HH:MM válidos", () => {
    expect(timeToMinutes("00:00")).toBe(0);
    expect(timeToMinutes("09:30")).toBe(570);
    expect(timeToMinutes("12:00")).toBe(720);
    expect(timeToMinutes("23:59")).toBe(1439);
  });
  it("rechaza lo que no es una hora válida", () => {
    for (const bad of ["24:00", "9:00", "09:60", "09:00:30", "", "abc", "12-00", " 12:00"]) {
      expect(timeToMinutes(bad), bad).toBeNull();
    }
  });
});

describe("slotRangeText", () => {
  it("escribe el horario con raya", () => {
    expect(slotRangeText({ startTime: "09:00", endTime: "11:30" })).toBe("09:00–11:30");
  });
});

describe("groupSlotsByWeekday", () => {
  it("devuelve SIEMPRE los siete días de lunes (1) a domingo (7), aunque no haya franjas", () => {
    const groups = groupSlotsByWeekday([], "m1");
    expect(groups.map((g) => g.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(groups.map((g) => g.weekday)).toEqual([...WEEKDAYS]);
    expect(groups.every((g) => g.slots.length === 0)).toBe(true);
  });

  it("reparte cada franja en su día y ordena por hora de inicio (no por el orden en que llegan)", () => {
    const tarde = slot({ id: "tarde", weekday: 3, startTime: "14:00", endTime: "16:00" });
    const manana = slot({ id: "manana", weekday: 3, startTime: "08:00", endTime: "10:00" });
    const mediodia = slot({ id: "mediodia", weekday: 3, startTime: "10:00", endTime: "12:00" });
    const lunes = slot({ id: "lunes", weekday: 1 });
    const domingo = slot({ id: "domingo", weekday: 7 });
    const groups = groupSlotsByWeekday([tarde, domingo, manana, lunes, mediodia], "m1");
    const ids = (w: number) => groups.find((g) => g.weekday === w)?.slots.map((s) => s.id);
    expect(ids(3)).toEqual(["manana", "mediodia", "tarde"]);
    expect(ids(1)).toEqual(["lunes"]);
    expect(ids(7)).toEqual(["domingo"]);
    expect(ids(2)).toEqual([]);
  });

  it("solo las del método pedido", () => {
    const mine = slot({ id: "mine", methodId: "m1" });
    const other = slot({ id: "other", methodId: "m2" });
    const groups = groupSlotsByWeekday([mine, other], "m1");
    expect(groups.flatMap((g) => g.slots.map((s) => s.id))).toEqual(["mine"]);
  });

  it("omite las archivadas, salvo que se pidan (y entonces van después de la activa que empieza igual)", () => {
    const active = slot({ id: "a", startTime: "09:00" });
    const archived = slot({ id: "b", startTime: "09:00", archived: true });
    const archivedEarly = slot({ id: "c", startTime: "07:00", archived: true });
    expect(
      groupSlotsByWeekday([archived, active, archivedEarly], "m1")[0]?.slots.map((s) => s.id),
    ).toEqual(["a"]);
    expect(
      groupSlotsByWeekday([archived, active, archivedEarly], "m1", {
        includeArchived: true,
      })[0]?.slots.map((s) => s.id),
    ).toEqual(["c", "a", "b"]);
  });

  it("a igual hora de inicio, ordena por la de fin", () => {
    const long = slot({ id: "long", startTime: "09:00", endTime: "13:00" });
    const short = slot({ id: "short", startTime: "09:00", endTime: "10:00" });
    expect(groupSlotsByWeekday([long, short], "m1")[0]?.slots.map((s) => s.id)).toEqual([
      "short",
      "long",
    ]);
  });

  it("no pierde ni duplica franjas", () => {
    const all = WEEKDAYS.flatMap((w) => [
      slot({ weekday: w, startTime: "08:00", endTime: "09:00" }),
      slot({ weekday: w, startTime: "10:00", endTime: "11:00" }),
    ]);
    const grouped = groupSlotsByWeekday(all, "m1").flatMap((g) => g.slots);
    expect(grouped).toHaveLength(14);
    expect(new Set(grouped.map((s) => s.id)).size).toBe(14);
  });
});

describe("findSlotConflicts: solapes", () => {
  const existing = slot({ id: "x", startTime: "09:00", endTime: "12:00" });
  const check = (start: string, end: string, over: Record<string, unknown> = {}) =>
    findSlotConflicts(
      { methodId: "m1", weekday: 1, startTime: start, endTime: end, isActive: true, ...over },
      [existing],
    );

  it("BORDE: terminar a las 12:00 y empezar a las 12:00 NO es solape", () => {
    expect(check("12:00", "14:00")).toEqual({ sameStart: null, overlaps: [] });
  });
  it("BORDE: la nueva termina justo cuando la existente empieza (09:00): NO es solape", () => {
    expect(check("07:00", "09:00")).toEqual({ sameStart: null, overlaps: [] });
  });
  it("BORDE: un minuto de más SÍ es solape (por el final y por el inicio)", () => {
    expect(check("11:59", "13:00").overlaps).toEqual([existing]);
    expect(check("07:00", "09:01").overlaps).toEqual([existing]);
  });
  it("la nueva contiene a la existente, o está dentro de ella: solape", () => {
    expect(check("08:00", "13:00").overlaps).toEqual([existing]);
    expect(check("10:00", "11:00").overlaps).toEqual([existing]);
  });
  it("lejos: sin solape", () => {
    expect(check("14:00", "16:00")).toEqual({ sameStart: null, overlaps: [] });
  });
  it("empezar a la MISMA hora es otro caso: la base lo rechaza, así que se marca aparte (y no cuenta como solape)", () => {
    expect(check("09:00", "10:00")).toEqual({ sameStart: existing, overlaps: [] });
  });
  it("detecta cada franja con la que se pisa", () => {
    const second = slot({ id: "y", startTime: "13:00", endTime: "15:00" });
    const result = findSlotConflicts(
      { methodId: "m1", weekday: 1, startTime: "11:00", endTime: "14:00", isActive: true },
      [existing, second],
    );
    expect(result.overlaps.map((s) => s.id)).toEqual(["x", "y"]);
  });

  it("no cuentan: otro día, otro método, archivadas, ni la propia franja al editarla", () => {
    const otherDay = slot({ weekday: 2 });
    const otherMethod = slot({ methodId: "m2" });
    const archived = slot({ archived: true });
    const result = findSlotConflicts(
      {
        id: existing.id,
        methodId: "m1",
        weekday: 1,
        startTime: "09:00",
        endTime: "12:00",
        isActive: true,
      },
      [existing, otherDay, otherMethod, archived],
    );
    expect(result).toEqual({ sameStart: null, overlaps: [] });
  });

  it("una franja INACTIVA no genera advertencia de solape, pero sí bloquea si empieza a la misma hora", () => {
    const inactive = slot({ id: "i", startTime: "09:00", endTime: "12:00", isActive: false });
    const overlapping = findSlotConflicts(
      { methodId: "m1", weekday: 1, startTime: "10:00", endTime: "11:00", isActive: true },
      [inactive],
    );
    expect(overlapping).toEqual({ sameStart: null, overlaps: [] });
    const same = findSlotConflicts(
      { methodId: "m1", weekday: 1, startTime: "09:00", endTime: "10:00", isActive: true },
      [inactive],
    );
    expect(same.sameStart).toBe(inactive);
  });

  it("si la candidata es inactiva no se advierte (no se ofrece)", () => {
    expect(check("10:00", "11:00", { isActive: false })).toEqual({ sameStart: null, overlaps: [] });
  });

  it("con horas incompletas o invertidas no hay solape que calcular", () => {
    expect(check("", "11:00")).toEqual({ sameStart: null, overlaps: [] });
    expect(check("10:00", "")).toEqual({ sameStart: null, overlaps: [] });
    expect(check("11:00", "10:00").overlaps).toEqual([]);
    expect(check("10:00", "10:00").overlaps).toEqual([]);
  });
});

describe("validateSlotForm", () => {
  const ok: SlotFormValues = {
    weekday: 3,
    startTime: "09:00",
    endTime: "11:00",
    capacity: "5",
    isActive: true,
  };
  const noConflict: { sameStart: DeliverySlot | null } = { sameStart: null };
  const errorsOf = (over: Partial<SlotFormValues>, conflicts = noConflict) => {
    const result = validateSlotForm({ ...ok, ...over }, conflicts);
    return result.ok ? null : result.errors;
  };

  it("un formulario válido da EXACTAMENTE lo que se guarda: inicio, fin, cupo (número) y activa; sin día ni método", () => {
    const result = validateSlotForm(ok, noConflict);
    expect(result).toEqual({
      ok: true,
      value: { startTime: "09:00", endTime: "11:00", capacity: 5, isActive: true },
    });
  });
  it("respeta isActive=false y recorta espacios del cupo", () => {
    expect(validateSlotForm({ ...ok, isActive: false, capacity: "  12 " }, noConflict)).toEqual({
      ok: true,
      value: { startTime: "09:00", endTime: "11:00", capacity: 12, isActive: false },
    });
  });

  it("hora de inicio inválida o vacía", () => {
    for (const bad of ["", "25:00", "9:00", "10:60", "abc"]) {
      expect(errorsOf({ startTime: bad }), bad).toEqual({ startTime: "startInvalid" });
    }
  });
  it("hora de fin inválida o vacía", () => {
    for (const bad of ["", "24:00", "11:75", "x"]) {
      expect(errorsOf({ endTime: bad }), bad).toEqual({ endTime: "endInvalid" });
    }
  });
  it("el fin debe ser POSTERIOR al inicio: igual o anterior se rechaza, un minuto después se acepta", () => {
    expect(errorsOf({ startTime: "10:00", endTime: "10:00" })).toEqual({
      endTime: "endNotAfterStart",
    });
    expect(errorsOf({ startTime: "10:00", endTime: "09:59" })).toEqual({
      endTime: "endNotAfterStart",
    });
    expect(errorsOf({ startTime: "10:00", endTime: "10:01" })).toBeNull();
  });
  it("con el inicio inválido no se juzga el orden", () => {
    expect(errorsOf({ startTime: "", endTime: "09:00" })).toEqual({ startTime: "startInvalid" });
  });

  it("cupo: vacío, no entero, fuera de 1–1000", () => {
    expect(errorsOf({ capacity: "" })).toEqual({ capacity: "capacityRequired" });
    expect(errorsOf({ capacity: "   " })).toEqual({ capacity: "capacityRequired" });
    for (const bad of ["abc", "2.5", "2,5", "-3", "1e3", "5.0", "+5", "5 6"]) {
      expect(errorsOf({ capacity: bad }), bad).toEqual({ capacity: "capacityInteger" });
    }
    for (const bad of ["0", "00", "1001", "99999999999999999999"]) {
      expect(errorsOf({ capacity: bad }), bad).toEqual({ capacity: "capacityRange" });
    }
  });
  it("cupo: los bordes 1 y 1000 son válidos", () => {
    expect(errorsOf({ capacity: "1" })).toBeNull();
    expect(errorsOf({ capacity: "1000" })).toBeNull();
    const result = validateSlotForm({ ...ok, capacity: "007" }, noConflict);
    expect(result.ok && result.value.capacity).toBe(7);
  });

  it("empezar a la misma hora que otra franja del día es un error del inicio (no un aviso)", () => {
    const other = slot();
    expect(errorsOf({}, { sameStart: other })).toEqual({ startTime: "sameStart" });
  });

  it("junta TODOS los errores, para mostrarlos a la vez", () => {
    expect(errorsOf({ startTime: "", endTime: "", capacity: "0" })).toEqual({
      startTime: "startInvalid",
      endTime: "endInvalid",
      capacity: "capacityRange",
    });
  });
});

describe("settingInt", () => {
  const row = (key: string, value: unknown): SettingRow => ({
    key,
    value,
    valueType: "int",
    isPublic: false,
    description: null,
    updatedAt: "2026-11-01T10:00:00+00:00",
  });
  it("lee números y números escritos como texto", () => {
    expect(settingInt([row("a", 24), row("b", "30")], "a")).toBe(24);
    expect(settingInt([row("a", 24), row("b", " 30 ")], "b")).toBe(30);
    expect(settingInt([row("a", 0)], "a")).toBe(0);
  });
  it("null si falta, no hay lista o no es un número", () => {
    expect(settingInt([row("a", 24)], "zzz")).toBeNull();
    expect(settingInt(undefined, "a")).toBeNull();
    expect(settingInt([row("a", "veinte")], "a")).toBeNull();
    expect(settingInt([row("a", null)], "a")).toBeNull();
    expect(settingInt([row("a", Number.NaN)], "a")).toBeNull();
    expect(settingInt([row("a", true)], "a")).toBeNull();
  });
});
