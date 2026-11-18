import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { COMPLETE_MARKER, DRAFT_MARKER } from "@/features/legal/starterTexts";
import {
  checkBody,
  draftVersion,
  isoToLaPazLocal,
  laPazToIso,
  legalErrorKey,
  validateBody,
  versionStatuses,
} from "./logic";
import type { OverviewRow, VersionSummary } from "./types";

const VARS = {
  razon_social: "Chola SRL",
  nit: "123",
  direccion: "Calle 1",
  correo: "a@b.c",
  telefono: "7",
};
const v = (
  version: number,
  status: "draft" | "published",
  effectiveAt: string | null,
): VersionSummary => ({
  version,
  status,
  effectiveAt,
  publishedAt: status === "published" ? effectiveAt : null,
  changeNote: null,
});

describe("hora de La Paz", () => {
  it("convierte lo que da un datetime-local (UTC−4, sin horario de verano) a un instante", () => {
    expect(laPazToIso("2026-11-20T09:30")).toBe("2026-11-20T13:30:00.000Z");
    // medianoche de La Paz ya es el día siguiente en UTC
    expect(laPazToIso("2026-11-20T22:00")).toBe("2026-11-21T02:00:00.000Z");
  });

  it("rechaza lo que no es una fecha completa o no existe", () => {
    expect(laPazToIso("")).toBeNull();
    expect(laPazToIso("2026-11-20")).toBeNull();
    expect(laPazToIso("2026-13-40T10:00")).toBeNull();
  });

  it("ida y vuelta: el valor que se muestra es el mismo que se manda", () => {
    const iso = "2026-11-21T02:00:00.000Z";
    expect(isoToLaPazLocal(iso)).toBe("2026-11-20T22:00");
    expect(laPazToIso(isoToLaPazLocal(iso))).toBe(iso);
  });
});

describe("checkBody · qué impide publicar", () => {
  it("un texto completo y con los datos del negocio definidos se puede publicar", () => {
    expect(checkBody("Somos {{razon_social}}, NIT {{nit}}.", VARS)).toEqual({
      ok: true,
      unknown: [],
      empty: [],
      pending: [],
    });
  });

  it("distingue la variable con error de tipeo de la que existe pero no tiene dato", () => {
    const result = checkBody("{{razon}} y {{nit}}", { ...VARS, nit: "  " });
    expect(result).toMatchObject({ ok: false, unknown: ["razon"], empty: ["nit"] });
  });

  it("las marcas de borrador y de por completar bloquean, cada una por separado", () => {
    expect(checkBody(`${DRAFT_MARKER}: x`, VARS).pending).toEqual([DRAFT_MARKER]);
    expect(checkBody(`Plazo ${COMPLETE_MARKER}: días]`, VARS).pending).toEqual([COMPLETE_MARKER]);
    expect(checkBody(`${DRAFT_MARKER} ${COMPLETE_MARKER}`, VARS).ok).toBe(false);
  });

  it("una variable repetida se cuenta una vez", () => {
    expect(checkBody("{{nit}} {{nit}}", { ...VARS, nit: "" }).empty).toEqual(["nit"]);
  });
});

describe("validateBody · las mismas reglas que la base", () => {
  it("entre 20 y 60 000 caracteres y sin HTML", () => {
    expect(validateBody("corto")).toBe("invalid_body");
    expect(validateBody(" ".repeat(30))).toBe("invalid_body");
    expect(validateBody("x".repeat(60_001))).toBe("invalid_body");
    expect(validateBody("x".repeat(60_000))).toBeNull();
    expect(validateBody("x".repeat(20))).toBeNull();
    expect(validateBody("Texto con <script>alert(1)</script> dentro")).toBe("html_not_allowed");
    expect(validateBody("Un texto con 5 < 6 y mucho más contenido")).toBeNull();
  });
});

describe("versionStatuses", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  it("la vigente es la última publicada que ya rige; la que rige después está programada; las anteriores quedan reemplazadas", () => {
    const map = versionStatuses(
      [
        v(4, "draft", null),
        v(3, "published", "2026-12-01T00:00:00Z"),
        v(2, "published", "2026-11-10T00:00:00Z"),
        v(1, "published", "2026-10-01T00:00:00Z"),
      ],
      now,
    );
    expect(Object.fromEntries(map)).toEqual({
      4: "draft",
      3: "scheduled",
      2: "current",
      1: "replaced",
    });
  });

  it("sin nada que rija todavía no hay vigente", () => {
    const map = versionStatuses([v(1, "published", "2027-01-01T00:00:00Z")], now);
    expect([...map.values()]).toEqual(["scheduled"]);
  });
});

describe("draftVersion", () => {
  const row = (versions: VersionSummary[]): OverviewRow => ({
    kind: "terms",
    title: "T",
    requiresAcceptance: true,
    currentVersion: null,
    currentEffectiveAt: null,
    hasDraft: versions.some((x) => x.status === "draft"),
    versions,
  });
  it("es el del borrador si lo hay, o la siguiente a la última versión, o la 1", () => {
    expect(draftVersion(undefined)).toBe(1);
    expect(draftVersion(row([]))).toBe(1);
    expect(draftVersion(row([v(2, "published", "2026-01-01T00:00:00Z")]))).toBe(3);
    expect(
      draftVersion(row([v(3, "draft", null), v(2, "published", "2026-01-01T00:00:00Z")])),
    ).toBe(3);
  });
});

describe("legalErrorKey", () => {
  it("traduce los códigos que lanza la base y esconde cualquier otro mensaje", () => {
    expect(legalErrorKey(new AppError("validation", "effective_in_past"))).toBe(
      "admin.legal.errors.effective_in_past",
    );
    expect(legalErrorKey(new AppError("validation", "change_note_required"))).toBe(
      "admin.legal.errors.change_note_required",
    );
    expect(legalErrorKey(new AppError("unknown", "select * from secretos"))).toBe(
      "admin.legal.errors.unknown",
    );
    expect(legalErrorKey("raro")).toBe("admin.legal.errors.unknown");
  });
});
