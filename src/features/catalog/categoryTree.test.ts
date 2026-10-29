import { describe, expect, it } from "vitest";
import { buildCategoryTree, descendantIds } from "./categoryTree";
import type { Category } from "./types";

const cat = (id: string, parentId: string | null, name: string, sortOrder = 0): Category => ({
  id,
  parentId,
  name,
  slug: name.toLowerCase(),
  description: null,
  sortOrder,
});

describe("buildCategoryTree", () => {
  it("anida hijas bajo su padre y ordena por sortOrder y luego por nombre", () => {
    const tree = buildCategoryTree([
      cat("c", "a", "Cueros", 2),
      cat("b", "a", "Chaquetas", 1),
      cat("a", null, "Ropa", 0),
      cat("z", null, "Accesorios", 0),
    ]);
    expect(tree.map((n) => n.name)).toEqual(["Accesorios", "Ropa"]); // mismo orden 0 → alfabético
    const ropa = tree.find((n) => n.id === "a");
    expect(ropa?.children.map((n) => n.name)).toEqual(["Chaquetas", "Cueros"]);
  });

  it("ordena alfabéticamente respetando la ñ y los acentos del español", () => {
    const tree = buildCategoryTree([
      cat("1", null, "Óleos"),
      cat("2", null, "Ñandúes"),
      cat("3", null, "Zapatos"),
    ]);
    expect(tree.map((n) => n.name)).toEqual(["Ñandúes", "Óleos", "Zapatos"]);
  });

  it("una categoría cuyo padre no está (archivado) se vuelve raíz y no desaparece", () => {
    const tree = buildCategoryTree([cat("b", "padre-archivado", "Huérfana")]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.name).toBe("Huérfana");
  });

  it("lista vacía → árbol vacío", () => {
    expect(buildCategoryTree([])).toEqual([]);
  });

  it("no duplica nodos ni pierde ninguno (3 niveles)", () => {
    const tree = buildCategoryTree([cat("a", null, "A"), cat("b", "a", "B"), cat("c", "b", "C")]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.children[0]?.children[0]?.id).toBe("c");
  });
});

describe("descendantIds", () => {
  const all = [
    cat("ropa", null, "Ropa"),
    cat("chaquetas", "ropa", "Chaquetas"),
    cat("cuero", "chaquetas", "Cuero"),
    cat("sombreros", null, "Sombreros"),
  ];

  it("incluye la raíz y todos sus descendientes, sin tocar otras ramas", () => {
    expect(descendantIds(all, "ropa").sort()).toEqual(["chaquetas", "cuero", "ropa"]);
  });

  it("una hoja devuelve solo su propio id", () => {
    expect(descendantIds(all, "cuero")).toEqual(["cuero"]);
  });

  it("un id desconocido devuelve ese id (no revienta)", () => {
    expect(descendantIds(all, "x")).toEqual(["x"]);
  });

  it("es a prueba de ciclos (la BD los impide, pero el cliente no debe colgarse)", () => {
    const cyc = [cat("a", "b", "A"), cat("b", "a", "B")];
    expect(descendantIds(cyc, "a").sort()).toEqual(["a", "b"]);
  });
});
