import { describe, expect, it } from "vitest";
import { formatDateTime } from "./datetime";

describe("formatDateTime (UTC → America/La_Paz, UTC−4 sin horario de verano)", () => {
  it("03:00 UTC del 1-ene es 23:00 del 31-dic en La Paz (cruza de día y de año)", () => {
    expect(
      formatDateTime("2026-01-01T03:00:00Z", {
        dateStyle: undefined,
        timeStyle: undefined,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }),
    ).toMatch(/31\/12\/2025.*23:00/);
  });
  it("la misma hora UTC en verano boreal da el mismo desfase (Bolivia no cambia de hora)", () => {
    const winter = formatDateTime("2026-01-15T12:00:00Z", {
      dateStyle: undefined,
      timeStyle: "short",
    });
    const summer = formatDateTime("2026-07-15T12:00:00Z", {
      dateStyle: undefined,
      timeStyle: "short",
    });
    expect(winter).toBe(summer);
    expect(winter).toMatch(/08:00/);
  });
  it("acepta Date y timestamp numérico", () => {
    const iso = "2026-03-10T16:30:00Z";
    expect(formatDateTime(new Date(iso))).toBe(formatDateTime(iso));
    expect(formatDateTime(Date.parse(iso))).toBe(formatDateTime(iso));
  });
  it("fecha inválida lanza en vez de mostrar 'Invalid Date'", () => {
    expect(() => formatDateTime("no-es-fecha")).toThrow(RangeError);
  });
});
