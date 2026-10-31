import { describe, expect, it } from "vitest";
import { collectionStatus } from "./collectionStatus";

const NOW = new Date("2026-10-29T12:00:00.000Z");
const c = (startsAt: string | null, endsAt: string | null, archived = false) => ({
  archived,
  startsAt,
  endsAt,
});

describe("collectionStatus (mismas reglas que public_collections)", () => {
  it("sin fechas: vigente siempre", () => {
    expect(collectionStatus(c(null, null), NOW)).toBe("active");
  });
  it("archivada gana sobre cualquier fecha", () => {
    expect(collectionStatus(c(null, null, true), NOW)).toBe("archived");
    expect(collectionStatus(c("2026-01-01T00:00:00Z", "2026-12-31T00:00:00Z", true), NOW)).toBe(
      "archived",
    );
  });
  it("inicio en el futuro: programada", () => {
    expect(collectionStatus(c("2026-10-30T00:00:00Z", null), NOW)).toBe("scheduled");
  });
  it("fin en el pasado: vencida", () => {
    expect(collectionStatus(c(null, "2026-10-28T00:00:00Z"), NOW)).toBe("expired");
  });
  it("dentro de la ventana: vigente", () => {
    expect(collectionStatus(c("2026-10-01T00:00:00Z", "2026-11-30T00:00:00Z"), NOW)).toBe("active");
  });
  it("el INICIO es inclusivo: justo en el instante de inicio ya está vigente", () => {
    expect(collectionStatus(c("2026-10-29T12:00:00Z", null), NOW)).toBe("active");
  });
  it("un milisegundo antes del inicio sigue programada", () => {
    expect(collectionStatus(c("2026-10-29T12:00:00.001Z", null), NOW)).toBe("scheduled");
  });
  it("el FIN es exclusivo: justo en el instante de fin ya está vencida", () => {
    expect(collectionStatus(c(null, "2026-10-29T12:00:00Z"), NOW)).toBe("expired");
  });
  it("un milisegundo antes del fin sigue vigente", () => {
    expect(collectionStatus(c(null, "2026-10-29T12:00:00.001Z"), NOW)).toBe("active");
  });
  it("la zona horaria no cambia el instante (offset -04:00 equivale a UTC+4h)", () => {
    expect(collectionStatus(c("2026-10-29T08:00:00-04:00", null), NOW)).toBe("active");
    expect(collectionStatus(c("2026-10-29T08:00:01-04:00", null), NOW)).toBe("scheduled");
  });
});
