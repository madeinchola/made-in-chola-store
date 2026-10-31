import type { TaxonomyOption } from "../types";

/**
 * Nombre completo de cada categoría con sus ancestros ("Ropa › Camisas"), para distinguir homónimas en los selectores.
 * Protegida contra ciclos y cadenas absurdamente largas (la base ya impide ciclos; esto evita colgar la pantalla si no).
 */
export function categoryPaths(options: readonly TaxonomyOption[]): Map<string, string> {
  const byId = new Map(options.map((o) => [o.id, o]));
  const paths = new Map<string, string>();
  for (const option of options) {
    const names = [option.name];
    const seen = new Set([option.id]);
    let parent = option.parentId ? byId.get(option.parentId) : undefined;
    while (parent && !seen.has(parent.id) && names.length < 20) {
      names.unshift(parent.name);
      seen.add(parent.id);
      parent = parent.parentId ? byId.get(parent.parentId) : undefined;
    }
    paths.set(option.id, names.join(" › "));
  }
  return paths;
}
