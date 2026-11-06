import { describe, expect, it } from "vitest";
import {
  isPastDate,
  MAX_BLOCKED_REASON,
  splitBlockedDates,
  validateBlockedForm,
} from "./BlockedLogic";
import type { BlockedDate } from "./types";

const blocked = (id: string, blockedOn: string, over: Partial<BlockedDate> = {}): BlockedDate => ({
  id,
  blockedOn,
  reason: null,
  archived: false,
  updatedAt: "2026-11-01T10:00:00+00:00",
  ...over,
});
const ids = (list: BlockedDate[]) => list.map((d) => d.id);

describe("splitBlockedDates", () => {
  const today = "2026-11-10";

  it("futuras primero (la más cercana arriba), luego pasadas (la más reciente arriba), y archivadas aparte", () => {
    const groups = splitBlockedDates(
      [
        blocked("lejos", "2026-12-25"),
        blocked("ayer", "2026-11-09"),
        blocked("cerca", "2026-11-11"),
        blocked("antigua", "2026-01-01"),
        blocked("arch-futura", "2026-12-01", { archived: true }),
        blocked("arch-pasada", "2026-03-03", { archived: true }),
      ],
      today,
    );
    expect(ids(groups.upcoming)).toEqual(["cerca", "lejos"]);
    expect(ids(groups.past)).toEqual(["ayer", "antigua"]);
    expect(ids(groups.archived)).toEqual(["arch-futura", "arch-pasada"]);
  });

  it("BORDE: HOY cuenta como próxima (no como pasada); ayer, como pasada", () => {
    const groups = splitBlockedDates(
      [blocked("hoy", "2026-11-10"), blocked("ayer", "2026-11-09")],
      today,
    );
    expect(ids(groups.upcoming)).toEqual(["hoy"]);
    expect(ids(groups.past)).toEqual(["ayer"]);
  });

  it("cruza de año sin desordenarse", () => {
    const groups = splitBlockedDates(
      [blocked("a", "2027-01-02"), blocked("b", "2026-12-31"), blocked("c", "2027-01-01")],
      today,
    );
    expect(ids(groups.upcoming)).toEqual(["b", "c", "a"]);
  });

  it("una archivada NUNCA aparece en próximas ni en pasadas, y no se pierde ninguna", () => {
    const all = [
      blocked("1", "2026-11-12"),
      blocked("2", "2026-11-01"),
      blocked("3", "2026-11-12", { archived: true }),
    ];
    const groups = splitBlockedDates(all, today);
    expect(groups.upcoming.length + groups.past.length + groups.archived.length).toBe(3);
    expect(ids(groups.archived)).toEqual(["3"]);
  });

  it("sin fechas: tres listas vacías; no modifica la lista recibida", () => {
    expect(splitBlockedDates([], today)).toEqual({ upcoming: [], past: [], archived: [] });
    const input = [blocked("b", "2026-12-01"), blocked("a", "2026-11-11")];
    splitBlockedDates(input, today);
    expect(ids(input)).toEqual(["b", "a"]);
  });
});

describe("isPastDate", () => {
  it("anterior a hoy es pasada; hoy y después, no", () => {
    expect(isPastDate("2026-11-09", "2026-11-10")).toBe(true);
    expect(isPastDate("2026-11-10", "2026-11-10")).toBe(false);
    expect(isPastDate("2026-11-11", "2026-11-10")).toBe(false);
  });
  it("una fecha irreal no se avisa como pasada", () => {
    expect(isPastDate("2026-02-31", "2026-11-10")).toBe(false);
    expect(isPastDate("", "2026-11-10")).toBe(false);
  });
});

