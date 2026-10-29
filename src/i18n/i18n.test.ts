import { describe, expect, it } from "vitest";
import { resolveMessage, t, type MessageKey } from "./index";
import { es } from "./es";

describe("t()", () => {
  it("resuelve claves anidadas", () => {
    expect(t("notFound.title")).toBe("Página no encontrada");
  });
  it("interpola parámetros (incluidos números)", () => {
    expect(t("footer.rights", { year: 2026 })).toBe("© 2026 Made In Chola");
  });
  it("deja visible el placeholder si falta el parámetro", () => {
    expect(t("error.reference")).toBe("Referencia: {id}");
  });
  it("una clave inexistente devuelve la clave (visible, no vacío)", () => {
    expect(t("no.existe" as MessageKey)).toBe("no.existe");
  });
  it("no resuelve nodos intermedios ni claves heredadas del prototipo", () => {
    expect(resolveMessage("home")).toBeUndefined();
    expect(resolveMessage("home.constructor")).toBeUndefined();
    expect(resolveMessage("toString")).toBeUndefined();
  });
  it("ninguna cadena del diccionario está vacía", () => {
    const walk = (o: object): string[] =>
      Object.values(o).flatMap((v) => (typeof v === "string" ? [v] : walk(v as object)));
    expect(walk(es).every((s) => s.trim().length > 0)).toBe(true);
  });
});
