import { matchRoutes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { routes } from "@/app/router";
import { PENDING_ROUTES, storeRoutes } from "./storeRoutes";

/** ¿Existe una ruta REAL para este path? (la comodín `*` de la 404 no cuenta) */
function exists(path: string): boolean {
  const matches = matchRoutes(routes, path);
  return matches !== null && !matches.some((m) => m.route.path === "*");
}

describe("storeRoutes", () => {
  const staticPaths = Object.entries(storeRoutes).filter(
    (entry): entry is [keyof typeof storeRoutes, string] => typeof entry[1] === "string",
  );

  it.each(staticPaths.filter(([key]) => !PENDING_ROUTES.includes(key)))(
    "la ruta %s (%s) existe en el router",
    (_key, path) => {
      expect(exists(path)).toBe(true);
    },
  );

  it("las rutas marcadas como pendientes siguen sin existir (si ya existe, quítala de PENDING_ROUTES)", () => {
    for (const key of PENDING_ROUTES) {
      const value = storeRoutes[key];
      if (typeof value === "string") expect(exists(value), key).toBe(false);
      else expect(value, key).toBeNull();
    }
  });

  it("las rutas de categoría existen y codifican el slug", () => {
    expect(exists(storeRoutes.category("mujer"))).toBe(true);
    expect(storeRoutes.category("a b/c")).toBe("/categoria/a%20b%2Fc");
  });
});