describe("validateBlockedForm", () => {
  const create = (existing: BlockedDate[] = []) => ({ mode: "create" as const, existing });

  it("al crear arma fecha y motivo recortado", () => {
    expect(
      validateBlockedForm({ blockedOn: "2026-12-25", reason: "  Navidad " }, create()),
    ).toEqual({ ok: true, value: { blockedOn: "2026-12-25", reason: "Navidad" } });
  });
  it("el motivo vacío o de puros espacios es «sin motivo» (null)", () => {
    for (const reason of ["", "   "]) {
      expect(validateBlockedForm({ blockedOn: "2026-12-25", reason }, create())).toEqual({
        ok: true,
        value: { blockedOn: "2026-12-25", reason: null },
      });
    }
  });
  it("fecha obligatoria", () => {
    expect(validateBlockedForm({ blockedOn: "", reason: "" }, create())).toEqual({
      ok: false,
      errors: { blockedOn: "required" },
    });
  });
  it("fecha que no existe en el calendario", () => {
    for (const bad of ["2026-02-31", "2026-13-01", "25/12/2026", "mañana"]) {
      expect(validateBlockedForm({ blockedOn: bad, reason: "" }, create()), bad).toEqual({
        ok: false,
        errors: { blockedOn: "invalid" },
      });
    }
  });
  it("no se bloquea el mismo día dos veces; una archivada no cuenta", () => {
    const existing = [blocked("1", "2026-12-25"), blocked("2", "2026-12-26", { archived: true })];
    expect(validateBlockedForm({ blockedOn: "2026-12-25", reason: "" }, create(existing))).toEqual({
      ok: false,
      errors: { blockedOn: "duplicate" },
    });
    expect(validateBlockedForm({ blockedOn: "2026-12-26", reason: "" }, create(existing)).ok).toBe(
      true,
    );
  });
  it("una fecha PASADA se puede registrar (solo se avisa en pantalla)", () => {
    expect(validateBlockedForm({ blockedOn: "2020-01-01", reason: "" }, create()).ok).toBe(true);
  });
  it("el motivo admite 120 caracteres y no 121 (cuenta caracteres, no unidades UTF-16)", () => {
    expect(
      validateBlockedForm(
        { blockedOn: "2026-12-25", reason: "a".repeat(MAX_BLOCKED_REASON) },
        create(),
      ).ok,
    ).toBe(true);
    expect(
      validateBlockedForm(
        { blockedOn: "2026-12-25", reason: "a".repeat(MAX_BLOCKED_REASON + 1) },
        create(),
      ),
    ).toEqual({ ok: false, errors: { reason: "tooLong" } });
    // 120 emojis son 240 unidades UTF-16 pero 120 caracteres: la base los acepta.
    expect(
      validateBlockedForm({ blockedOn: "2026-12-25", reason: "🎉".repeat(120) }, create()).ok,
    ).toBe(true);
    expect(
      validateBlockedForm({ blockedOn: "2026-12-25", reason: "🎉".repeat(121) }, create()).ok,
    ).toBe(false);
  });
  it("el largo se mide DESPUÉS de recortar", () => {
    expect(
      validateBlockedForm(
        { blockedOn: "2026-12-25", reason: `  ${"a".repeat(MAX_BLOCKED_REASON)}  ` },
        create(),
      ).ok,
    ).toBe(true);
  });

  it("al EDITAR solo cuenta el motivo: la fecha no se valida ni se compara con las existentes", () => {
    const existing = [blocked("1", "2026-12-25")];
    expect(
      validateBlockedForm(
        { blockedOn: "2026-12-25", reason: "Nuevo motivo" },
        { mode: "edit", existing },
      ),
    ).toEqual({ ok: true, value: { blockedOn: "2026-12-25", reason: "Nuevo motivo" } });
    expect(
      validateBlockedForm({ blockedOn: "", reason: "a".repeat(121) }, { mode: "edit", existing }),
    ).toEqual({ ok: false, errors: { reason: "tooLong" } });
  });

  it("junta fecha y motivo erróneos a la vez", () => {
    expect(validateBlockedForm({ blockedOn: "", reason: "a".repeat(121) }, create())).toEqual({
      ok: false,
      errors: { blockedOn: "required", reason: "tooLong" },
    });
  });
});
