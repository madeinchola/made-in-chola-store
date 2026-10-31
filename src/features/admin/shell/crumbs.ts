import type { MessageKey } from "@/i18n";

export interface Crumb {
  key: MessageKey;
  to: string;
}

const SECTION_CRUMBS: Record<string, MessageKey> = {
  productos: "admin.nav.products",
  categorias: "admin.nav.categories",
  colecciones: "admin.nav.collections",
  monedas: "admin.nav.currencies",
  ajustes: "admin.nav.settings",
  auditoria: "admin.nav.audit",
};

/**
 * Migas de pan deducidas de la URL (función pura: no depende de un router de datos). El resumen (/admin) no tiene migas;
 * una ruta desconocida tampoco (no se inventa un nombre).
 */
export function crumbsFor(pathname: string): Crumb[] {
  const parts = pathname
    .replace(/^\/admin\/?/, "")
    .split("/")
    .filter(Boolean);
  const section = parts[0];
  const sectionKey = section ? SECTION_CRUMBS[section] : undefined;
  if (!section || !sectionKey) return [];
  const crumbs: Crumb[] = [{ key: sectionKey, to: `/admin/${section}` }];
  const detail = parts[1];
  if (section === "productos" && detail) {
    crumbs.push({
      key: detail === "nuevo" ? "admin.products.create.title" : "admin.products.edit.crumb",
      to: `/admin/productos/${detail}`,
    });
  }
  return crumbs;
}

/** Clave del nombre de la pantalla actual (la última miga; el resumen no tiene migas): sirve de título de la pestaña. */
export function pageTitleKey(pathname: string): MessageKey {
  const crumbs = crumbsFor(pathname);
  return crumbs[crumbs.length - 1]?.key ?? "admin.nav.dashboard";
}
