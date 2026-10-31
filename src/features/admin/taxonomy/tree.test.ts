import { describe, expect, it } from "vitest";
import {
  buildCategoryTree,
  descendantIds,
  flattenTree,
  moveWithin,
  siblingsOf,
  validParents,
} from "./tree";
import type { AdminCategory } from "./types";

const cat = (
  id: string,
  parentId: string | null,
  sortOrder: number,
  o: Partial<AdminCategory> = {},
): AdminCategory => ({
  id,
  parentId,
  name: o.name ?? id.toUpperCase(),
  slug: id,
  description: null,
  sortOrder,
  archived: false,
  updatedAt: "2026-10-29T10:00:00.000000+00:00",
  ...o,
});

// ropa
//  ├─ chaquetas (1)
//  │   └─ cuero (1)
//  └─ vestidos (2)
// accesorios
const sample: AdminCategory[] = [
  cat("accesorios", null, 2, { name: "Accesorios" }),
  cat("ropa", null, 1, { name: "Ropa" }),
  cat("vestidos", "ropa", 2, { name: "Vestidos" }),
  cat("chaquetas", "ropa", 1, { name: "Chaquetas" }),
  cat("cuero", "chaquetas", 1, { name: "Cuero" }),
];

const shape = (nodes: ReturnType<typeof buildCategoryTree>): string[] =>
  flattenTree(nodes).map((n) => `${"-".repeat(n.depth)}${n.id}`);

describe("buildCategoryTree", () => {
  it("ordena por sortOrder y anida con su profundidad", () => {
    expect(shape(buildCategoryTree(sample, { showArchived: false }))).toEqual([
      "ropa",
      "-chaquetas",
      "--cuero",
      "-vestidos",
      "accesorios",
    ]);
  });

  it("a igual sortOrder desempata por nombre (con acentos y ñ en orden español)", () => {
    const tree = buildCategoryTree(
      [
        cat("b", null, 0, { name: "Zapatos" }),
        cat("a", null, 0, { name: "Ñandú" }),
        cat("c", null, 0, { name: "Abrigos" }),
      ],
      { showArchived: false },
    );
    expect(tree.map((n) => n.name)).toEqual(["Abrigos", "Ñandú", "Zapatos"]);
  });

  it("oculta las archivadas salvo que se pidan", () => {
    const withArchived = [...sample, cat("viejas", null, 3, { archived: true })];
    expect(shape(buildCategoryTree(withArchived, { showArchived: false }))).not.toContain("viejas");
    expect(shape(buildCategoryTree(withArchived, { showArchived: true }))).toContain("viejas");
  });

  it("una hija de un padre oculto (archivado) no desaparece: se muestra como principal", () => {
    const list = [cat("p", null, 1, { archived: true }), cat("h", "p", 1)];
    expect(shape(buildCategoryTree(list, { showArchived: false }))).toEqual(["h"]);
  });

  it("un padre inexistente deja a la hija como principal", () => {
    expect(shape(buildCategoryTree([cat("h", "fantasma", 1)], { showArchived: false }))).toEqual([
      "h",
    ]);
  });

  it("un ciclo A→B→A (imposible en la base) no cuelga la función ni pierde categorías", () => {
    const cycle = [cat("a", "b", 1), cat("b", "a", 2)];
    const flat = shape(buildCategoryTree(cycle, { showArchived: false }));
    expect(flat.sort()).toEqual(["-b", "a"]);
  });

  it("una categoría que es su propio padre se muestra como principal", () => {
    expect(shape(buildCategoryTree([cat("x", "x", 1)], { showArchived: false }))).toEqual(["x"]);
  });

  it("un árbol de 300 niveles se construye sin desbordar la pila de forma incontrolada", () => {
    const deep = Array.from({ length: 300 }, (_, i) =>
      cat(`n${i}`, i === 0 ? null : `n${i - 1}`, 1),
    );
    const flat = flattenTree(buildCategoryTree(deep, { showArchived: false }));
    expect(flat).toHaveLength(300);
    expect(flat[299]?.depth).toBe(299);
  });

  it("no modifica la lista recibida", () => {
    const copy = JSON.stringify(sample);
    buildCategoryTree(sample, { showArchived: true });
    expect(JSON.stringify(sample)).toBe(copy);
  });
});

