import { describe, expect, it } from "vitest";
import { formatDateTime, fromLaPazInputValue, toLaPazInputValue } from "./datetime";

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

describe("toLaPazInputValue / fromLaPazInputValue (inputs datetime-local en hora de La Paz)", () => {
  it("UTC → La Paz restando 4 horas, también al cruzar el día y el año", () => {
    expect(toLaPazInputValue("2026-10-30T02:00:00Z")).toBe("2026-10-29T22:00");
    expect(toLaPazInputValue("2026-01-01T03:59:00Z")).toBe("2025-12-31T23:59");
  });
  it("la medianoche sale como 00:00 (no 24:00)", () => {
    expect(toLaPazInputValue("2026-10-30T04:00:00Z")).toBe("2026-10-30T00:00");
  });
  it("sin fecha o con basura → cadena vacía (el input queda en blanco)", () => {
    expect(toLaPazInputValue(null)).toBe("");
    expect(toLaPazInputValue(undefined)).toBe("");
    expect(toLaPazInputValue("")).toBe("");
    expect(toLaPazInputValue("no-es-fecha")).toBe("");
  });
  it("La Paz → UTC sumando 4 horas", () => {
    expect(fromLaPazInputValue("2026-10-29T22:00")).toBe("2026-10-30T02:00:00.000Z");
    expect(fromLaPazInputValue("2026-10-30T00:00")).toBe("2026-10-30T04:00:00.000Z");
  });
  it("vacío → null; formato o fecha inválidos → RangeError (no se adivina)", () => {
    expect(fromLaPazInputValue("")).toBeNull();
    expect(() => fromLaPazInputValue("2026-10-29")).toThrow(RangeError);
    expect(() => fromLaPazInputValue("2026-10-29 22:00")).toThrow(RangeError);
    expect(() => fromLaPazInputValue("2026-13-45T10:00")).toThrow(RangeError);
  });
  it("ida y vuelta: lo que se muestra es lo que se guarda", () => {
    const iso = "2026-06-15T12:30:00.000Z";
    expect(fromLaPazInputValue(toLaPazInputValue(iso))).toBe(iso);
  });
});
