import { describe, expect, it } from "vitest";
import type { TaxonomyOption } from "../types";
import { categoryPaths } from "./categoryPaths";

const opt = (id: string, name: string, parentId: string | null = null): TaxonomyOption => ({
  id,
  name,
  parentId,
  archived: false,
});

describe("categoryPaths", () => {
  it("una categoría raíz es solo su nombre", () => {
    expect(categoryPaths([opt("a", "Ropa")]).get("a")).toBe("Ropa");
  });

  it("une los ancestros de arriba hacia abajo, sin importar el orden de la lista", () => {
    const list = [opt("c", "Manga larga", "b"), opt("a", "Ropa"), opt("b", "Camisas", "a")];
    const paths = categoryPaths(list);
    expect(paths.get("c")).toBe("Ropa › Camisas › Manga larga");
    expect(paths.get("b")).toBe("Ropa › Camisas");
  });

  it("distingue homónimas bajo padres distintos", () => {
    const list = [
      opt("r", "Ropa"),
      opt("a", "Accesorios"),
      opt("x", "Otros", "r"),
      opt("y", "Otros", "a"),
    ];
    const paths = categoryPaths(list);
    expect(paths.get("x")).toBe("Ropa › Otros");
    expect(paths.get("y")).toBe("Accesorios › Otros");
  });

  it("un padre que no está en la lista no rompe: se muestra solo el nombre propio", () => {
    expect(categoryPaths([opt("a", "Huérfana", "no-existe")]).get("a")).toBe("Huérfana");
  });

  it("un ciclo (dato corrupto) termina sin colgarse", () => {
    const list = [opt("a", "A", "b"), opt("b", "B", "a")];
    const paths = categoryPaths(list);
    expect(paths.get("a")).toBe("B › A");
    expect(paths.get("b")).toBe("A › B");
  });

  it("una cadena muy profunda se corta en 20 niveles", () => {
    const list = Array.from({ length: 40 }, (_, i) =>
      opt(`n${i}`, `N${i}`, i === 0 ? null : `n${i - 1}`),
    );
    const path = categoryPaths(list).get("n39") ?? "";
    expect(path.split(" › ")).toHaveLength(20);
  });
});