describe("descendantIds", () => {
  it("devuelve hijas y nietas, sin la propia raíz", () => {
    expect(descendantIds(sample, "ropa").sort()).toEqual(["chaquetas", "cuero", "vestidos"]);
    expect(descendantIds(sample, "chaquetas")).toEqual(["cuero"]);
  });
  it("una hoja no tiene descendientes; un id inexistente tampoco", () => {
    expect(descendantIds(sample, "cuero")).toEqual([]);
    expect(descendantIds(sample, "no-existe")).toEqual([]);
  });
  it("es a prueba de ciclos: termina y no se incluye a sí misma", () => {
    const cycle = [cat("a", "b", 1), cat("b", "a", 2), cat("c", "b", 3)];
    expect(descendantIds(cycle, "a").sort()).toEqual(["b", "c"]);
  });
  it("incluye todas las ramas de un árbol ancho", () => {
    const wide = [cat("r", null, 1), ...Array.from({ length: 50 }, (_, i) => cat(`h${i}`, "r", i))];
    expect(descendantIds(wide, "r")).toHaveLength(50);
  });
  it("en un árbol de 300 niveles encuentra las 299 descendientes", () => {
    const deep = Array.from({ length: 300 }, (_, i) =>
      cat(`n${i}`, i === 0 ? null : `n${i - 1}`, 1),
    );
    expect(descendantIds(deep, "n0")).toHaveLength(299);
  });
});

describe("validParents", () => {
  it("al crear ofrece todas las activas, en orden de árbol y con su profundidad", () => {
    expect(validParents(sample, null).map((p) => `${p.depth}:${p.id}`)).toEqual([
      "0:ropa",
      "1:chaquetas",
      "2:cuero",
      "1:vestidos",
      "0:accesorios",
    ]);
  });

  it("al editar NO ofrece ni la propia categoría ni sus descendientes (evita el ciclo)", () => {
    const ids = validParents(sample, "ropa").map((p) => p.id);
    expect(ids).toEqual(["accesorios"]);
    expect(validParents(sample, "chaquetas").map((p) => p.id)).toEqual([
      "ropa",
      "vestidos",
      "accesorios",
    ]);
  });

  it("una hoja puede colgar de cualquier otra salvo de sí misma", () => {
    expect(validParents(sample, "cuero").map((p) => p.id)).toEqual([
      "ropa",
      "chaquetas",
      "vestidos",
      "accesorios",
    ]);
  });

  it("excluye las archivadas cuando la categoría editada está activa…", () => {
    const list = [...sample, cat("vieja", null, 9, { archived: true })];
    expect(validParents(list, "accesorios").map((p) => p.id)).not.toContain("vieja");
  });

  it("…y las ofrece (marcadas) cuando la editada también está archivada", () => {
    const list = [...sample, cat("vieja", null, 9, { archived: true })];
    const options = validParents(list, "accesorios", true);
    expect(options.find((p) => p.id === "vieja")?.archived).toBe(true);
  });

  it("ninguna opción que se ofrezca puede crear un ciclo, para CADA categoría del árbol", () => {
    for (const c of sample) {
      const forbidden = new Set([c.id, ...descendantIds(sample, c.id)]);
      for (const option of validParents(sample, c.id)) expect(forbidden.has(option.id)).toBe(false);
    }
  });
});

describe("siblingsOf", () => {
  it("devuelve las hermanas en su orden de aparición", () => {
    expect(siblingsOf(sample, "ropa", { showArchived: false }).map((c) => c.id)).toEqual([
      "chaquetas",
      "vestidos",
    ]);
    expect(siblingsOf(sample, null, { showArchived: false }).map((c) => c.id)).toEqual([
      "ropa",
      "accesorios",
    ]);
  });
  it("las archivadas solo cuentan si se muestran", () => {
    const list = [...sample, cat("vieja", "ropa", 9, { archived: true })];
    expect(siblingsOf(list, "ropa", { showArchived: false })).toHaveLength(2);
    expect(siblingsOf(list, "ropa", { showArchived: true })).toHaveLength(3);
  });
});

describe("moveWithin", () => {
  it("sube y baja una posición", () => {
    expect(moveWithin(["a", "b", "c"], "c", "up")).toEqual(["a", "c", "b"]);
    expect(moveWithin(["a", "b", "c"], "a", "down")).toEqual(["b", "a", "c"]);
  });
  it("en los bordes (o con un id inexistente) no cambia nada", () => {
    expect(moveWithin(["a", "b", "c"], "a", "up")).toEqual(["a", "b", "c"]);
    expect(moveWithin(["a", "b", "c"], "c", "down")).toEqual(["a", "b", "c"]);
    expect(moveWithin(["a", "b"], "z", "up")).toEqual(["a", "b"]);
  });
  it("no modifica el arreglo recibido", () => {
    const original = ["a", "b", "c"];
    moveWithin(original, "b", "up");
    expect(original).toEqual(["a", "b", "c"]);
  });
});
